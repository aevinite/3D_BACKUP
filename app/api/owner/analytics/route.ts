// GET /api/owner/analytics — drill-down data for the owner dashboard charts.
//   ?range=today|yesterday|7d|30d|all  (window; default today)
//   &rid=<uuid>              (optional: restaurant scope; omit = group scope)
//
// Group scope  → { scope:'group', restaurantRevenue[], timeseries[] }
// Restaurant   → { scope:'restaurant', restaurant{}, kpis{}, timeseries[], dishes[], categories[], hourly[] }
//
// All aggregation is server-side via the lfh_owner_* RPCs (migration 089) — one
// round-trip per chart, tiny pre-summed rows, never order scanning in JS. Service-
// role only, behind the ADMIN_PASSWORD cookie gate (same as /api/owner/overview).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScope } from "@/lib/ownerScope";
import { cachedOwnerPayload, scopeKeyOf, ordersFingerprint } from "@/lib/ownerCache";
import { entitledSubset } from "@/lib/ownerEntitlements";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

// The busy-hours heatmap is a RECENCY pattern, and its aggregate is the one analytics
// query that times out on a huge window (the "All time" range = 2020→now made it hit the
// statement timeout, 500'd the WHOLE dashboard — every other query is fine). Bound it to
// the last ~90 days regardless of the selected range, never earlier than the range's own
// start. A 90-day busy-hours grid is fully representative; all-time was never meaningful.
const HEAT_MAX_DAYS = 90;
// Clamp the heatmap window to the last ~90 days OF THE SELECTED WINDOW — anchored to the
// window's own END (`to`), NOT wall-clock now. Anchoring to now would invert the window
// (from > to) for a historical range — e.g. the dashboard's "most recent week with
// activity" fallback for a restaurant quiet >90 days — and blank the very grid it's meant
// to fill. For today/7d/30d/month/all, `to ≈ now`, so this is identical to now-90d.
function heatFrom(from: string, to: string): string {
  return new Date(Math.max(Date.parse(from), Date.parse(to) - HEAT_MAX_DAYS * DAY)).toISOString();
}
// Window for a range. "today" = since 05:00 IST business-day start (matches the
// counters + lfh_owner_overview). Others are rolling windows ending now.
function windowFor(range: string, sp?: URLSearchParams): { from: string; to: string; bucket: string } {
  const now = Date.now();
  const to = new Date(now).toISOString();
  if (range === "all") return { from: "2020-01-01T00:00:00Z", to, bucket: "day" };
  // custom: exact IST day range from the report dialog (owner round-4: "from which
  // to which date you want the report"). Inclusive dates; bad input → 30d fallback.
  if (range === "custom" && sp) {
    const f = sp.get("from"), t2 = sp.get("to");
    const ok = (x: string | null) => !!x && /^\d{4}-\d{2}-\d{2}$/.test(x);
    if (ok(f) && ok(t2)) {
      const pf = Date.parse(f + "T00:00:00+05:30");
      const pt = Math.min(Date.parse(t2 + "T00:00:00+05:30") + DAY, now);
      if (Number.isFinite(pf) && pt > pf) {
        return { from: new Date(pf).toISOString(), to: new Date(pt).toISOString(), bucket: pt - pf > 3 * DAY ? "day" : "hour" };
      }
    }
    return windowFor("30d");
  }
  // whole IST months (mirrors the reports route)
  if (range === "month" || range === "lastmonth") {
    const istNow = new Date(now + 5.5 * 3600_000);
    const y = istNow.getUTCFullYear(), m = istNow.getUTCMonth();
    const start = (yy: number, mm: number) => Date.UTC(yy, mm, 1) - 5.5 * 3600_000;
    if (range === "month") return { from: new Date(start(y, m)).toISOString(), to, bucket: "day" };
    return { from: new Date(start(y, m - 1)).toISOString(), to: new Date(start(y, m)).toISOString(), bucket: "day" };
  }
  // 7d / 30d: EXACTLY N whole IST calendar days ending today (inclusive), aligned to
  // 00:00 IST. A rolling now−N×24h window instead spilled into a partial (N+1)th IST
  // day whose day-bucket the client's whole-day zero-filled axis drops — so the chart
  // total came out LESS than the KPI above it (bug, 2026-07-06). Aligning the window to
  // the same IST day boundaries the client plots makes chart sum == KPI by construction.
  if (range === "7d" || range === "30d") {
    const n = range === "7d" ? 7 : 30;
    const istNow = new Date(now + 5.5 * 3600_000);
    const istMidnightToday = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - 5.5 * 3600_000;
    return { from: new Date(istMidnightToday - (n - 1) * DAY).toISOString(), to, bucket: "day" };
  }
  // today's 05:00 IST business-day start (shift to IST, step back 5h, floor to the day).
  const biz = new Date(now + 5.5 * 3600_000 - 5 * 3600_000);
  const todayStart = Date.UTC(biz.getUTCFullYear(), biz.getUTCMonth(), biz.getUTCDate(), 5, 0, 0) - 5.5 * 3600_000;
  // yesterday: the full previous business day [yesterday 05:00 IST, today 05:00 IST).
  if (range === "yesterday") return { from: new Date(todayStart - DAY).toISOString(), to: new Date(todayStart).toISOString(), bucket: "hour" };
  // today (default): 05:00 IST business-day start → now.
  return { from: new Date(todayStart).toISOString(), to, bucket: "hour" };
}

