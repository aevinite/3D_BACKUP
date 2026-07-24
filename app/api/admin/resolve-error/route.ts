// POST /api/admin/resolve-error — the owner fixed a problem themselves; clear it from the
// Repair "Problems right now" list and the dashboard red button (owner 2026-07-24).
//
// Body: { action_id } — one error row from the group the owner is resolving. We resolve the WHOLE
// visual group (the ×N repeats): every unresolved error row with the same panel + restaurant +
// action + message. Sets resolved_at=now() (the full activity log still shows them). Admin-gated.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const actionId = typeof body.action_id === "string" && UUID.test(body.action_id) ? body.action_id : null;
  if (!actionId) return NextResponse.json({ error: "invalid action_id" }, { status: 400 });

  // Look up the row the owner tapped so we can resolve its whole repeat-group.
  const row = (await sb.from("staff_actions")
    .select("panel, action, detail, restaurant_id, level")
    .eq("id", actionId).maybeSingle()).data as
    { panel: string; action: string; detail: string | null; restaurant_id: string | null; level: string } | null;
  if (!row) return NextResponse.json({ error: "that entry no longer exists" }, { status: 404 });
  if (row.level !== "error") return NextResponse.json({ error: "only errors can be resolved" }, { status: 400 });

  const nowIso = new Date().toISOString();
  let upd = sb.from("staff_actions").update({ resolved_at: nowIso })
    .eq("level", "error").is("resolved_at", null)
    .eq("panel", row.panel).eq("action", row.action);
  upd = row.detail === null ? upd.is("detail", null) : upd.eq("detail", row.detail);
  upd = row.restaurant_id === null ? upd.is("restaurant_id", null) : upd.eq("restaurant_id", row.restaurant_id);
  const r = await upd.select("id");
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });

  const count = r.data?.length ?? 0;
  await logAction("admin", "error_resolved", {
    restaurant_id: row.restaurant_id ?? undefined,
    level: "info",
    detail: `Resolved: ${(row.detail || row.action).slice(0, 100)}${count > 1 ? ` (×${count})` : ""}`,
  });
  return NextResponse.json({ ok: true, resolved: count });
}
