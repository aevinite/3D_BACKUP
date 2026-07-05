// GET /api/admin/analytics?range=today|7d|30d — the Platform Analytics page.
// Cross-restaurant OPERATIONAL analytics only — NO food revenue anywhere (CLAUDE.md
// hard rule: restaurant earnings are owner-panel-only). Everything here is a COUNT.
// Aggregated server-side: the two grouped breakdowns (trend + busiest + source) run
// as ONE Postgres RPC each (migration 119) — never a raw-orders fetch to the client.
// Admin-gated (same staff cookie as every other /api/admin/* route).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Day-aligned (Asia/Kolkata) [from, to) bounds for the three range presets —
// matches the bucketing the RPCs use (date_trunc('day', … AT TIME ZONE 'Asia/Kolkata')).
function rangeBounds(range: string): { from: Date; to: Date } {
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const istMidnight = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());
  const days = range === "30d" ? 29 : range === "7d" ? 6 : 0;
  const fromIst = istMidnight - days * 86400000;
  return { from: new Date(fromIst - IST_OFFSET_MS), to: now };
}

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const range = new URL(req.url).searchParams.get("range") || "7d";
  const { from, to } = rangeBounds(["today", "7d", "30d"].includes(range) ? range : "7d");
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const [restQ, staffCountQ, openSessionsQ, tableCountQ, ordersCountQ, trendQ, busiestQ, sourceQ] = await Promise.all([
    sb.from("restaurants").select("id, name, slug, active"),
    sb.from("staff_users").select("id", { count: "exact", head: true }).eq("active", true),
    sb.from("sessions").select("restaurant_id").eq("status", "open"),
    sb.from("settings").select("restaurant_id, table_count"),
    sb.from("orders").select("id", { count: "exact", head: true }).gte("created_at", fromIso).lt("created_at", toIso),
    sb.rpc("lfh_admin_orders_timeseries", { p_restaurant_id: null, p_from: fromIso, p_to: toIso }),
    sb.rpc("lfh_admin_busiest_restaurants", { p_from: fromIso, p_to: toIso, p_limit: 10 }),
    sb.rpc("lfh_admin_orders_by_source", { p_from: fromIso, p_to: toIso }),
  ]);
  for (const q of [restQ, staffCountQ, openSessionsQ, tableCountQ, ordersCountQ, trendQ, busiestQ, sourceQ]) {
    if (q.error) return NextResponse.json({ error: q.error.message }, { status: 500 });
  }

  const restaurants = restQ.data || [];
  const activeRestaurants = restaurants.filter((r) => r.active).length;
  const totalTables = (tableCountQ.data || []).reduce((s, r) => s + (Number(r.table_count) || 0), 0);
  const openByRid = new Map<string, number>();
  for (const s of openSessionsQ.data || []) {
    if (!s.restaurant_id) continue;
    openByRid.set(s.restaurant_id, (openByRid.get(s.restaurant_id) || 0) + 1);
  }

  const busiest = (busiestQ.data || []).map((r: { restaurant_id: string; slug: string; name: string; orders: number }) => ({
    id: r.restaurant_id, slug: r.slug, name: r.name,
    orders: Number(r.orders) || 0,
    activeTablesNow: openByRid.get(r.restaurant_id) || 0,
  }));

  return NextResponse.json({
    range,
    totals: {
      totalOrders: ordersCountQ.count || 0,
      activeTablesNow: openSessionsQ.data?.length || 0,
      activeRestaurants,
      totalRestaurants: restaurants.length,
      totalStaff: staffCountQ.count || 0,
      totalTables,
    },
    trend: (trendQ.data || []).map((r: { bucket: string; orders: number }) => ({ day: r.bucket, orders: Number(r.orders) || 0 })),
    busiest,
    bySource: (sourceQ.data || []).map((r: { source: string; orders: number }) => ({ source: r.source, orders: Number(r.orders) || 0 })),
  });
}
