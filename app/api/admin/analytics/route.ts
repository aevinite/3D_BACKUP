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
    // v2 → v3 (2026-09-01): the payload gained the "going quiet" comparison. A stored v2 snapshot
    // has no `quiet` field at all, and the fingerprint watches ORDERS, so the new card would sit
    // empty on every cached window until an order happened to land in it. Bumping retires them all
    // on deploy — the same reasoning as the v1 → v2 note below.
    // v1 → v2 (mig 348, 2026-08-20). THE VERSION IN THIS KEY IS NOT DECORATION. The change-detector
    // is an ORDERS fingerprint: it notices a new order, and it cannot notice that the definition of
    // the count changed. So every snapshot stored before mig 348 would have gone on serving the old
    // inflated total — measured on the dev database straight after applying it: the cached 30-day
    // figure read 5,948 while a fresh compute read 5,929 — until an order happened to land in that
    // window, which for a 30-day window could be hours and for an old drilled day is never. Bumping
    // the version retires every stale snapshot the moment this deploys. Any future change to what
    // these numbers MEAN has to bump it again.
    key: `admin:v3:${scopeKeyOf(null, true, [])}:analytics:${drillDay ? `day:${drillDay}` : range}`,
    force,
    fingerprint: () => ordersFingerprint(null, fromIso, toIso),
    compute: () => computeAnalytics(drillDay ? "today" : range, from, to, fromIso, toIso, !!drillDay),
  });
  return NextResponse.json(payload);
}

// WHAT COUNTS AS "GOING QUIET" — the two numbers, in one place, named so they can be argued with.
// A restaurant is flagged only if BOTH hold:
//   · it was genuinely busy before — at least QUIET_MIN_PREV_PER_DAY orders a day in the previous
//     window. Without this floor, a restaurant that does one order a fortnight is "down 100%" every
//     other week and the card becomes noise.
//   · and it has fallen by at least QUIET_DROP of that. 60% is a fall nobody explains away as a
//     quiet week.
// A restaurant that went to ZERO having been busy is flagged as `silent` whatever the percentage,
// because that is the strongest signal on the screen.
const QUIET_MIN_PREV_PER_DAY = 3;
const QUIET_DROP = 0.6;

