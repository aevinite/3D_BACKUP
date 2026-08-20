// GET /api/admin/analytics?range=today|7d|30d — the Platform Analytics page.
// Cross-restaurant OPERATIONAL analytics only — NO food revenue anywhere (CLAUDE.md
// hard rule: restaurant earnings are owner-panel-only). Everything here is a COUNT.
// Aggregated server-side: the two grouped breakdowns (trend + busiest + source) run
// as ONE Postgres RPC each (migration 119) — never a raw-orders fetch to the client.
// Admin-gated (same staff cookie as every other /api/admin/* route).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { businessDayStartIso } from "@/lib/businessDay";
import { cachedOwnerPayload, ordersFingerprint, scopeKeyOf } from "@/lib/ownerCache";

export const dynamic = "force-dynamic";
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Day-aligned (Asia/Kolkata) [from, to) bounds for the three range presets —
// matches the bucketing the RPCs use (date_trunc('day', … AT TIME ZONE 'Asia/Kolkata')).
function rangeBounds(range: string): { from: Date; to: Date } {
  const now = new Date();
  // "today" starts at the 05:00-IST business-day rollover — the SAME boundary the Dashboard
  // (/api/admin/dashboard) and the Live-floor RPC use, so "Orders today" can't disagree
  // between screens for orders placed 00:00–05:00 IST (audit 2026-07-07). Multi-day ranges
  // stay day-aligned (their buckets are whole IST days anyway).
  if (range === "today") return { from: new Date(businessDayStartIso(now)), to: now };
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const istMidnight = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());
  const days = range === "30d" ? 29 : 6;
  const fromIst = istMidnight - days * 86400000;
  return { from: new Date(fromIst - IST_OFFSET_MS), to: now };
}

// Zero-fill the trend so every bucket in the window exists — a day/hour with no
// orders must plot as 0, not vanish (a missing tick compresses the time axis and
// makes the chart lie about gaps). Day keys arrive as 'YYYY-MM-DD' (3-arg RPC
// heritage), hour keys as timestamptz ISO; both are matched by their IST bucket key.
// The UTC bounds of ONE IST calendar day — used by the ?day= drill so its buckets line up with
// the day buckets the trend just handed the page (both are whole IST days).
function istDayBounds(ymd: string): { from: Date; to: Date } {
  const startIst = Date.parse(`${ymd}T00:00:00+05:30`);
  return { from: new Date(startIst), to: new Date(startIst + 86400000) };
}

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
  // ?day=YYYY-MM-DD — the DRILL (lib/timeView.ts). When a window's orders are all piled into one
  // day, the page asks for that ONE day back, bucketed by hour, instead of plotting a chart that
  // is 90% empty columns. Deliberately cheap and scoped: the SAME RPC as the trend, just a
  // narrower from/to and p_bucket:'hour' — 24 rows for one IST day on an indexed created_at, not
  // a second read of anything. Validated to a strict date so a junk value can never widen the
  // window or echo back out (the same lesson as ?range= above).
  const rawDay = new URL(req.url).searchParams.get("day") || "";
  const drillDay = /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : "";
  const { from, to } = drillDay ? istDayBounds(drillDay) : rangeBounds(range);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  // ?refresh=1 — the page's ↻ button asks for the live value and waits for it.
  const force = new URL(req.url).searchParams.get("refresh") === "1";

  // THROUGH THE SNAPSHOT CACHE (2026-08-04). CLAUDE.md: "Any owner/ADMIN dashboard, report, or
  // analytics number that comes from an aggregate query must be served through the compute-on-view
  // snapshot cache, never recomputed on every open. This is now the DEFAULT for every such
  // feature." This route was recomputing three platform-WIDE aggregates on every request —
  // measured 907 ms on the deployed backup — with no cachedAt, so the page could not even say how
  // old its numbers were, and `useActiveAutoRefresh` re-ran the lot about once a minute per open
  // tab. That is exactly the "handful of expensive reads landing together" shape that took the
  // database down on 2026-07-31.
  //
  // The scope is the whole platform, which the engine already has a key for (scopeKeyOf(null,
  // true, [])), and the change-detector is the same cheap orders fingerprint the owner reports
  // use — with ids = null meaning "every restaurant", so a single order anywhere refreshes it.
  const payload = await cachedOwnerPayload({
    key: `admin:v1:${scopeKeyOf(null, true, [])}:analytics:${drillDay ? `day:${drillDay}` : range}`,
    force,
    fingerprint: () => ordersFingerprint(null, fromIso, toIso),
    compute: () => computeAnalytics(drillDay ? "today" : range, from, to, fromIso, toIso, !!drillDay),
  });
  return NextResponse.json(payload);
}

async function computeAnalytics(range: string, from: Date, to: Date, fromIso: string, toIso: string, hourly = false) {
  const [restQ, staffCountQ, openSessionsQ, tableCountQ, ordersCountQ, trendQ, busiestQ, sourceQ] = await Promise.all([
    // Live restaurants only (bug H4, 2026-07-06): binned restaurants must not inflate
    // total/active counts. The busiest-restaurants RPC gets the same guard in mig 130.
    sb.from("restaurants").select("id, name, slug, active").is("deleted_at", null).limit(2000),
    // Fetch active staff's restaurant_id (bounded) so we can DROP staff that belong to a
    // binned restaurant — a head count included them and over-stated "Active staff".
    sb.from("staff_users").select("restaurant_id").eq("active", true).limit(5000),
    sb.from("sessions").select("restaurant_id").eq("status", "open").limit(20000),
    sb.from("settings").select("restaurant_id, table_count").limit(2000),
    sb.from("orders").select("id", { count: "exact", head: true }).neq("status", "cancelled").gte("created_at", fromIso).lt("created_at", toIso),
    // Today buckets HOURLY (adaptive time-axis rule — a one-day window ticks by
    // hours, never one flat day bucket); 7d/30d bucket by day. 4-arg overload = mig 129.
    sb.rpc("lfh_admin_orders_timeseries", { p_restaurant_id: null, p_from: fromIso, p_to: toIso, p_bucket: hourly || range === "today" ? "hour" : "day" }),
    sb.rpc("lfh_admin_busiest_restaurants", { p_from: fromIso, p_to: toIso, p_limit: 10 }),
    sb.rpc("lfh_admin_orders_by_source", { p_from: fromIso, p_to: toIso }),
  ]);
  for (const q of [restQ, staffCountQ, openSessionsQ, tableCountQ, ordersCountQ, trendQ, busiestQ, sourceQ]) {
    // THROWN, not returned as a response: this is the cache's `compute`, and it must fail loudly
    // so nothing half-built is ever stored under the key. cachedOwnerPayload lets a sync failure
    // reach the caller and swallows a background one (the stale value already shipped).
    if (q.error) throw new Error(q.error.message);
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

  return {
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
  };
}