// The previous EQUAL-LENGTH window, for the KPI ▲/▼ delta chips ("today" compares
// against the same span of yesterday's business day, 7d against the 7 days before,
// …). "all" has no previous period — the chips just don't render.
function prevWindowFor(range: string, from: string, to: string): { from: string; to: string } | null {
  if (range === "all") return null;
  const f = Date.parse(from), t = Date.parse(to);
  const span = t - f;
  if (range === "today") {
    // same-time-yesterday, so a 11:00 check compares mornings, not a whole day.
    return { from: new Date(f - DAY).toISOString(), to: new Date(f - DAY + span).toISOString() };
  }
  return { from: new Date(f - span).toISOString(), to: new Date(f).toISOString() };
}

const num = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

// Paid revenue + orders summed over a window (tiny pre-summed rows), scoped to
// the caller's restaurants — ONE extra RPC per dashboard load when compare=1.
// p_ids pushes the scope INTO the DB (mig 138) so we never sum the whole platform
// just to keep one owner's delta (the cost bomb this fixed). NULL = all (admin).
async function windowTotals(pIds: string[] | null, from: string, to: string) {
  const rev = await sb.rpc("lfh_owner_restaurant_revenue", { p_from: from, p_to: to, p_ids: pIds });
  if (rev.error) throw rev.error;
  let revenue = 0, orders = 0;
  for (const r of (rev.data ?? []) as Record<string, unknown>[]) {
    revenue += Number(r.revenue) || 0;
    orders += Number(r.orders) || 0;
  }
  return { revenue: num(revenue), orders };
}