async function computeAnalytics(range: string, from: Date, to: Date, fromIso: string, toIso: string, hourly = false) {
  // The window immediately BEFORE this one, of exactly the same length, so the comparison is
  // like-for-like (7 days against the previous 7, 30 against the previous 30).
  const spanMs = to.getTime() - from.getTime();
  const windowDays = Math.max(1, Math.round(spanMs / 86400000));
  const quietOn = !hourly && range !== "today" && windowDays >= 2;
  const prevFromIso = new Date(from.getTime() - spanMs).toISOString();

  const [restQ, staffCountQ, openSessionsQ, tableCountQ, ordersCountQ, trendQ, busiestQ, sourceQ, prevQ] = await Promise.all([
    // Live restaurants only (bug H4, 2026-07-06): binned restaurants must not inflate
    // total/active counts. The busiest-restaurants RPC gets the same guard in mig 130.
    sb.from("restaurants").select("id, name, slug, active").is("deleted_at", null).limit(2000),
    // Fetch active staff's restaurant_id (bounded) so we can DROP staff that belong to a
    // binned restaurant — a head count included them and over-stated "Active staff".
    sb.from("staff_users").select("restaurant_id").eq("active", true).limit(5000),
    sb.from("sessions").select("restaurant_id").eq("status", "open").limit(20000),
    sb.from("settings").select("restaurant_id, table_count").limit(2000),
    // THE TILE MUST EQUAL THE LIST UNDER IT (mig 348, 2026-08-20). This was a plain head count
    // over `orders` with no restaurant test, while `lfh_admin_busiest_restaurants` right below has
    // excluded binned restaurants since mig 135 — so the "ORDERS · LAST 30 DAYS" tile read 6,260
    // above a table that added up to 6,116, and the missing 144 belonged to two restaurants in the
    // recycle bin. The RPC applies the same live-restaurant test the busiest list uses, so the two
    // now agree by construction instead of by two people remembering the same rule. The trend and
    // by-source RPCs below carry the identical guard in the same migration.
    sb.rpc("lfh_admin_orders_count", { p_from: fromIso, p_to: toIso }),
    // Today buckets HOURLY (adaptive time-axis rule — a one-day window ticks by
    // hours, never one flat day bucket); 7d/30d bucket by day. 4-arg overload = mig 129.
    sb.rpc("lfh_admin_orders_timeseries", { p_restaurant_id: null, p_from: fromIso, p_to: toIso, p_bucket: hourly || range === "today" ? "hour" : "day" }),
    // p_limit 2000, not 10: the SAME rows feed the "going quiet" comparison below, which needs
    // every live restaurant — a restaurant that fell to zero orders would not be in a top-10 list
    // at all, which is exactly the one we most need to see. The RPC is a LEFT JOIN from
    // `restaurants`, so a restaurant with no orders comes back with 0 rather than going missing.
    // Sliced back to 10 for the `busiest` card, so the payload that card reads is unchanged.
    sb.rpc("lfh_admin_busiest_restaurants", { p_from: fromIso, p_to: toIso, p_limit: 2000 }),
    sb.rpc("lfh_admin_orders_by_source", { p_from: fromIso, p_to: toIso }),
    // ── THE PREVIOUS WINDOW OF THE SAME LENGTH — for "which restaurants are going quiet?" ──────
    // The one number a platform owner needs that this screen never had: the busiest list is a
    // CROSS-SECTION (every restaurant against the others, in one window). It can never show that a
    // restaurant used to do 40 orders a day and now does 3, which is the shape of a restaurant
    // about to stop paying.
    //
    // EGRESS: this is ONE more grouped aggregate — the same RPC, the same index on
    // orders(created_at), just earlier bounds. No raw-orders read, no new migration, no new index,
    // and it sits inside the snapshot cache with everything else on this route, so it computes when
    // the orders fingerprint moves and not once per open tab.
    //
    // Skipped entirely for `today` and for a drilled day: comparing today against yesterday, or
    // one Tuesday against one Monday, is noise, and a warning that cries wolf gets ignored. Those
    // windows return quiet: null and the card says a longer window is needed.
    quietOn
      ? sb.rpc("lfh_admin_busiest_restaurants", { p_from: prevFromIso, p_to: fromIso, p_limit: 2000 })
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const q of [restQ, staffCountQ, openSessionsQ, tableCountQ, ordersCountQ, trendQ, busiestQ, sourceQ, prevQ]) {
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

  const allNow = (busiestQ.data || []) as { restaurant_id: string; slug: string; name: string; orders: number }[];
  const busiest = allNow.slice(0, 10).map((r) => ({
    id: r.restaurant_id, slug: r.slug, name: r.name,
    orders: Number(r.orders) || 0,
    activeTablesNow: openByRid.get(r.restaurant_id) || 0,
  }));

  // ── WHICH RESTAURANTS ARE GOING QUIET? ───────────────────────────────────────────────────────
  // Each restaurant against ITS OWN previous window, never against the others. Only live
  // restaurants appear (the RPC already excludes binned ones, mig 135/348).
  let quiet: { id: string; slug: string; name: string; now: number; before: number; dropPct: number; silent: boolean }[] | null = null;
  if (quietOn && prevQ.data) {
    const beforeByRid = new Map<string, number>();
    for (const r of prevQ.data as { restaurant_id: string; orders: number }[]) {
      beforeByRid.set(r.restaurant_id, Number(r.orders) || 0);
    }
    quiet = allNow
      .map((r) => {
        const now = Number(r.orders) || 0;
        const before = beforeByRid.get(r.restaurant_id) ?? 0;
        return {
          id: r.restaurant_id, slug: r.slug, name: r.name, now, before,
          // A restaurant with 2,115 orders that now has 1 is down 99.95%, and Math.round made that
          // read "down 100%" beside rows that genuinely have none — the same "a number that says
          // more than it knows" fault as items 17-19. Capped at 99 while any order remains, so
          // 100% can only ever mean zero, and `silent` is what actually says zero.
          dropPct: before > 0 ? Math.min(now > 0 ? 99 : 100, Math.round(((before - now) / before) * 100)) : 0,
          silent: now === 0 && before > 0,
        };
      })
      .filter((r) => r.before / windowDays >= QUIET_MIN_PREV_PER_DAY && (r.silent || r.dropPct >= QUIET_DROP * 100))
      // Gone-silent first, then by how far it fell — the order someone would want to read them in.
      .sort((a, b) => Number(b.silent) - Number(a.silent) || b.dropPct - a.dropPct || b.before - a.before);
  }

  return {
    range,
    totals: {
      // `.data` now, not `.count` — the RPC returns the number itself (mig 348).
      totalOrders: Number(ordersCountQ.data) || 0,
      activeTablesNow,
      activeRestaurants,
      totalRestaurants: restaurants.length,
      totalStaff,
      totalTables,
    },
    bucket: range === "today" ? "hour" : "day",
    trend: zeroFill(range, from, to, trendQ.data || []),
    busiest,
    // null (not []) when the window is too short to compare — the card must be able to tell
    // "nothing is going quiet" apart from "I cannot answer that for one day".
    quiet,
    quietWindowDays: quietOn ? windowDays : null,
    quietMinPerDay: QUIET_MIN_PREV_PER_DAY,
    quietDropPct: Math.round(QUIET_DROP * 100),
    bySource: (sourceQ.data || []).map((r: { source: string; orders: number }) => ({ source: r.source, orders: Number(r.orders) || 0 })),
  };
}
