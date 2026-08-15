// Admin "Send to Claude" — file a repair request from an error row or a free-text description.
//
// POST { action_id?, restaurant_id?, note? }
//   • action_id given → bundle that staff_actions error + the ~20 surrounding rows for its
//     restaurant as context (so Claude sees what led up to it — no re-explaining needed).
//   • no action_id → an owner-described problem; `note` becomes the summary.
// GET ?status=open|fixed|dismissed → the list for the admin panel (bounded, newest first).
// PATCH { id, status } → dismiss / reopen from the admin panel.
//
// Admin-gated; restaurant_id UUID-validated; writes a fix_request (mig 160, service-role only)
// and a diary line. Idempotent so a double-tap files one request.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
import { logAction, redactMoney } from "@/lib/oplog";
import { withIdempotency } from "@/lib/idempotency";
import { lookupErrorMemory, isRegression, rememberErrorHandled } from "@/lib/errorMemory";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  const status = new URL(req.url).searchParams.get("status") || "open";
  if (!["open", "fixed", "dismissed"].includes(status)) return err("invalid status");
  const r = await sb.from("fix_requests")
    .select("id, restaurant_id, created_at, status, source, mode, summary, note, pr_url, resolved_at, action_id, err_key")
    .eq("status", status).order("created_at", { ascending: false }).limit(50);
  if (r.error) return adminFail("the repair request", r.error, { action: "load" });
  return NextResponse.json({ requests: r.data ?? [] });
}

async function postHandler(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }

  const actionId = typeof body.action_id === "string" && UUID.test(body.action_id) ? body.action_id : null;
  const note = String(body.note || "").trim().slice(0, 1000);
  let rid = typeof body.restaurant_id === "string" && UUID.test(body.restaurant_id) ? body.restaurant_id : null;
  // Which Claude: 'instant' pops the Mac terminal, 'overnight' waits for the 02:30 robot.
  const mode = body.mode === "overnight" ? "overnight" : "instant";

  let summary = note;
  let source = "owner_described";
  let context: Record<string, unknown> | null = note ? { note } : null;
  // The group key the Repair UI builds per error tile, stored so the panel can match a tile to
  // its queued/fixed request across a refresh (kills the "keeps re-offering Fix now" bug). Same
  // formula as groupErrors() in app/aevinite/repair/page.tsx — keep the two in lock-step.
  let errKey: string | null = null;
  // Set when this problem was fixed before and has come back — attached to the context so the
  // agent sees the failed attempt instead of rebuilding it from scratch.
  let regression: { fixedAt: string; prUrl: string | null; fixedBy: string | null } | null = null;

  if (actionId) {
    // Find the error row, then grab the window of rows around it for the same restaurant.
    const row = (await sb.from("staff_actions")
      .select("id, panel, action, detail, restaurant_id, level, created_at")
      .eq("id", actionId).maybeSingle()).data as { panel: string; action: string; detail: string | null; restaurant_id: string | null; level: string; created_at: string } | null;
    if (!row) return err("That log entry no longer exists.", 404);
    rid = rid || row.restaurant_id;
    source = "error_row";
    // Cap what gets STORED as well as what gets shown. A detail can be a whole HTML error page
    // (a proxy answering with a document instead of JSON), and a 50KB blob is no use to anyone
    // reading a queue — the full text stays on the error row itself. (2026-07-31)
    summary = String((redactMoney(row.detail) as string) || row.action).slice(0, 600);

    // ── Already fixed? (error_signatures, migs 218/219) ──────────────────────────────────────
    // This is the guard that stops the same problem being handed to Claude twice. On 2026-07-28
    // a 414 ticket popped a live session that spent ~40 minutes rebuilding a fix ANOTHER session
    // had already shipped. So: an error that happened BEFORE its fix has already been answered —
    // refuse, and tell the owner where the answer is. An error that happened AFTER its fix is a
    // different story: the fix didn't hold, so the request goes through, clearly labelled, with
    // the previous attempt attached so nobody rebuilds it blind.
    const mem = await lookupErrorMemory({ panel: row.panel, action: row.action, detail: row.detail, restaurantId: row.restaurant_id });
    if (mem) {
      const when = new Date(mem.fixed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      if (!isRegression(mem, row.created_at)) {
        return err(`This was already fixed on ${when}${mem.pr_url ? ` — ${mem.pr_url}` : ""}. This entry is from before that fix, so there's nothing new to do.`, 409);
      }
      // Happened AGAIN after its fix: the fix didn't hold. Nothing is silenced — the request goes
      // through, labelled, with the failed attempt attached.
      regression = { fixedAt: mem.fixed_at, prUrl: mem.pr_url, fixedBy: mem.fixed_by };
      summary = `CAME BACK after the fix on ${when} — ${summary}`.slice(0, 300);
    }

    // ±window: the 20 rows just BEFORE this error for the same restaurant (what led up to it).
    let ctxQ = sb.from("staff_actions")
      .select("panel, action, detail, level, created_at")
      .lte("created_at", row.created_at).order("created_at", { ascending: false }).limit(20);
    if (row.restaurant_id) ctxQ = ctxQ.eq("restaurant_id", row.restaurant_id);
    const around = (await ctxQ).data ?? [];
    context = {
      error: { panel: row.panel, action: row.action, detail: redactMoney(row.detail), at: row.created_at },
      leading_up: around.map((a) => ({ panel: a.panel, action: a.action, detail: redactMoney(a.detail), level: a.level, at: a.created_at })).reverse(),
    };
    // If the owner ALSO typed a hint ("Fix now with a note"), surface it up top so the agent reads
    // it — the note column alone isn't in the bundled input file. redactMoney to match the rest.
    if (note) (context as Record<string, unknown>).owner_note = redactMoney(note);
    // The earlier fix that failed — so the agent starts from "why didn't that hold?", not from zero.
    if (regression) (context as Record<string, unknown>).previous_fix = {
      fixed_at: regression.fixedAt, pr_url: regression.prUrl, fixed_by: regression.fixedBy,
      note: "This problem was recorded as FIXED before and has happened again — the earlier fix did not hold. Check that PR first; do not rebuild it blind.",
    };
    errKey = `${row.panel}|${row.restaurant_id || ""}|${row.action}|${(redactMoney(row.detail) as string || "").slice(0, 90)}`;
  }

  if (!summary) return err("Add a short description of the problem.");
  if (rid && !UUID.test(rid)) rid = null;

  const ins = await sb.from("fix_requests").insert({ restaurant_id: rid, source, mode, summary: summary.slice(0, 300), note: note || null, context, action_id: actionId, err_key: errKey }).select("id").maybeSingle();
  if (ins.error) return adminFail("the repair request", ins.error, { action: "load" });
  await logAction("admin", "fix_request", { restaurant_id: rid ?? undefined, level: "info", detail: summary.slice(0, 120) });

  // Tell the panel where this request lands so the click message is honest: how many problems
  // are already waiting, and whether a live Mac window is open RIGHT NOW. Only one live window
  // opens at a time (the watcher's busy-lock) — a fresh 'instant' ask made while one is running
  // won't pop its own window; the open session sweeps it. Two tiny head-count reads, no rows.
  const [openCount, liveRun] = await Promise.all([
    sb.from("fix_requests").select("id", { count: "exact", head: true }).eq("status", "open"),
    sb.from("agent_runs").select("id", { count: "exact", head: true }).eq("kind", "live").eq("status", "running"),
  ]);
  return NextResponse.json({
    ok: true,
    id: ins.data?.id ?? null,
    openCount: openCount.count ?? null,
    liveRunning: (liveRun.count ?? 0) > 0,
  });
}

