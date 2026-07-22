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
import { logAction, redactMoney } from "@/lib/oplog";
import { withIdempotency } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  const status = new URL(req.url).searchParams.get("status") || "open";
  if (!["open", "fixed", "dismissed"].includes(status)) return err("invalid status");
  const r = await sb.from("fix_requests")
    .select("id, restaurant_id, created_at, status, source, mode, summary, note, pr_url, resolved_at")
    .eq("status", status).order("created_at", { ascending: false }).limit(50);
  if (r.error) return err(r.error.message, 500);
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

  if (actionId) {
    // Find the error row, then grab the window of rows around it for the same restaurant.
    const row = (await sb.from("staff_actions")
      .select("id, panel, action, detail, restaurant_id, level, created_at")
      .eq("id", actionId).maybeSingle()).data as { panel: string; action: string; detail: string | null; restaurant_id: string | null; level: string; created_at: string } | null;
    if (!row) return err("That log entry no longer exists.", 404);
    rid = rid || row.restaurant_id;
    source = "error_row";
    summary = (redactMoney(row.detail) as string) || row.action;

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
  }

  if (!summary) return err("Add a short description of the problem.");
  if (rid && !UUID.test(rid)) rid = null;

  const ins = await sb.from("fix_requests").insert({ restaurant_id: rid, source, mode, summary: summary.slice(0, 300), note: note || null, context }).select("id").maybeSingle();
  if (ins.error) return err(ins.error.message, 500);
  await logAction("admin", "fix_request", { restaurant_id: rid ?? undefined, level: "info", detail: summary.slice(0, 120) });
  return NextResponse.json({ ok: true, id: ins.data?.id ?? null });
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
  const r = await sb.from("fix_requests").update(patch).eq("id", id).select("id").maybeSingle();
  if (r.error) return err(r.error.message, 500);
  return NextResponse.json({ ok: true });
}
