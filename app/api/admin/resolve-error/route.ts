// POST /api/admin/resolve-error — the owner fixed a problem themselves; clear it from the
// Repair "Problems right now" list, the dashboard red button, and the red styling in the Logs
// page (owner 2026-07-24).
//
// Body: { action_id, reopen? } — one error row from the group being acted on. We act on the WHOLE
// visual group (the ×N repeats): every error row with the same panel + restaurant + action +
// message. reopen falsy → set resolved_at=now() on the still-open rows (mark handled). reopen true
// → clear resolved_at back to NULL on the resolved rows (undo, from the Logs page). The full
// activity log always shows the rows either way. Admin-gated.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";
import { rememberErrorHandled, forgetErrorSignature } from "@/lib/errorMemory";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const actionId = typeof body.action_id === "string" && UUID.test(body.action_id) ? body.action_id : null;
  if (!actionId) return NextResponse.json({ error: "invalid action_id" }, { status: 400 });
  const reopen = body.reopen === true; // Logs-page "Reopen" — undo a resolve for the whole group.
  // mode (mig 218) — what to REMEMBER about this kind of error, not just these rows:
  //   'fixed'   (default) → it was a real problem and it's dealt with; old occurrences never alarm
  //                         again, but if it happens again after now it comes back loud.
  //   'ignored'           → "this isn't a real problem, never show it again" (still logged).
  // Reopening forgets the memory entirely, so the problem alarms normally from then on.
  const mode = body.mode === "ignored" ? "ignored" : "fixed";

  // Look up the row the owner tapped so we can resolve its whole repeat-group.
  const row = (await sb.from("staff_actions")
    .select("panel, action, detail, restaurant_id, level")
    .eq("id", actionId).maybeSingle()).data as
    { panel: string; action: string; detail: string | null; restaurant_id: string | null; level: string } | null;
  if (!row) return NextResponse.json({ error: "that entry no longer exists" }, { status: 404 });
  if (row.level !== "error") return NextResponse.json({ error: "only errors can be resolved" }, { status: 400 });

  // Target the group: same panel + action + message + restaurant. When resolving we only touch the
  // still-open rows (resolved_at IS NULL); when reopening we only touch the already-resolved rows.
  let upd = sb.from("staff_actions").update({ resolved_at: reopen ? null : new Date().toISOString() })
    .eq("level", "error")
    .eq("panel", row.panel).eq("action", row.action);
  upd = reopen ? upd.not("resolved_at", "is", null) : upd.is("resolved_at", null);
  upd = row.detail === null ? upd.is("detail", null) : upd.eq("detail", row.detail);
  upd = row.restaurant_id === null ? upd.is("restaurant_id", null) : upd.eq("restaurant_id", row.restaurant_id);
  const r = await upd.select("id");
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });

  const count = r.data?.length ?? 0;

  // Remember (or forget) the PROBLEM, not just these rows — mig 218. This is what stops the same
  // error re-alarming and re-opening a Claude ticket after it's been dealt with.
  let remembered = false;
  let forgotten = 0;
  try {
    const key = { panel: row.panel, action: row.action, detail: row.detail, restaurantId: row.restaurant_id };
    if (reopen) {
      forgotten = await forgetErrorSignature(key);
    } else {
      remembered = (await rememberErrorHandled({ ...key, state: mode, by: "owner" })).ok;
    }
  } catch { /* the row-level resolve already succeeded — memory is best-effort */ }

  await logAction("admin", reopen ? "error_reopened" : "error_resolved", {
    restaurant_id: row.restaurant_id ?? undefined,
    level: "info",
    detail: `${reopen ? "Reopened" : mode === "ignored" ? "Marked not-a-problem" : "Resolved"}: ${(row.detail || row.action).slice(0, 100)}${count > 1 ? ` (×${count})` : ""}`,
  });
  return NextResponse.json({
    ok: true,
    resolved: reopen ? 0 : count,
    reopened: reopen ? count : 0,
    remembered, forgotten, mode: reopen ? "reopened" : mode,
  });
}