export const POST = withIdempotency(postHandler, "admin");

export async function PATCH(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const id = String(body.id || "");
  const status = String(body.status || "");
  if (!UUID.test(id)) return err("invalid id");
  if (!["open", "fixed", "dismissed"].includes(status)) return err("invalid status");
  const patch: Record<string, unknown> = { status };
  if (status !== "open") patch.resolved_at = new Date().toISOString();
  if (typeof body.pr_url === "string" && /^https?:\/\//.test(body.pr_url)) patch.pr_url = body.pr_url.slice(0, 300);
  const r = await sb.from("fix_requests")
    .update(patch).eq("id", id)
    .select("id, action_id, restaurant_id, pr_url, summary").maybeSingle();
  if (r.error) return adminFail("the repair request", r.error, { action: "save" });

  // Closing a ticket as FIXED records the fix (migs 218/219), so pressing Fix-now on an older
  // occurrence answers "already fixed, here's the PR" instead of opening a duplicate session.
  // 'dismissed' records NOTHING — it used to write a mute, and nothing may silence an error any
  // more. Only possible when the ticket came from a real error row (we need its message for the
  // signature). Best-effort: closing the ticket must never fail because of this.
  const closed = r.data as { action_id?: string | null; restaurant_id?: string | null; pr_url?: string | null } | null;
  if (closed?.action_id && status === "fixed") {
    try {
      const src = (await sb.from("staff_actions").select("panel, action, detail, restaurant_id")
        .eq("id", closed.action_id).maybeSingle()).data as
        { panel: string; action: string; detail: string | null; restaurant_id: string | null } | null;
      if (src) {
        await rememberErrorHandled({
          panel: src.panel, action: src.action, detail: src.detail,
          restaurantId: src.restaurant_id,
          by: "claude",
          prUrl: closed.pr_url ?? null,
        });
      }
    } catch { /* memory is an optimisation, not a requirement */ }
  }
  return NextResponse.json({ ok: true });
}
