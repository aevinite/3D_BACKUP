// GET /api/owner/oplog — the owner's Activity log: every staff action across THEIR
// restaurant(s), so the owner can see who did what (and, for a tablet action, which
// manager's PIN unlocked it), then click any row for the full detail.
//
// SCOPE (ownerScope, lib/ownerScope):
//   • a real OWNER → only the restaurants they own (restaurant_owners, mig 097);
//   • the ADMIN act-as → the one restaurant they've entered (or all, scope=all).
// The owner sees their OWN owner-level actions AND their staff's (manager/kitchen/
// tablet) — but NOT the admin's actions or the raw 'db' manual-edit footprints (those
// stay in the admin's Everything Log). Unlike the admin feed, money is NOT redacted:
// it's the owner's own restaurant data.
//
// Egress-safe (data-cost-guard): scoped by restaurant_id, an explicit column list, and
// a hard limit — never a whole-table read.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScope, inScope } from "@/lib/ownerScope";

export const dynamic = "force-dynamic";

// The columns the Activity list + its detail popup render — nothing more crosses the wire.
const COLS = "id, panel, action, actor, actor_id, device_id, order_id, detail, table_number, restaurant_id, level, seen_at, resolved_at, created_at";

export async function GET(req: NextRequest) {
  const scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1), 200);
  const level = url.searchParams.get("level");
  const qText = (url.searchParams.get("q") || "").trim().slice(0, 80);

  let q = sb.from("staff_actions").select(COLS).order("created_at", { ascending: false }).limit(limit);
  // Owner never sees the admin's own actions or the direct-database-edit footprints.
  q = q.not("panel", "in", "(admin,db)");
  // Optional ?rid= — narrow to ONE selected restaurant (the top-strip restaurant pick / an
  // admin act-as one restaurant), mirroring how /api/owner/reports scopes. Only honoured when
  // that id is already in the caller's scope (an admin's scope is every restaurant), so it can
  // only NARROW, never widen. Without it, fall back to the owner's full restaurant set.
  const pinRid = url.searchParams.get("rid");
  if (pinRid) {
    if (!inScope(scope, pinRid)) return NextResponse.json({ actions: [] });
    q = q.eq("restaurant_id", pinRid);
  } else if (!scope.all) {
    // Restrict to the owner's restaurant(s). A real owner (or admin act-as one restaurant) is
    // always scope.all === false with a concrete id list; only an admin scope=all skips this.
    if (!scope.ids.length) return NextResponse.json({ actions: [] });
    q = q.in("restaurant_id", scope.ids);
  }
  if (level === "error" || level === "warn" || level === "info") q = q.eq("level", level);
  if (qText) {
    const safe = qText.replace(/[%,()]/g, " ");
    q = q.or(`action.ilike.%${safe}%,detail.ilike.%${safe}%`);
  }

  const r = await q;
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  const rows = r.data ?? [];

  // Stamp each row with its restaurant NAME so a multi-restaurant owner can tell them apart
  // (one batched lookup, no N+1). Single-restaurant owners simply ignore it.
  const ids = Array.from(new Set(rows.map((a) => a.restaurant_id).filter(Boolean))) as string[];
  const nameById = new Map<string, string>();
  if (ids.length) {
    const rest = await sb.from("restaurants").select("id, name").in("id", ids);
    for (const x of rest.data ?? []) nameById.set(x.id, x.name);
  }
  const actions = rows.map((a) => ({ ...a, restaurant_name: a.restaurant_id ? nameById.get(a.restaurant_id) ?? null : null }));
  return NextResponse.json({ actions });
}