export async function GET(req: NextRequest) {
  const scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const range = sp.get("range") || "today";
  const rid = sp.get("rid");
  const compare = sp.get("compare") === "1";
  // All-time "records" (lfh_owner_records) is an UNBOUNDED scan of the restaurant's whole
  // order history — cheap to run once, wasteful every 60s. The client asks for it only on
  // first load / range change (&records=1) and keeps its last value across auto-refreshes,
  // so the polled path no longer re-scans all-time bests each minute (audit 2026-07-07).
  const wantRecords = sp.get("records") === "1";
  // Per-restaurant privacy (mig 133, Stage 7): revenue/analytics IS the "reports" section —
  // a REAL owner only sees it for restaurants whose "reports" the admin still grants. Ungranted
  // restaurants are dropped (zero data, no leak). Admin (scope.all / scope.admin) is never gated.
  if (!scope.all && !scope.admin) {
    const allowed = await entitledSubset(scope.ids, "reports");
    if (rid && !allowed.includes(rid)) return NextResponse.json({ error: "Reports aren't enabled for this restaurant — contact Aevidine.", disabled: true }, { status: 403 });
    if (!allowed.length) return NextResponse.json({ error: "Reports aren't enabled for your restaurant — contact Aevidine.", disabled: true }, { status: 403 });
    scope.ids = allowed;
  }
  const { from, to, bucket } = windowFor(range, sp);
  // cache keys must distinguish two different custom windows
  const rangeKey = range === "custom" ? `custom:${sp.get("from")}:${sp.get("to")}` : range;
  const prevWin = compare ? prevWindowFor(range, from, to) : null;

  try {
    if (!rid) {
      // Group scope — the "who earns more" bar + multi-line trend. Compute-on-view cached
      // (mig 196): a normal home open serves the stored JSON instantly; the Refresh button
      // (?refresh=1) forces a live recompute. Keyed by the already-authorized scope.
      const gIds = scope.all ? [] : scope.ids;
      const groupPayload = await cachedOwnerPayload({
        // v2: payload gained `heatmap` (mig 197); v3: gained `categories` — each shape
        // change bumps the version so stale snapshots can't serve field-less JSON
        // verbatim until their fingerprint happens to change (found 2026-07-26).
        key: `analytics:v4:group:${scopeKeyOf(null, scope.all, gIds)}:${rangeKey}:c${compare ? 1 : 0}`,
        force: sp.get("refresh") === "1",
        fingerprint: () => ordersFingerprint(scope.all ? null : gIds, from, to),
        compute: async () => {
      const allow = scope.all ? null : new Set(scope.ids);
      const pIds = scope.all ? null : scope.ids; // DB-side scope (mig 138) — no whole-platform scan
      // Speed (owner round-5): every independent read starts NOW and runs concurrently —
      // the payment/category per-restaurant fan-outs and the prev-window totals used to
      // wait for the base block, serialising 3 extra round-trips into the compute time.
      const pmIds: (string | null)[] = scope.all ? [null] : scope.ids;
      const pmP = Promise.all(pmIds.map((id) => sb.rpc("lfh_owner_payment_breakdown", { p_restaurant_id: id, p_from: from, p_to: to })));
      const catScopedP = scope.all ? null : Promise.all(scope.ids.map((id) => sb.rpc("lfh_owner_category_breakdown", { p_restaurant_id: id, p_from: from, p_to: to })));
      const prevP = prevWin ? windowTotals(pIds, prevWin.from, prevWin.to) : Promise.resolve(null);
      const [rev, ts, heat] = await Promise.all([
        sb.rpc("lfh_owner_restaurant_revenue", { p_from: from, p_to: to, p_ids: pIds }),
        sb.rpc("lfh_owner_revenue_timeseries", { p_restaurant_id: null, p_from: from, p_to: to, p_bucket: bucket, p_ids: pIds }),
        // Busy heatmap (mig 197): one ≤7×24 pre-summed grid across the caller's own
        // restaurants — p_ids pushes the scope into the DB, same rule as the calls above.
        sb.rpc("lfh_owner_heatmap", { p_restaurant_id: null, p_from: heatFrom(from, to), p_to: to, p_ids: pIds }),
      ]);
      if (rev.error) throw rev.error;
      if (ts.error) throw ts.error;
      // Heatmap is NON-FATAL: a slow/failed busy-hours grid must never wedge the whole
      // dashboard (it did on "All time"). On error, `heat.data ?? []` below yields an empty
      // grid and every other number/chart still renders.
      // An owner only ever sees their OWN restaurants; admin sees all. These RPCs
      // return one row per restaurant, so we filter the tiny pre-summed rows here.
      const restaurantRevenue = (rev.data ?? [])
        .filter((r: Record<string, unknown>) => !allow || allow.has(r.restaurant_id as string))
        .map((r: Record<string, unknown>) => ({
          id: r.restaurant_id, slug: r.slug, name: r.name, accentColor: (r.accent_color as string) || "#e3c06f",
          revenue: num(r.revenue), orders: Number(r.orders) || 0,
        }));
      const timeseries = (ts.data ?? [])
        .filter((r: Record<string, unknown>) => !allow || allow.has(r.restaurant_id as string))
        .map((r: Record<string, unknown>) => ({
          bucket: r.bucket, restaurantId: r.restaurant_id, revenue: num(r.revenue), orders: Number(r.orders) || 0,
        }));
      // Payment breakdown: lfh_owner_payment_breakdown(NULL) sums PLATFORM-WIDE and its
      // rows carry no restaurant_id, so it CANNOT be post-filtered — passing NULL for a
      // scoped owner leaks every other tenant's payment totals (cross-tenant leak, found
      // + fixed 2026-07-04). Admin (scope.all) may sum all; a scoped owner sums ONLY
      // their own restaurants (one tiny call each) and we merge by method.
      const pmByMethod = new Map<string, { method: string; revenue: number; orders: number }>();
      const pmRes = await pmP;
      for (const r of pmRes) {
        if (r.error) throw r.error;
        for (const row of (r.data ?? []) as Record<string, unknown>[]) {
          const m = String(row.method ?? "");
          const cur = pmByMethod.get(m) || { method: m, revenue: 0, orders: 0 };
          cur.revenue = num(cur.revenue + (Number(row.revenue) || 0));
          cur.orders += Number(row.orders) || 0;
          pmByMethod.set(m, cur);
        }
      }
      const paymentMethods = Array.from(pmByMethod.values()).sort((a, b) => b.revenue - a.revenue);
      // Category split across the group (round-2: the owner wants "Revenue by category"
      // on the multi home too). lfh_owner_category_breakdown is per-restaurant, so —
      // exactly like the payment breakdown above — a scoped owner sums their own
      // restaurants (one tiny pre-summed call each) and we merge by category name.
      // scope.all (admin) merges across every restaurant id from the revenue rows.
      const catByName = new Map<string, { category: string; qty: number; revenue: number }>();
      // scoped owners: already in flight; admin all-view needs the rev rows to know the ids
      const catRes = catScopedP ? await catScopedP : await Promise.all(
        ((rev.data ?? []).map((r: Record<string, unknown>) => r.restaurant_id as string))
          .map((id: string) => sb.rpc("lfh_owner_category_breakdown", { p_restaurant_id: id, p_from: from, p_to: to })));
      for (const r of catRes) {
        if (r.error) throw r.error;
        for (const row of (r.data ?? []) as Record<string, unknown>[]) {
          const c = String(row.category ?? "Other");
          const cur = catByName.get(c) || { category: c, qty: 0, revenue: 0 };
          cur.qty += Number(row.qty) || 0;
          cur.revenue = num(cur.revenue + (Number(row.revenue) || 0));
          catByName.set(c, cur);
        }
      }
      const categories = Array.from(catByName.values()).sort((a, b) => b.revenue - a.revenue);
      const prev = await prevP;
      const heatmap = ((heat.data ?? []) as Record<string, unknown>[]).map((r) => ({
        dow: Number(r.dow) || 0, hr: Number(r.hr) || 0, orders: Number(r.orders) || 0, revenue: num(r.revenue),
      }));
      return { scope: "group", range, restaurantRevenue, timeseries, paymentMethods, categories, heatmap, prev };
        },
      });
      return NextResponse.json(groupPayload);
    }

    // Restaurant scope — KPIs + per-dish/category/hourly + this restaurant's trend.
    // An owner may only drill into a restaurant they actually own.
    if (!scope.all && !scope.ids.includes(rid)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    // Crazy-dashboard extras (mig 127, all rid-scoped + pre-summed):
    //  · sameHour — this window vs 3 older windows, ALL cut at the same elapsed
    //    time ("today till 5pm" vs "last Sat till 5pm"): the honest comparison.
    //  · payTrend — payment-method ₹ per IST day over the last 14 days.
    //  · records — all-time bests (one JSONB row, on-demand only).
    const fromMs = Date.parse(from);
    const elapsedMs = Math.max(60_000, Math.min(Date.parse(to), Date.now()) - fromMs);
    // Comparison window starts must never overlap the current window: day ranges
    // step back 1 day / 1 week / 4 weeks (weekday-matched); 7d steps whole weeks;
    // 30d steps whole 30-day blocks.
    const stepsBack = range === "7d" ? [7, 14, 28] : range === "30d" ? [30, 60, 90] : [1, 7, 28];
    const sameHourStarts = range === "all" ? [] : [
      new Date(fromMs).toISOString(),
      ...stepsBack.map((d) => new Date(fromMs - d * DAY).toISOString()),
    ];
    // Compute-on-view cached like the group scope (owner round-3: "auto calculate…
    // it should show number only, very fast — the live site is already optimized").
    // LIVE bits stay OUTSIDE the cache: open-tables (a now-count) and the unbounded
    // all-time records (fetched once per restaurant on demand).
    const restBase = await cachedOwnerPayload({
      key: `analytics:v4:rest:${rid}:${rangeKey}:c${compare ? 1 : 0}`,
      force: sp.get("refresh") === "1",
      fingerprint: () => ordersFingerprint([rid], from, to),
      compute: async () => {
    const [meta, ts, dishes, cats, hourly, heat, pm, sameHour, payTrend] = await Promise.all([
      sb.from("restaurants").select("id, slug, name, accent_color, hero_title").eq("id", rid).maybeSingle(),
      sb.rpc("lfh_owner_revenue_timeseries", { p_restaurant_id: rid, p_from: from, p_to: to, p_bucket: bucket }),
      sb.rpc("lfh_owner_dish_breakdown", { p_restaurant_id: rid, p_from: from, p_to: to }),
      sb.rpc("lfh_owner_category_breakdown", { p_restaurant_id: rid, p_from: from, p_to: to }),
      sb.rpc("lfh_owner_hourly", { p_restaurant_id: rid, p_from: from, p_to: to }),
      sb.rpc("lfh_owner_heatmap", { p_restaurant_id: rid, p_from: heatFrom(from, to), p_to: to }),
      sb.rpc("lfh_owner_payment_breakdown", { p_restaurant_id: rid, p_from: from, p_to: to }),
      sameHourStarts.length
        ? sb.rpc("lfh_owner_samehour_compare", { p_restaurant_id: rid, p_starts: sameHourStarts, p_elapsed: `${Math.round(elapsedMs / 1000)} seconds` })
        : Promise.resolve({ data: [], error: null }),
      sb.rpc("lfh_owner_payment_trend", { p_restaurant_id: rid, p_from: new Date(Date.now() - 14 * DAY).toISOString(), p_to: to }),
    ]);
    if (meta.error) throw meta.error;
    if (!meta.data) throw new Error("restaurant not found");
    // `heat` is deliberately EXCLUDED — the heatmap is non-fatal (see heatFrom): its error
    // must not throw, or one slow busy-hours grid wedges the whole dashboard. `heat.data ?? []`
    // below degrades to an empty grid.
    for (const e of [ts, dishes, cats, hourly, pm, sameHour, payTrend]) if (e.error) throw e.error;

    const dishRows = (dishes.data ?? []).map((r: Record<string, unknown>) => ({
      title: r.title, qty: Number(r.qty) || 0, revenue: num(r.revenue),
    }));
    const tsRows = (ts.data ?? []).map((r: Record<string, unknown>) => ({
      bucket: r.bucket, revenue: num(r.revenue), orders: Number(r.orders) || 0,
    }));
    const revenue = num(tsRows.reduce((a: number, r: { revenue: number }) => a + r.revenue, 0));
    const orders = tsRows.reduce((a: number, r: { orders: number }) => a + r.orders, 0);
    void 0; // (kept structure below unchanged — still inside the cached compute)
    // Avg order = PAID revenue ÷ PAID order count (both from paid-only sources). `orders` above
    // counts ALL non-cancelled orders (incl. open/unpaid), so revenue/orders understated the
    // average and made it drift UPWARD as open tables settled with no new orders. paid-count
    // comes from the payment breakdown (already fetched, WHERE payment_status='paid'). (owner 2026-07-06)
    const paidOrders = (pm.data ?? []).reduce((a: number, r: Record<string, unknown>) => a + (Number(r.orders) || 0), 0);
    const prev = prevWin ? await windowTotals([rid], prevWin.from, prevWin.to) : null;

    // `orders` counts ALL non-cancelled (incl. open/unpaid) while revenue+avgOrder are
    // PAID-only — so Revenue ÷ Orders ≠ Avg order and looks like a wrong number. Ship
    // `paidOrders` too so the dashboard can label the tile honestly (owner audit 2026-07-06).
    return {
      scope: "restaurant", range, prev,
      restaurant: { id: meta.data.id, slug: meta.data.slug, name: meta.data.name, accentColor: meta.data.accent_color || "#e3c06f", heroTitle: meta.data.hero_title || "" },
      kpis: { revenue, orders, paidOrders, avgOrder: paidOrders ? num(revenue / paidOrders) : 0, openTables: 0, topDish: dishRows[0]?.title || "—" },
      timeseries: tsRows,
      dishes: dishRows,
      categories: (cats.data ?? []).map((r: Record<string, unknown>) => ({ category: r.category, qty: Number(r.qty) || 0, revenue: num(r.revenue) })),
      hourly: (hourly.data ?? []).map((r: Record<string, unknown>) => ({ hour: Number(r.hour) || 0, orders: Number(r.orders) || 0, revenue: num(r.revenue) })),
      heatmap: ((heat.data ?? []) as Record<string, unknown>[]).map((r) => ({ dow: Number(r.dow) || 0, hr: Number(r.hr) || 0, orders: Number(r.orders) || 0, revenue: num(r.revenue) })),
      paymentMethods: (pm.data ?? []).map((r: Record<string, unknown>) => ({ method: r.method, revenue: num(r.revenue), orders: Number(r.orders) || 0 })),
      // sameHour rows come back newest-first (window_start DESC) = the order we sent.
      sameHour: ((sameHour.data ?? []) as Record<string, unknown>[]).map((r) => ({
        start: r.window_start, revenue: num(r.revenue), orders: Number(r.orders) || 0,
      })),
      payTrend: ((payTrend.data ?? []) as Record<string, unknown>[]).map((r) => ({
        day: r.day, method: String(r.method || "Not recorded"), revenue: num(r.revenue),
      })),
    };
      },
    });

    // LIVE add-ons, outside the cache: the open-tables now-count (must never freeze)
    // and the on-demand all-time records (unbounded scan, once per restaurant).
    const openT = await sb.from("sessions").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).eq("status", "open");
    const kpis = { ...(restBase as { kpis: Record<string, unknown> }).kpis, openTables: openT.count || 0 };
    let records: unknown = null;
    if (wantRecords) {
      const r = await sb.rpc("lfh_owner_records", { p_restaurant_id: rid });
      if (!r.error) records = r.data ?? null;
    }
    return NextResponse.json({ ...restBase, kpis, records });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
