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

// Zero-fill the trend so every bucket in the window exists — a day/hour with no
// orders must plot as 0, not vanish (a missing tick compresses the time axis and
// makes the chart lie about gaps). Day keys arrive as 'YYYY-MM-DD' (3-arg RPC
// heritage), hour keys as timestamptz ISO; both are matched by their IST bucket key.
function zeroFill(range: string, from: Date, to: Date, rows: { bucket: string; orders: number }[]): { day: string; orders: number }[] {
  const hourly = range === "today";
  const stepMs = hourly ? 3600000 : 86400000;
  const keyOf = (d: Date) => {
    const ist = new Date(d.getTime() + IST_OFFSET_MS);
    return hourly
      ? ist.toISOString().slice(0, 13) // YYYY-MM-DDTHH (IST)
      : ist.toISOString().slice(0, 10); // YYYY-MM-DD (IST)
  };
  const have = new Map<string, number>();
  for (const r of rows) {
    // The 4-arg RPC returns every bucket as a timestamptz (IST midnight/hour in
    // UTC, e.g. "…T18:30:00Z" for an IST day) — parse it as-is; keyOf applies the
    // IST shift. Only a bare 'YYYY-MM-DD' (3-arg heritage) needs the +05:30 pin.
    const s = String(r.bucket);
    const d = new Date(s.includes("T") ? s : `${s}T00:00:00+05:30`);
    have.set(keyOf(d), (have.get(keyOf(d)) || 0) + (Number(r.orders) || 0));
  }
  const out: { day: string; orders: number }[] = [];
  // Align the cursor to an IST bucket boundary, then walk to `to`.
  const istFrom = new Date(from.getTime() + IST_OFFSET_MS);
  let cur = hourly
    ? Date.UTC(istFrom.getUTCFullYear(), istFrom.getUTCMonth(), istFrom.getUTCDate(), istFrom.getUTCHours())
    : Date.UTC(istFrom.getUTCFullYear(), istFrom.getUTCMonth(), istFrom.getUTCDate());
  const end = to.getTime() + IST_OFFSET_MS;
  for (; cur < end; cur += stepMs) {
    const utc = new Date(cur - IST_OFFSET_MS);
    out.push({ day: hourly ? utc.toISOString() : new Date(cur).toISOString().slice(0, 10), orders: have.get(keyOf(utc)) || 0 });
  }
  return out;
}

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Normalize ONCE up front so an unexpected ?range=<junk> can't leak back out in the
  // response or into zeroFill/bucket (it used to echo the raw string — audit 2026-07-06).
  const rawRange = new URL(req.url).searchParams.get("range") || "7d";
  const range = ["today", "7d", "30d"].includes(rawRange) ? rawRange : "7d";
  const { from, to } = rangeBounds(range);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const [restQ, staffCountQ, openSessionsQ, tableCountQ, ordersCountQ, trendQ, busiestQ, sourceQ] = await Promise.all([
    // Live restaurants only (bug H4, 2026-07-06): binned restaurants must not inflate
    // total/active counts. The busiest-restaurants RPC gets the same guard in mig 130.
    sb.from("restaurants").select("id, name, slug, active").is("deleted_at", null),
    // Fetch active staff's restaurant_id (bounded) so we can DROP staff that belong to a
    // binned restaurant — a head count included them and over-stated "Active staff".
    sb.from("staff_users").select("restaurant_id").eq("active", true).limit(5000),
    sb.from("sessions").select("restaurant_id").eq("status", "open"),
    sb.from("settings").select("restaurant_id, table_count"),
    sb.from("orders").select("id", { count: "exact", head: true }).neq("status", "cancelled").gte("created_at", fromIso).lt("created_at", toIso),
    // Today buckets HOURLY (adaptive time-axis rule — a one-day window ticks by
    // hours, never one flat day bucket); 7d/30d bucket by day. 4-arg overload = mig 129.
    sb.rpc("lfh_admin_orders_timeseries", { p_restaurant_id: null, p_from: fromIso, p_to: toIso, p_bucket: range === "today" ? "hour" : "day" }),
    sb.rpc("lfh_admin_busiest_restaurants", { p_from: fromIso, p_to: toIso, p_limit: 10 }),
    sb.rpc("lfh_admin_orders_by_source", { p_from: fromIso, p_to: toIso }),
  ]);
  for (const q of [restQ, staffCountQ, openSessionsQ, tableCountQ, ordersCountQ, trendQ, busiestQ, sourceQ]) {
    if (q.error) return NextResponse.json({ error: q.error.message }, { status: 500 });
  }

  const restaurants = restQ.data || [];
  const activeRestaurants = restaurants.filter((r) => r.active).length;
  // Only count tables/staff belonging to a LIVE (non-binned) restaurant, so the occupancy
  // denominator and "Active staff" match the restaurant counts beside them (audit 2026-07-06 —
  // a binned restaurant's settings row + staff used to inflate both).
  const liveIds = new Set(restaurants.map((r) => r.id));
  const totalTables = (tableCountQ.data || [])
    .filter((r) => r.restaurant_id && liveIds.has(r.restaurant_id))
    .reduce((s, r) => s + (Number(r.table_count) || 0), 0);
  const totalStaff = (staffCountQ.data || []).filter((u) => u.restaurant_id && liveIds.has(u.restaurant_id)).length;
  const openByRid = new Map<string, number>();
  let activeTablesNow = 0;
  for (const s of openSessionsQ.data || []) {
    if (!s.restaurant_id || !liveIds.has(s.restaurant_id)) continue; // ignore binned restaurants
    openByRid.set(s.restaurant_id, (openByRid.get(s.restaurant_id) || 0) + 1);
    activeTablesNow++;
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
      activeTablesNow,
      activeRestaurants,
      totalRestaurants: restaurants.length,
      totalStaff,
      totalTables,
    },
    bucket: range === "today" ? "hour" : "day",
    trend: zeroFill(range, from, to, trendQ.data || []),
    busiest,
    bySource: (sourceQ.data || []).map((r: { source: string; orders: number }) => ({ source: r.source, orders: Number(r.orders) || 0 })),
  });
}
