// POST /api/admin/resolve-error — the owner fixed a problem themselves; clear it from the
// Repair "Problems right now" list, the dashboard red button, and the red styling in the Logs
// page (owner 2026-07-24).
//
// Body: { action_id, reopen? } — one error row from the group being acted on. We act on the WHOLE
// visual group (the ×N repeats): every error row with the same panel + restaurant + action +
// message. reopen falsy → set resolved_at=now() on the still-open rows (mark handled). reopen true
// → clear resolved_at back to NULL on the resolved rows (undo, from the Logs page). The full
// activity log always shows the rows either way. Admin-gated.
//
// TWO MORE SHAPES (owner, 2026-08-20). The board had nineteen tiles, eight of them the same three
// manager faults, and every single one needed its own two-step Resolve — so clearing it after one
// fix landed was nineteen pairs of taps, which is how a board stops being read:
//
//   { snooze_hours: N, action_id }            → this problem WAITS N hours, then comes back by itself
//   { all: true, restaurant_id? }             → resolve every open problem (optionally one restaurant)
//   { all: true, snooze_hours: N, ... }       → make them all wait
//
// A WAIT IS NOT A MUTE and BULK IS NOT A FIX. `snoozed_until` (mig 344) leaves resolved_at NULL, so
// the problem is still open everywhere except the board's own list, and a NEW occurrence writes a
// NEW row with no wait on it. And a bulk resolve deliberately writes NO "already fixed" record: the
// per-tile Resolve means "I handled this", which is what earns the record that stops Fix-now redoing
// the work — clearing a board after one deploy does not, and claiming it would send Claude away from
// eighteen problems nobody has looked at.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
import { logAction } from "@/lib/oplog";
import { rememberErrorHandled, forgetErrorSignature } from "@/lib/errorMemory";
// The SAME signature function the Repair board groups its tiles with — so "Resolve" clears the
// whole ×N tile instead of only the rows whose text happens to match character for character.
import { errorSig } from "@/lib/errorSignature";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }

  // "Wait, then show me again" — hours, bounded to a month so a mis-typed value can't park a
  // problem out of sight for a year. 0/absent = not a snooze.
  const snoozeHours = Math.trunc(Number(body.snooze_hours) || 0);
  if (snoozeHours < 0 || snoozeHours > 24 * 31) return NextResponse.json({ error: "snooze_hours out of range (0..744)" }, { status: 400 });
  const snoozeUntil = snoozeHours > 0 ? new Date(Date.now() + snoozeHours * 3600_000).toISOString() : null;

  // ── EVERYTHING AT ONCE ────────────────────────────────────────────────────────────────────────
  // Scoped exactly the way the board is: all restaurants, or the one the picker has chosen. The
  // restaurant-less rows (a platform-wide crash) belong to the "all restaurants" view only, which
  // is the same rule the page's own filter follows.
  if (body.all === true) {
    const scope = typeof body.restaurant_id === "string" && UUID.test(body.restaurant_id) ? body.restaurant_id : null;
    let upd = sb.from("staff_actions")
      .update(snoozeUntil ? { snoozed_until: snoozeUntil } : { resolved_at: new Date().toISOString() })
      .eq("level", "error")
      .is("resolved_at", null);
    if (scope) upd = upd.eq("restaurant_id", scope);
    // Snoozing again should only ever reach the tiles you can SEE, i.e. ones not already waiting.
    if (snoozeUntil) upd = upd.or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`);
    const bulk = await upd.select("id");
    if (bulk.error) return adminFail(snoozeUntil ? "those problems' reminder" : "those problems' status", bulk.error, { action: "save" });
    const n = bulk.data?.length ?? 0;
    await logAction("admin", snoozeUntil ? "errors_snoozed_all" : "errors_resolved_all", {
      restaurant_id: scope ?? undefined,
      level: "info",
      detail: snoozeUntil
        ? `Set ${n} problem report(s) to wait ${snoozeHours}h${scope ? " (one restaurant)" : " (all restaurants)"}`
        : `Cleared ${n} problem report(s) from the board${scope ? " (one restaurant)" : " (all restaurants)"}`,
    });
    // No "already fixed" record is written here on purpose — see the header note.
    return NextResponse.json({ ok: true, resolved: snoozeUntil ? 0 : n, snoozed: snoozeUntil ? n : 0, remembered: false });
  }

  const actionId = typeof body.action_id === "string" && UUID.test(body.action_id) ? body.action_id : null;
  if (!actionId) return NextResponse.json({ error: "invalid action_id" }, { status: 400 });
  const reopen = body.reopen === true; // Logs-page "Reopen" — undo a resolve for the whole group.
  // NOTE (mig 219): there is deliberately NO "mute" mode. Resolving clears today's rows and records
  // that the problem was handled (so Fix-now on an older occurrence says "already fixed" instead of
  // opening a duplicate Claude session) — it can never silence a FUTURE error. If this problem
  // happens again it lands on the board as loudly as any other. Reopening forgets the record.

  // Look up the row the owner tapped so we can resolve its whole repeat-group.
  const row = (await sb.from("staff_actions")
    .select("panel, action, detail, restaurant_id, level")
    .eq("id", actionId).maybeSingle()).data as
    { panel: string; action: string; detail: string | null; restaurant_id: string | null; level: string } | null;
  if (!row) return NextResponse.json({ error: "that entry no longer exists" }, { status: 404 });
  if (row.level !== "error") return NextResponse.json({ error: "only errors can be resolved" }, { status: 400 });

  // ── THE GROUP MEANS WHAT THE TILE MEANS ──────────────────────────────────────────────────────
  // This matched on `detail` being EXACTLY EQUAL, while the board builds its ×N tile with
  // errorGroupKey() — which normalises the parts that change between occurrences (order ids, row
  // counts, and now the browser tag). So a tile reading "×6" could clear only the two rows whose
  // text happened to match character for character, and the other four came straight back on the
  // next refresh, with the admin having watched a "Resolved · cleared 6 reports" toast.
  //
  // Now both sides use ONE definition: read the candidates (same panel + action + restaurant, in
  // the right resolved state), compute the signature in TS exactly as the page does, and act on the
  // ids that match. Bounded at 500 — far above any real repeat count, and it is an indexed read on
  // the partial error index either way.
  let cand = sb.from("staff_actions").select("id, detail")
    .eq("level", "error").eq("panel", row.panel).eq("action", row.action);
  cand = reopen ? cand.not("resolved_at", "is", null) : cand.is("resolved_at", null);
  cand = row.restaurant_id === null ? cand.is("restaurant_id", null) : cand.eq("restaurant_id", row.restaurant_id);
  const candQ = await cand.limit(500);
  if (candQ.error) return adminFail("that problem's status", candQ.error, { action: "load" });

  const wantSig = errorSig(row.detail);
  const ids = (candQ.data || [])
    .filter((c: { id: string; detail: string | null }) => errorSig(c.detail) === wantSig)
    .map((c: { id: string }) => c.id);
  // The row the admin tapped is always in scope, even if a race moved it out of the candidate read.
  if (!ids.includes(actionId)) ids.push(actionId);

  // A WAIT writes `snoozed_until` and leaves resolved_at alone — the problem stays open, it just
  // stops occupying the board until then (mig 344).
  const r = await sb.from("staff_actions")
    .update(snoozeUntil && !reopen ? { snoozed_until: snoozeUntil } : { resolved_at: reopen ? null : new Date().toISOString() })
    .in("id", ids)
    .select("id");
  if (r.error) return adminFail("that problem's status", r.error, { action: "save" });

  const count = r.data?.length ?? 0;

  // A WAIT IS NOT A HANDLING — so it writes no "already fixed" record and claims nothing. It stops
  // here, before the memory write and with its own log line, because everything below this point is
  // about a problem someone has dealt with.
  if (snoozeUntil && !reopen) {
    await logAction("admin", "error_snoozed", {
      restaurant_id: row.restaurant_id ?? undefined,
      level: "info",
      detail: `Waiting ${snoozeHours}h, then back on the board: ${(row.detail || row.action).slice(0, 100)}${count > 1 ? ` (×${count})` : ""}`,
    });
    return NextResponse.json({ ok: true, snoozed: count, until: snoozeUntil, remembered: false });
  }

  // Record (or forget) that this problem was handled — migs 218/219. This ONLY stops a duplicate
  // Claude ticket for occurrences from before now; it never hides a new error.
  let remembered = false;
  let forgotten = 0;
  try {
    const key = { panel: row.panel, action: row.action, detail: row.detail, restaurantId: row.restaurant_id };
    if (reopen) {
      forgotten = await forgetErrorSignature(key);
    } else {
      remembered = (await rememberErrorHandled({ ...key, by: "owner" })).ok;
    }
  } catch { /* the row-level resolve already succeeded — memory is best-effort */ }

  await logAction("admin", reopen ? "error_reopened" : "error_resolved", {
    restaurant_id: row.restaurant_id ?? undefined,
    level: "info",
    detail: `${reopen ? "Reopened" : "Resolved"}: ${(row.detail || row.action).slice(0, 100)}${count > 1 ? ` (×${count})` : ""}`,
  });
  return NextResponse.json({
    ok: true,
    resolved: reopen ? 0 : count,
    reopened: reopen ? count : 0,
    remembered, forgotten,
  });
}
