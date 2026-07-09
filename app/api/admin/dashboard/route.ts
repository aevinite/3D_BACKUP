// GET /api/admin/dashboard — ONE call that returns everything the admin home screen needs,
// so the dashboard makes a single round-trip instead of six (audit 2026-07-07). This cuts
// repeated egress on the 60s refresh: notably it returns ONLY the currently-online staff
// (a small, time-filtered list, ≤200) instead of hauling the whole staff_users table every
// cycle, and it reuses the pre-aggregated lfh_owner_overview RPC for per-restaurant open counts.
// Admin-gated (each admin route checks the cookie itself — there is no middleware).
// NO food money anywhere (hard rule): only counts, and lfh_owner_overview's revenue columns
// are deliberately dropped here. Activity `detail` is redacted for money.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { businessDayStartIso } from "@/lib/businessDay";
import { redactMoney } from "@/lib/oplog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sinceIso = businessDayStartIso();
  const onlineSinceIso = new Date(Date.now() - 180_000).toISOString(); // "online" = seen in last 3 min
  const head = { count: "exact" as const, head: true };

  const [restQ, setQ, ownersQ, ordersTodayQ, maintQ, onlineQ, issuesQ, ovRpc, actQ] =
    await Promise.all([
      sb.from("restaurants").select("id, slug, name, active, owner_user_id").is("deleted_at", null).order("name"),
      sb.from("settings").select("restaurant_id, enabled_panels"),
      sb.from("staff_users").select("id, name, username").eq("role", "owner").eq("active", true),
      sb.from("orders").select("id", head).neq("status", "cancelled").gte("created_at", sinceIso),
      sb.from("settings").select("restaurant_id").eq("service_mode", true),
      // Only the staff CURRENTLY online (seen in the last 3 min) — a small list, instead of
      // hauling the ENTIRE staff_users table every 60s just to filter it on the client.
      sb.from("staff_users").select("name, username, role, restaurant_id, last_seen_at").eq("active", true).gte("last_seen_at", onlineSinceIso).limit(200),
      sb.from("issues").select("id, restaurant_id, subject, status, created_at").eq("status", "open").order("created_at", { ascending: false }).limit(50),
      // Per-restaurant open-table counts from the pre-aggregated RPC (p_ids=null → all). We read
      // ONLY open_tables from it; its revenue columns are ignored (no money to admin).
      sb.rpc("lfh_owner_overview", { p_ids: null }),
      // Only the columns the activity feed renders (not select("*")) — trims wire size.
      sb.from("staff_actions").select("id, panel, action, actor, detail, table_number, restaurant_id, created_at").order("created_at", { ascending: false }).limit(18),
    ]);

  if (restQ.error) return NextResponse.json({ error: restQ.error.message }, { status: 500 });

  const withSettings = new Set((setQ.data || []).map((r) => r.restaurant_id).filter(Boolean));
  const panelsByRid = new Map((setQ.data || []).map((r) => [r.restaurant_id, (r as { enabled_panels?: Record<string, boolean> | null }).enabled_panels || null]));
  const ownerName = new Map((ownersQ.data || []).map((o) => [o.id, o.name || o.username]));
  const nameByRid = new Map((restQ.data || []).map((r) => [r.id, r.name]));

  const restaurants = (restQ.data || []).map((r) => ({
    id: r.id, slug: r.slug, name: r.name, active: r.active === true,
    hasSettings: withSettings.has(r.id),
    ownerUserId: r.owner_user_id || null,
    ownerName: r.owner_user_id ? (ownerName.get(r.owner_user_id) || "—") : null,
    panels: panelsByRid.get(r.id) || null,
  }));

  // Per-restaurant open tables (revenue columns from the RPC are dropped). Keep only LIVE
  // restaurants so the headline total matches the /open-tables detail, which also excludes
  // binned restaurants — the old raw platform-wide session count inflated the card with
  // sessions from deleted restaurants (audit 2026-07-09).
  const liveIdSet = new Set((restQ.data || []).map((r) => r.id));
  const openByRid = ((ovRpc.data as { restaurant_id: string; open_tables: number }[] | null) || [])
    .filter((r) => r.restaurant_id && liveIdSet.has(r.restaurant_id))
    .map((r) => ({ id: r.restaurant_id, openTables: Number(r.open_tables) || 0 }));

  // Live restaurants currently in maintenance, by name.
  const maintenanceNames = (maintQ.data || [])
    .map((s) => s.restaurant_id && nameByRid.get(s.restaurant_id))
    .filter((n): n is string => !!n);

  const issues = (issuesQ.data || []).map((i) => ({
    id: i.id, restaurantName: (i.restaurant_id && nameByRid.get(i.restaurant_id)) || "—",
    subject: i.subject, status: i.status, created_at: i.created_at,
  }));

  const online = (onlineQ.data || []).map((u) => ({
    name: u.name, username: u.username, role: u.role,
    restaurantName: (u.restaurant_id && nameByRid.get(u.restaurant_id)) || null,
    last_seen_at: u.last_seen_at,
  }));

  const restMeta = new Map((restQ.data || []).map((r) => [r.id, { name: r.name, slug: r.slug }]));
  const activity = (actQ.data || []).map((a) => {
    const meta = a.restaurant_id ? restMeta.get(a.restaurant_id) : undefined;
    return { ...a, detail: redactMoney(a.detail), restaurant_name: meta?.name ?? null, restaurant_slug: meta?.slug ?? null };
  });

  return NextResponse.json({
    restaurants,
    openByRid,
    maintenance: maintenanceNames.length > 0,
    maintenanceNames,
    ordersToday: ordersTodayQ.count || 0,
    openTables: openByRid.reduce((s, r) => s + r.openTables, 0),
    online,
    issues,
    activity,
  });
}
