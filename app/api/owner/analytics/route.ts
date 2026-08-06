// GET /api/owner/analytics — drill-down data for the owner dashboard charts.
//   ?range=today|yesterday|7d|30d|all  (window; default today)
//   &rid=<uuid>              (optional: restaurant scope; omit = group scope)
//
// Group scope  → { scope:'group', restaurantRevenue[], timeseries[] }
// Restaurant   → { scope:'restaurant', restaurant{}, kpis{}, timeseries[], dishes[], categories[], hourly[] }
//
// All aggregation is server-side via the lfh_owner_* RPCs (migration 089) — one
// round-trip per chart, tiny pre-summed rows, never order scanning in JS.
//
// AUTH: ownerScope() (lib/ownerScope.ts) — a real OWNER sees only the restaurants they own, the
// ADMIN super-user sees all, everyone else gets 401, and a real owner is further narrowed to the
// restaurants whose "reports" section the admin still grants (the entitledSubset call below).
// (This header used to say "Service-role only, behind the ADMIN_PASSWORD cookie gate (same as
// /api/owner/overview)". That was wrong on both counts and had been for months: the gate is
// ownerScope, which is a different rule with different consequences for a real owner. Its twin in
// /api/owner/overview was corrected in the 2026-08-05 sweep and this copy was missed — so the
// comment pointed at a file that contradicted it, which is exactly what makes the next reader "fix"
// the wrong thing. Corrected in the T9 sweep, 2026-08-06.)
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScope, scopedRestaurantIds, dbFail } from "@/lib/ownerScope";
import { cachedOwnerPayload, scopeKeyOf, ordersFingerprint, reportMonthFingerprint } from "@/lib/ownerCache";
import { payrollEffectiveByRid } from "@/lib/tableTags";
import { istDateOf } from "@/lib/staffProfileShared";
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
  // this calendar week: Monday 00:00 IST → now, day buckets (owner 2026-07-27:
  // "make option like … this week"). Mirrors the whole-IST-month logic above.
  if (range === "week") {
    const istNow = new Date(now + 5.5 * 3600_000);
    const dow = (istNow.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    const monday = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() - dow) - 5.5 * 3600_000;
    return { from: new Date(monday).toISOString(), to, bucket: "day" };
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

// Change-detector choice. The precise orders fingerprint SCANS its window, which on a
// wide window ("All time" ≈ 6 years of rows) is a ~10s statement-timeout on a big
// tenant — the exact "Couldn't load / Loading… forever" the owner hit live 2026-07-27.
// Past ~35 days we switch to the mig-202 rollup-derived fingerprint (~35ms): it still
// catches every new/changed recent order; an edit to an ANCIENT order is picked up by
// the nightly rollup refresh (and the Refresh button always forces a recompute). Same
// tradeoff the money reports already ship with (reports route, mig 202).
const WIDE_FP_MS = 35 * DAY;
const fpFor = (ids: string[] | null, from: string, to: string) =>
  Date.parse(to) - Date.parse(from) > WIDE_FP_MS
    ? reportMonthFingerprint(ids, from, to)
    : ordersFingerprint(ids, from, to);

// The dashboard now shows STAFF PAY as an expense, and that money lives in staff_payments —
// which the orders fingerprint knows nothing about. Without this, recording a salary left the
// cached dashboard showing the OLD "after staff pay" number until an order happened to change.
// One tiny indexed count + the newest row's timestamps, appended to the orders fingerprint.
async function fpWithStaffPay(ids: string[] | null, from: string, to: string): Promise<string | null> {
  const base = await fpFor(ids, from, to);
  if (!ids || !ids.length || base === null) return base;
  const q = await sb.from("staff_payments")
    .select("created_at, voided_at", { count: "exact" })
    .in("restaurant_id", ids).order("created_at", { ascending: false }).limit(1);
  const last = (q.data || [])[0] as { created_at?: string; voided_at?: string | null } | undefined;
  return `${base}|sp:${q.count ?? 0}:${last?.created_at ?? ""}:${last?.voided_at ?? ""}`;
}

// `errText` is GONE (T9 sweep, 2026-08-06). It existed to stop a thrown PostgREST object rendering
// as the literal "[object Object]" in the owner's red banner — a real fix, but it solved the wrong
// half: the owner then got the database's message instead, which is just as unusable and is internal
// to us. `dbFail` (lib/ownerScope) does the shape-handling AND keeps the detail in our log, and it
// carries the statement-timeout advice the reports route pioneered. One helper, ten endpoints.

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

// Window to fetch for the "this period vs previous" OVERLAY line. The overlay aligns
// day-1↔day-1, so its previous window must be the current one shifted back by its OWN
// WHOLE-day length — not prevWindowFor's partial span (7d spans ~6.x days of real time,
// which would drop the earliest overlay day and draw a fake zero). Hour ranges and whole-
// month/custom ranges reuse the equal-span step-back (already whole-period there).
function prevTsWindowFor(range: string, from: string, to: string): { from: string; to: string } | null {
  if (range === "all") return null;
  const f = Date.parse(from);
  if (range === "7d") return { from: new Date(f - 7 * DAY).toISOString(), to: from };
  if (range === "30d") return { from: new Date(f - 30 * DAY).toISOString(), to: from };
  // "week" starts Monday 00:00 IST → previous window is the WHOLE prior week, so the
  // overlay lines up Mon↔Mon by day-of-week (same idea as month's day-1↔day-1).
  if (range === "week") return { from: new Date(f - 7 * DAY).toISOString(), to: from };
  // "month" (the locked this-month-vs-last-month chart): previous window is the WHOLE
  // previous calendar month, so the overlay lines up day-1↔day-1 by day-of-month.
  if (range === "month") {
    const istNow = new Date(Date.now() + 5.5 * 3600_000);
    const y = istNow.getUTCFullYear(), m = istNow.getUTCMonth();
    const start = (yy: number, mm: number) => Date.UTC(yy, mm, 1) - 5.5 * 3600_000;
    return { from: new Date(start(y, m - 1)).toISOString(), to: new Date(start(y, m)).toISOString() };
  }
  return prevWindowFor(range, from, to);
}

// Run an RPC over a list of restaurants with a CONCURRENCY CAP, order preserved. A bare
// Promise.all fires one call PER RESTAURANT at once, which on a grown platform saturates the
// pool and times the whole dashboard payload out — the sibling reports route has capped this
// at 8 since the 2026-07-07 audit, and these two fan-outs were never given the same
// treatment (found by the 2026-08-04 owner-panel sweep). 8 keeps the few-restaurant case
// exactly as fast as before.
async function mapLimit<I, O>(items: I[], limit: number, fn: (item: I) => PromiseLike<O> | O): Promise<O[]> {
  const out = new Array<O>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}
const FANOUT = 8;

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

  // ── STAFF PAY AS AN EXPENSE (mig 221, owner 2026-07-30: "it should also reduce main profit
  //    because it all counts as expense") ─────────────────────────────────────────────────
  // Cash truth: money that actually left in this window, pay-list members only (a payment can
  // only exist for someone on the list). ONE indexed sum, and only for restaurants that have
  // the module — a restaurant without it gets `null` and the dashboard shows no such tile.
  // THE ADMIN'S ALL-RESTAURANTS VIEW USED TO LOSE THIS TILE IN SILENCE (T9 sweep, 2026-08-05).
  // `scope.all` gave an EMPTY id list, so this returned null and the staff-pay / after-staff-pay
  // tiles simply weren't there — no figure, no note, nothing to tell the admin why. The tips line
  // was fixed for exactly this on 2026-08-04 ("used to mean the tips line silently vanished from
  // that view with no note") and its two neighbours were left behind. Enumerate the scope like tips
  // does, and read the payroll rung for the whole set in ONE settings query rather than one
  // round-trip per restaurant — that loop was fine for one restaurant and wrong for a platform.
  const staffPayExpense = async (): Promise<{ paidOut: number; people: number; entries: number } | null> => {
    let ids: string[];
    try {
      ids = (rid ? [rid] : scope.all ? await scopedRestaurantIds(scope) : scope.ids).filter(Boolean) as string[];
    } catch { return null; }   // an unreadable list must not print a figure that is too small
    if (!ids.length) return null;
    const eff = await payrollEffectiveByRid(ids);
    const on = ids.filter((id) => eff[id] === true);
    if (!on.length) return null;
    const q = await sb.rpc("lfh_staff_pay_expense", {
      p_restaurant: on.length === 1 ? on[0] : null,
      p_from: istDateOf(from), p_to: istDateOf(to),
      p_ids: on.length === 1 ? null : on,
    });
    const r = (q.data || [])[0] as Record<string, unknown> | undefined;
    if (!r) return { paidOut: 0, people: 0, entries: 0 };
    return { paidOut: num(r.paid_out), people: Number(r.people) || 0, entries: Number(r.entries) || 0 };
  };
  // cache keys must distinguish two different custom windows
  const rangeKey = range === "custom" ? `custom:${sp.get("from")}:${sp.get("to")}` : range;
  const prevWin = compare ? prevWindowFor(range, from, to) : null;
  const prevTsWin = compare ? prevTsWindowFor(range, from, to) : null;

  try {
    if (!rid) {
      // Group scope — the "who earns more" bar + multi-line trend. Compute-on-view cached
      // (mig 196): a normal home open serves the stored JSON instantly; the Refresh button
      // (?refresh=1) forces a live recompute. Keyed by the already-authorized scope.
      const gIds = scope.all ? [] : scope.ids;
      const groupPayload = await cachedOwnerPayload({
        // v2: payload gained `heatmap` (mig 197); v3: gained `categories`; v5: gained
        // `timeseriesPrev` (revenue-vs-previous-period overlay) — each shape change bumps
        // the version so stale snapshots can't serve field-less JSON verbatim until their
        // fingerprint happens to change (found 2026-07-26).
        key: `analytics:v5:group:${scopeKeyOf(null, scope.all, gIds)}:${rangeKey}:c${compare ? 1 : 0}`,
        force: sp.get("refresh") === "1",
        fingerprint: () => fpWithStaffPay(scope.all ? null : gIds, from, to),
        compute: async () => {
      const allow = scope.all ? null : new Set(scope.ids);
      const pIds = scope.all ? null : scope.ids; // DB-side scope (mig 138) — no whole-platform scan
      // Speed (owner round-5): every independent read starts NOW and runs concurrently —
      // the payment/category per-restaurant fan-outs and the prev-window totals used to
      // wait for the base block, serialising 3 extra round-trips into the compute time.
      const pmIds: (string | null)[] = scope.all ? [null] : scope.ids;
      const pmP = mapLimit(pmIds, FANOUT, (id) => sb.rpc("lfh_owner_payment_breakdown", { p_restaurant_id: id, p_from: from, p_to: to }));
      const catScopedP = scope.all ? null : mapLimit(scope.ids, FANOUT, (id) => sb.rpc("lfh_owner_category_breakdown", { p_restaurant_id: id, p_from: from, p_to: to }));
      const prevP = prevWin ? windowTotals(pIds, prevWin.from, prevWin.to) : Promise.resolve(null);
      // Previous-period revenue PER BUCKET (same grain), for the "this period vs previous"
      // overlay that replaces Busy hours. ONE extra pre-summed RPC, only inside the cached
      // compute — so it runs at most on a ~5-min recompute, never on a plain snapshot read.
      const prevTsP = prevTsWin
        ? sb.rpc("lfh_owner_revenue_timeseries", { p_restaurant_id: null, p_from: prevTsWin.from, p_to: prevTsWin.to, p_bucket: bucket, p_ids: pIds })
        : Promise.resolve(null);
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
      const catRes = catScopedP ? await catScopedP : await mapLimit(
        (rev.data ?? []).map((r: Record<string, unknown>) => r.restaurant_id as string),
        FANOUT, (id: string) => sb.rpc("lfh_owner_category_breakdown", { p_restaurant_id: id, p_from: from, p_to: to }));
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
      // Sum the previous window's per-restaurant rows into ONE total per bucket (the overlay
      // is a whole-group total line, not per-restaurant). Non-fatal: a failed prev query just
      // yields an empty array and the current line still draws.
      const prevTs = await prevTsP;
      // Cap to the window END: the day-grain RPC (mig 190 `hist` CTE) filters p_from but
      // NOT p_to — it always runs to the rollup watermark (~now). Existing callers end
      // "now" so never saw it; this is the first PAST-ending window, so we drop any bucket
      // at/after prevTsWin.to here (tiny pre-summed rows; the filter, not a wider fetch).
      const prevCut = prevTsWin ? Date.parse(prevTsWin.to) : Infinity;
      const prevByBucket = new Map<string, number>();
      if (prevTs && !prevTs.error) {
        for (const r of (prevTs.data ?? []) as Record<string, unknown>[]) {
          const b = String(r.bucket);
          if (Date.parse(b) >= prevCut) continue;
          prevByBucket.set(b, num((prevByBucket.get(b) || 0) + (Number(r.revenue) || 0)));
        }
      }
      const timeseriesPrev = Array.from(prevByBucket.entries())
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([bucket, revenue]) => ({ bucket, revenue }));
      const heatmap = ((heat.data ?? []) as Record<string, unknown>[]).map((r) => ({
        dow: Number(r.dow) || 0, hr: Number(r.hr) || 0, orders: Number(r.orders) || 0, revenue: num(r.revenue),
      }));
      return { scope: "group", range, restaurantRevenue, timeseries, timeseriesPrev, paymentMethods, categories, heatmap, prev, staffPay: await staffPayExpense() };
        },
      });
      return NextResponse.json(groupPayload);
    }

    // Restaurant scope — KPIs + per-dish/category/hourly + this restaurant's trend.
    // An owner may only drill into a restaurant they actually own.
    if (!scope.all && !scope.ids.includes(rid)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    // Crazy-dashboard extras (mig 127, all rid-scoped + pre-summed):
    //  · records — all-time bests (one JSONB row, on-demand only).
    //
    // GONE, deliberately (owner-panel sweep 2026-08-04): `sameHour`
    // (lfh_owner_samehour_compare) and `payTrend` (lfh_owner_payment_trend). Both ran on
    // EVERY cold/refresh compute of a restaurant dashboard — payTrend returned 56 rows on the
    // demo restaurant — and NOTHING rendered either field: the charts that once did
    // (SameHourBar, PayTrendStack) had become unreferenced exports. Worse, both sat in the
    // `throw` loop below, so a failure in a query no screen uses would blank the whole owner
    // dashboard; the heatmap was explicitly excluded from that loop for exactly this reason.
    // The RPCs are untouched in the database — re-add the fetch WITH its chart if either view
    // comes back.
    // Compute-on-view cached like the group scope (owner round-3: "auto calculate…
    // it should show number only, very fast — the live site is already optimized").
    // LIVE bits stay OUTSIDE the cache: open-tables (a now-count) and the unbounded
    // all-time records (fetched once per restaurant on demand).
    const restBase = await cachedOwnerPayload({
      // Still v5 after `sameHour`/`payTrend` were dropped: the bump rule exists so a stale
      // snapshot can't serve JSON that is MISSING a field the UI now reads. Here the change is
      // the other direction — an old snapshot merely carries two extra fields nothing reads —
      // so a bump would only buy a pointless recompute for every restaurant.
      key: `analytics:v5:rest:${rid}:${rangeKey}:c${compare ? 1 : 0}`,
      force: sp.get("refresh") === "1",
      fingerprint: () => fpWithStaffPay([rid], from, to),
      compute: async () => {
    const [meta, ts, dishes, cats, hourly, heat, pm, prevTs] = await Promise.all([
      sb.from("restaurants").select("id, slug, name, accent_color, hero_title").eq("id", rid).maybeSingle(),
      sb.rpc("lfh_owner_revenue_timeseries", { p_restaurant_id: rid, p_from: from, p_to: to, p_bucket: bucket }),
      sb.rpc("lfh_owner_dish_breakdown", { p_restaurant_id: rid, p_from: from, p_to: to }),
      sb.rpc("lfh_owner_category_breakdown", { p_restaurant_id: rid, p_from: from, p_to: to }),
      sb.rpc("lfh_owner_hourly", { p_restaurant_id: rid, p_from: from, p_to: to }),
      sb.rpc("lfh_owner_heatmap", { p_restaurant_id: rid, p_from: heatFrom(from, to), p_to: to }),
      sb.rpc("lfh_owner_payment_breakdown", { p_restaurant_id: rid, p_from: from, p_to: to }),
      // Previous-period revenue per bucket for the "this period vs previous" overlay. Same
      // grain as the current trend; non-fatal (excluded from the throw loop below).
      prevTsWin
        ? sb.rpc("lfh_owner_revenue_timeseries", { p_restaurant_id: rid, p_from: prevTsWin.from, p_to: prevTsWin.to, p_bucket: bucket })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (meta.error) throw meta.error;
    if (!meta.data) throw new Error("restaurant not found");
    // `heat` is deliberately EXCLUDED — the heatmap is non-fatal (see heatFrom): its error
    // must not throw, or one slow busy-hours grid wedges the whole dashboard. `heat.data ?? []`
    // below degrades to an empty grid.
    for (const e of [ts, dishes, cats, hourly, pm]) if (e.error) throw e.error;

    const dishRows = (dishes.data ?? []).map((r: Record<string, unknown>) => ({
      title: r.title, qty: Number(r.qty) || 0, revenue: num(r.revenue),
    }));
    const tsRows = (ts.data ?? []).map((r: Record<string, unknown>) => ({
      bucket: r.bucket, revenue: num(r.revenue), orders: Number(r.orders) || 0,
    }));
    const revenue = num(tsRows.reduce((a: number, r: { revenue: number }) => a + r.revenue, 0));
    const orders = tsRows.reduce((a: number, r: { orders: number }) => a + r.orders, 0);
    // Avg order = PAID revenue ÷ PAID order count (both from paid-only sources). `orders` above
    // counts ALL non-cancelled orders (incl. open/unpaid), so revenue/orders understated the
    // average and made it drift UPWARD as open tables settled with no new orders. paid-count
    // comes from the payment breakdown (already fetched, WHERE payment_status='paid'). (owner 2026-07-06)
    const paidOrders = (pm.data ?? []).reduce((a: number, r: Record<string, unknown>) => a + (Number(r.orders) || 0), 0);
    const prev = prevWin ? await windowTotals([rid], prevWin.from, prevWin.to) : null;
    // Previous window's revenue per bucket (ascending) for the overlay line. Non-fatal.
    // Cap to the window END — the day-grain RPC ignores p_to (mig 190 `hist`, see group note).
    const prevCut = prevTsWin ? Date.parse(prevTsWin.to) : Infinity;
    const tsPrevRows = (prevTs.error ? [] : (prevTs.data ?? []))
      .map((r: Record<string, unknown>) => ({ bucket: r.bucket, revenue: num(r.revenue) }))
      .filter((r: { bucket: unknown }) => Date.parse(String(r.bucket)) < prevCut)
      .sort((a: { bucket: unknown }, b: { bucket: unknown }) => (String(a.bucket) < String(b.bucket) ? -1 : 1));

    // `orders` counts ALL non-cancelled (incl. open/unpaid) while revenue+avgOrder are
    // PAID-only — so Revenue ÷ Orders ≠ Avg order and looks like a wrong number. Ship
    // `paidOrders` too so the dashboard can label the tile honestly (owner audit 2026-07-06).
    return {
      scope: "restaurant", range, prev,
      restaurant: { id: meta.data.id, slug: meta.data.slug, name: meta.data.name, accentColor: meta.data.accent_color || "#e3c06f", heroTitle: meta.data.hero_title || "" },
      kpis: { revenue, orders, paidOrders, avgOrder: paidOrders ? num(revenue / paidOrders) : 0, openTables: 0, topDish: dishRows[0]?.title || "—" },
      staffPay: await staffPayExpense(),
      timeseries: tsRows,
      timeseriesPrev: tsPrevRows,
      dishes: dishRows,
      categories: (cats.data ?? []).map((r: Record<string, unknown>) => ({ category: r.category, qty: Number(r.qty) || 0, revenue: num(r.revenue) })),
      hourly: (hourly.data ?? []).map((r: Record<string, unknown>) => ({ hour: Number(r.hour) || 0, orders: Number(r.orders) || 0, revenue: num(r.revenue) })),
      heatmap: ((heat.data ?? []) as Record<string, unknown>[]).map((r) => ({ dow: Number(r.dow) || 0, hr: Number(r.hr) || 0, orders: Number(r.orders) || 0, revenue: num(r.revenue) })),
      paymentMethods: (pm.data ?? []).map((r: Record<string, unknown>) => ({ method: r.method, revenue: num(r.revenue), orders: Number(r.orders) || 0 })),
    };
      },
    });

    // LIVE add-ons, outside the cache: the open-tables now-count (must never freeze)
    // and the on-demand all-time records (unbounded scan, once per restaurant).
    const openT = await sb.from("sessions").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).eq("status", "open");
    // "0 TABLES OPEN" AND "WE COULDN'T COUNT" ARE DIFFERENT SENTENCES (T9 sweep, 2026-08-06).
    // `openT.count || 0` turned a failed head-count into a confident empty floor — mid-service, on
    // the one KPI this route deliberately keeps LIVE. `null` lets the tile show a dash instead of
    // claiming a number nobody read (the client already renders `openTables ?? "—"`).
    const kpis = {
      ...(restBase as { kpis: Record<string, unknown> }).kpis,
      openTables: openT.error ? null : (openT.count ?? 0),
    };
    if (openT.error) console.error("[owner/analytics] open-tables count failed:", openT.error.message);
    let records: unknown = null;
    if (wantRecords) {
      const r = await sb.rpc("lfh_owner_records", { p_restaurant_id: rid });
      if (!r.error) records = r.data ?? null;
    }
    return NextResponse.json({ ...restBase, kpis, records });
  } catch (e) {
    return dbFail("owner/analytics", e, {
      message: "Couldn't load your dashboard just now — please try again.",
    });
  }
}
