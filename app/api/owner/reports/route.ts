// GET /api/owner/reports — on-demand report data for /owner/reports.
//   ?type=sales|tax|discounts|cancellations|dishes|categories|payments|hourly
//   &range=today|yesterday|7d|30d|12m   (12m buckets by month for the 1-year view)
//   &rid=<uuid>                         (optional; omit = all the caller's restaurants)
//
// Reports are generated ONLY when the owner asks (never scheduled/compulsory —
// owner 2026-07-04). Money rows come pre-summed from lfh_owner_sales_report
// (mig 120, paid-only mig-113 rule) or the existing lfh_owner_* RPCs — one tiny
// round-trip per call, never order scanning in JS.
//
// TAX SPLIT: the summed tax is divided in the proportions of that restaurant's
// settings.tax_components (lib/tax.ts) — display maths, not a re-computation, so
// it always sums back to the merged figure the manager panel shows. With no
// components configured the printed bill splits 50/50 CGST+SGST (mig 117 rule),
// so the report mirrors that too. Split renders only for a single restaurant —
// components are per-restaurant config and can't be merged across tenants.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScope } from "@/lib/ownerScope";
import { entitledSubset } from "@/lib/ownerEntitlements";
import { effectiveTaxPct } from "@/lib/tax";
import { cachedOwnerPayload, scopeKeyOf, ordersFingerprint, reportMonthFingerprint } from "@/lib/ownerCache";
import { payrollLadder } from "@/lib/tableTags";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
function windowFor(range: string, sp?: URLSearchParams): { from: string; to: string; bucket: string } {
  // custom: exact IST day range from the owner report dialog (round-4). Inclusive
  // dates, day buckets; bad input falls back to the last 30 days.
  if (range === "custom" && sp) {
    const f = sp.get("from"), t2 = sp.get("to");
    const ok = (x: string | null) => !!x && /^\d{4}-\d{2}-\d{2}$/.test(x);
    if (ok(f) && ok(t2)) {
      const pf = Date.parse(f + "T00:00:00+05:30");
      const pt = Math.min(Date.parse(t2 + "T00:00:00+05:30") + 86_400_000, Date.now());
      if (Number.isFinite(pf) && pt > pf) return { from: new Date(pf).toISOString(), to: new Date(pt).toISOString(), bucket: "day" };
    }
    return windowFor("30d");
  }
  const now = Date.now();
  const to = new Date(now).toISOString();
  // "all" = unbounded, matching /api/owner/analytics (from 2020) so the dashboard's money
  // tiles (cancellations/discounts) cover the SAME span as its revenue/order KPIs — before,
  // the dashboard mapped range=all → 12m here and undercounted everything >1yr old (bug M11).
  if (range === "all") return { from: "2020-01-01T00:00:00Z", to, bucket: "month" };
  // IST "now" and today's 00:00-IST boundary — used to align 7d/30d/12m to the SAME
  // whole-IST-day/month windows /api/owner/analytics uses.
  const istNow = new Date(now + 5.5 * 3600_000);
  const istMidnightToday = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - 5.5 * 3600_000;
  // 7d / 30d: EXACTLY N whole IST calendar days ending today (inclusive), aligned to
  // 00:00 IST — the SAME window analytics uses, so the dashboard's revenue KPI (analytics)
  // and its discount/cancellation tiles (this route) cover the identical span, and a
  // "7 days" report lists 7 dated rows, not 8. A rolling now−N×24h window spilled into an
  // extra partial (N+1)th IST day so the two dashboard numbers didn't reconcile (audit 2026-07-07).
  if (range === "7d" || range === "30d") {
    const n = range === "7d" ? 7 : 30;
    return { from: new Date(istMidnightToday - (n - 1) * DAY).toISOString(), to, bucket: "day" };
  }
  // this calendar week: Monday 00:00 IST → now (owner 2026-07-27) — mirrors the
  // analytics route's "week" so the dashboard KPI tiles and charts share one window.
  if (range === "week") {
    const ist = new Date(now + 5.5 * 3600_000);
    const dow = (ist.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    const monday = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - dow) - 5.5 * 3600_000;
    return { from: new Date(monday).toISOString(), to, bucket: "day" };
  }
  // 12m: the 12 whole IST calendar months ending this month (inclusive), aligned to 00:00
  // IST on the 1st — matches the month buckets the client plots (no rolling extra 13th month).
  if (range === "12m") {
    const from = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() - 11, 1) - 5.5 * 3600_000).toISOString();
    return { from, to, bucket: "month" };
  }
  // GST filing periods — proper IST calendar boundaries (a rolling 30d/12m window is NOT
  // a filing period). "month"/"lastmonth" = a calendar month for GSTR; "fy" = the Indian
  // financial year Apr 1 → Mar 31. 00:00 IST on the 1st, shifted back to UTC.
  if (range === "month" || range === "lastmonth" || range === "fy") {
    const y = istNow.getUTCFullYear(), m = istNow.getUTCMonth();
    const istMonthStart = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 1) - 5.5 * 3600_000).toISOString();
    if (range === "month") return { from: istMonthStart(y, m), to, bucket: "day" };
    if (range === "lastmonth") {
      const pm = m === 0 ? 11 : m - 1, py = m === 0 ? y - 1 : y;
      return { from: istMonthStart(py, pm), to: istMonthStart(y, m), bucket: "day" };
    }
    const fyStart = m >= 3 ? y : y - 1; // April (index 3) starts the Indian FY
    return { from: istMonthStart(fyStart, 3), to, bucket: "month" };
  }
  const biz = new Date(now + 5.5 * 3600_000 - 5 * 3600_000);
  const todayStart = Date.UTC(biz.getUTCFullYear(), biz.getUTCMonth(), biz.getUTCDate(), 5, 0, 0) - 5.5 * 3600_000;
  if (range === "yesterday") return { from: new Date(todayStart - DAY).toISOString(), to: new Date(todayStart).toISOString(), bucket: "hour" };
  return { from: new Date(todayStart).toISOString(), to, bucket: "hour" };
}

const num = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
type Row = Record<string, unknown>;

// Every range windowFor() understands. An unknown value used to fall through to
// "today" for the DATA but was still echoed back verbatim in the response, so the
// client title (which looks range up in a fixed table) rendered blank (bug L-…).
// Normalising here means `range` in the payload is ALWAYS a known key.
const VALID_RANGES = new Set(["today", "yesterday", "week", "7d", "30d", "month", "lastmonth", "12m", "fy", "all", "custom"]);

// Fetch EVERY restaurant id, paging past PostgREST's default row cap. The admin
// "all restaurants" merge for dishes/categories/hourly must cover the SAME universe
// the sales/payments RPCs scan when passed NULL — a flat .limit(100) silently dropped
// every restaurant past the 100th (bug M-…). These breakdown RPCs filter
// `WHERE restaurant_id = p_restaurant_id` and DON'T accept NULL, so ids must be
// enumerated explicitly (no active filter, matching the unfiltered NULL all-scan).
async function allRestaurantIds(): Promise<string[]> {
  const ids: string[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const r = await sb.from("restaurants").select("id").order("id").range(offset, offset + PAGE - 1);
    if (r.error) throw r.error;
    const batch = (r.data ?? []).map((x) => x.id as string);
    ids.push(...batch);
    if (batch.length < PAGE) break;
  }
  return ids;
}

// Run an async op over a list with a CONCURRENCY CAP. The admin "all restaurants" reports
// fan one RPC out per restaurant; a bare Promise.all over hundreds of restaurants fires them
// all at once and can saturate the DB pool / time out (audit 2026-07-07). 8 in flight keeps
// it bounded while staying fast for the common few-restaurant case. Order is preserved.
async function mapLimit<I, O>(items: I[], limit: number, fn: (item: I, i: number) => PromiseLike<O> | O): Promise<O[]> {
  const out = new Array<O>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// Sum one numeric key across per-restaurant RPC result sets (small rows).
function mergeBy<T extends Row>(rowsets: T[][], key: keyof T, numeric: (keyof T)[]): T[] {
  const out = new Map<unknown, T>();
  for (const rows of rowsets) for (const r of rows) {
    const k = r[key];
    const cur = out.get(k);
    if (!cur) out.set(k, { ...r });
    else for (const n of numeric) (cur[n] as number) = (Number(cur[n]) || 0) + (Number(r[n]) || 0);
  }
  return Array.from(out.values());
}

export async function GET(req: NextRequest) {
  const scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") || "sales";
  const rawRange = sp.get("range") || "30d";
  const range = VALID_RANGES.has(rawRange) ? rawRange : "today";
  const rid = sp.get("rid") || null;
  if (rid && !scope.all && !scope.ids.includes(rid)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  // Mig 133: a REAL owner only reads reports for restaurants whose "reports" section
  // the admin still allows. The admin's own session (scope.admin — set on every admin
  // branch, incl. an act-as pin that borrows the real owner's id) is never gated:
  // admin = top power, and the X-ray shows removed sections tinted-but-working.
  if (!scope.all && !scope.admin) {
    const allowed = await entitledSubset(scope.ids, "reports");
    if (rid && !allowed.includes(rid)) return NextResponse.json({ error: "Reports aren't enabled for this restaurant — contact Aevidine.", disabled: true }, { status: 403 });
    if (!allowed.length) return NextResponse.json({ error: "Reports aren't enabled for your restaurant — contact Aevidine.", disabled: true }, { status: 403 });
    scope.ids = allowed;
  }
  const { from, to, bucket } = windowFor(range, sp);

  // The restaurants this call may touch (for the merged all-restaurants shapes).
  const ridList: (string | null)[] = rid ? [rid] : scope.all ? [null] : scope.ids;

  const KNOWN = new Set(["sales", "tax", "discounts", "cancellations", "daysummary", "dishes", "categories", "hourly", "payments", "byrestaurant", "staffpay", "staffperf"]);
  if (!KNOWN.has(type)) return NextResponse.json({ error: "unknown report type" }, { status: 400 });
  // ── Team & pay / Team performance (mig 220) ────────────────────────────────
  // Both are gated by the payroll MODULE, per restaurant, before anything is read or cached:
  // a restaurant without the feature gets the same calm "not enabled" card as a missing section.
  // Money out of the owner's pocket and a per-person leaderboard are OWNER-ONLY (owner 2026-07-29
  // chose "owner only, with a team leaderboard" — a manager gets no access at all), and this
  // route is already owner/admin-only, so no extra role test is needed here.
  const staffType = type === "staffpay" || type === "staffperf";
  if (staffType) {
    const ids = (rid ? [rid] : scope.all ? [] : scope.ids).filter(Boolean) as string[];
    if (!ids.length && !rid)
      return NextResponse.json({ error: "Pick one restaurant to see its team pay.", disabled: true }, { status: 400 });
    const on = await Promise.all(ids.map((id) => payrollLadder(id).then((l) => l.effective)));
    if (!on.some(Boolean))
      return NextResponse.json({ error: "Staff profiles & pay aren't enabled for this restaurant — contact Aevidine.", disabled: true }, { status: 403 });
  }
  // Compute-on-view snapshot cache (mig 196): a normal open serves the stored JSON instantly;
  // ?refresh=1 (the Refresh button) forces a live recompute + re-store. Keyed by the already-
  // authorized scope, so isolation is unchanged. `cachedAt`/`cached` ride along for the UI.
  const scopeIds = scope.all ? [] : scope.ids;
  // The key embeds the RESOLVED window start (not just "30d"): a sliding range crosses into a
  // new IST day, the key changes, and the new window computes cold. Without this, the first
  // open of a new day served YESTERDAY'S 30-day window from the stale-while-revalidate row —
  // numbers that no longer match a recount (caught in the 2026-07-27 audit). v2 orphans v1 rows.
  const cacheKey = `reports:v2:${scopeKeyOf(rid, scope.all, scopeIds)}:${type}:${range === "custom" ? `custom:${sp.get("from")}:${sp.get("to")}` : `${range}:${from.slice(0, 10)}`}`;
  const force = sp.get("refresh") === "1";
  const fpIds = rid ? [rid] : scope.all ? null : scopeIds;
  // Change-detector choice. The precise ordersFingerprint SCANS its window — on a WIDE
  // window that's a 5–8s full-table scan (measured 2026-07-27: fy 7.1s, 12m 8.2s, all 5.5s
  // over ~398k orders) that the cold/refresh path WAITS on, so a big-tenant owner opening
  // "12 months" of the dishes/categories/hourly/payments/by-restaurant report saw it hang.
  // Two cases now use the ~0.3s rollup-derived fingerprint (mig 202) instead:
  //   • money reports at month bucket (already read the rollup — always valid), and
  //   • ANY report on a window wider than ~35 days — same tradeoff the dashboard ships
  //     (analytics fpFor): it still flags every new/recent-edited order; a change to an
  //     ANCIENT order that shifts neither count nor max-activity is caught by the nightly
  //     rollup refresh (and Refresh always forces a live recompute). Narrow windows keep
  //     the precise scan (it's sub-second there and catches old-order edits immediately).
  // Staff reports are driven by staff_payments (+ staff_actions for performance), which the
  // orders fingerprint knows nothing about: a recorded salary would NOT invalidate the snapshot.
  // Two tiny indexed counts are the change-detector instead.
  const staffFingerprint = async (): Promise<string> => {
    const ids = (rid ? [rid] : scope.all ? [] : scope.ids).filter(Boolean) as string[];
    if (!ids.length) return "0";
    const [pay, act] = await Promise.all([
      sb.from("staff_payments").select("id, created_at, voided_at", { count: "exact", head: false })
        .in("restaurant_id", ids).order("created_at", { ascending: false }).limit(1),
      type === "staffperf"
        ? sb.from("staff_actions").select("id", { count: "exact", head: true }).in("restaurant_id", ids)
        : Promise.resolve({ count: 0 } as { count: number | null }),
    ]);
    const last = (pay.data || [])[0] as { created_at?: string; voided_at?: string | null } | undefined;
    return [pay.count ?? 0, last?.created_at ?? "", last?.voided_at ?? "", (act as { count?: number | null }).count ?? 0].join("|");
  };
  const moneyType = type === "sales" || type === "tax" || type === "discounts" || type === "cancellations" || type === "daysummary";
  const wideWindow = Date.parse(to) - Date.parse(from) > 35 * DAY;
  const useMonthFp = wideWindow || (bucket === "month" && moneyType);

  try {
    const payload = await cachedOwnerPayload({
      key: cacheKey, force,
      fingerprint: () => (staffType ? staffFingerprint()
        : useMonthFp ? reportMonthFingerprint(fpIds, from, to) : ordersFingerprint(fpIds, from, to)),
      compute: async () => {
    // ── money reports: one bucketed summary drives sales/tax/discounts/cancellations ──
    // The "daysummary" report reads the SAME money payload and additionally bundles the
    // payment-mode settlement (one extra RPC per restaurant) so the day sheet is one round-trip.
    if (type === "sales" || type === "tax" || type === "discounts" || type === "cancellations" || type === "daysummary") {
      // One bucketed fetch — reused for the main window AND for the sparse auto-drill
      // (below), so both go through the identical scope/merge/mapping path.
      const salesRows = async (f: string, t: string, bkt: string) => {
        let raw: Row[];
        if (rid || scope.all) {
          // one restaurant, or admin all-restaurants (NULL scope) — already a single call.
          const res = await sb.rpc("lfh_owner_sales_report", { p_restaurant_id: rid, p_from: f, p_to: t, p_bucket: bkt });
          if (res.error) throw res.error;
          raw = (res.data ?? []) as Row[];
        } else {
          // scoped owner: ONE grouped call over the owned set (mig 203) instead of N round-
          // trips — the RPC sums per bucket across p_ids exactly like the old JS merge did.
          const grp = await sb.rpc("lfh_owner_sales_report", { p_restaurant_id: null, p_from: f, p_to: t, p_bucket: bkt, p_ids: scope.ids });
          if (!grp.error) {
            raw = (grp.data ?? []) as Row[];
          } else {
            // Fallback: if the grouped call errors, sum each owned restaurant separately so one
            // issue can't blank the WHOLE report; only surface an error if EVERY one failed
            // (audit 2026-07-09).
            const per = await mapLimit(scope.ids, 8, (id) =>
              sb.rpc("lfh_owner_sales_report", { p_restaurant_id: id, p_from: f, p_to: t, p_bucket: bkt }));
            const okData = per.filter((p) => !p.error).map((p) => (p.data ?? []) as Row[]);
            if (!okData.length && per.length) throw per.find((p) => p.error)?.error || new Error("Report failed");
            raw = mergeBy(okData, "bucket",
              ["orders", "paid_orders", "subtotal", "tax", "discount", "revenue", "cancelled_orders", "cancelled_value"]);
            raw.sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
          }
        }
        return raw.map((r) => ({
          bucket: r.bucket,
          orders: Number(r.orders) || 0,
          paidOrders: Number(r.paid_orders) || 0,
          subtotal: num(r.subtotal), tax: num(r.tax), discount: num(r.discount), revenue: num(r.revenue),
          cancelledOrders: Number(r.cancelled_orders) || 0, cancelledValue: num(r.cancelled_value),
        }));
      };
      const rows = await salesRows(from, to, bucket);

      // ── Auto-drill sparse timelines (owner 2026-07-25) ──────────────────────
      // When the whole period had activity on ONLY ONE day/month, a single bar in a
      // wide plot reads as broken. Re-fetch that one bucket at a finer grain (day→hour,
      // month→day) and hand the chart the fuller series via drillRows. The daily `rows`
      // (and the GST-style table built from them) are left untouched.
      let drillBucket: string | undefined, drillRows: typeof rows | undefined;
      if (rows.length === 1 && (bucket === "day" || bucket === "month")) {
        const b0 = new Date(String(rows[0].bucket));
        const finer = bucket === "day" ? "hour" : "day";
        // next bucket boundary in IST (fixed +5:30, no DST → a day is exactly 24h).
        const next = bucket === "day"
          ? new Date(b0.getTime() + DAY)
          : (() => { const d = new Date(b0.getTime() + 5.5 * 3600_000); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 5.5 * 3600_000); })();
        try {
          const drilled = await salesRows(b0.toISOString(), next.toISOString(), finer);
          if (drilled.length >= 2) { drillRows = drilled; drillBucket = finer; }
        } catch { /* drill is best-effort; fall back to the single-bucket message */ }
      }
      const totals = rows.reduce((a, r) => ({
        orders: a.orders + r.orders, paidOrders: a.paidOrders + r.paidOrders,
        subtotal: num(a.subtotal + r.subtotal), tax: num(a.tax + r.tax),
        discount: num(a.discount + r.discount), revenue: num(a.revenue + r.revenue),
        cancelledOrders: a.cancelledOrders + r.cancelledOrders, cancelledValue: num(a.cancelledValue + r.cancelledValue),
      }), { orders: 0, paidOrders: 0, subtotal: 0, tax: 0, discount: 0, revenue: 0, cancelledOrders: 0, cancelledValue: 0 });

      // Tax model for the split — single restaurant only (per-tenant config).
      let tax = null;
      if (rid) {
        const st = await sb.from("settings").select("tax_components, tax_rate").eq("restaurant_id", rid).maybeSingle();
        if (st.error) throw st.error;
        const comps = (Array.isArray(st.data?.tax_components) ? st.data!.tax_components : [])
          .map((c: Row) => ({ label: String(c?.label ?? "").trim(), rate: Number(c?.rate) || 0 }))
          .filter((c: { label: string; rate: number }) => c.label && c.rate > 0);
        const pct = effectiveTaxPct(st.data);
        // No named components → the printed bill splits 50/50 CGST+SGST (mig 117).
        const effective = comps.length ? comps : [
          { label: "CGST", rate: pct / 2 }, { label: "SGST", rate: pct / 2 },
        ];
        const rateSum = effective.reduce((a, c) => a + c.rate, 0) || 1;
        // The per-line amounts MUST sum back to the merged tax exactly — a GST filing
        // where CGST+SGST ≠ total tax is wrong. Rounding each line independently drifts
        // by a paisa (58.75 → 29.38+29.38 = 58.76), so round every line except the LAST
        // and give the last the remainder. (found + fixed 2026-07-04)
        let running = 0;
        const components = effective.map((c, i) => {
          const amount = i === effective.length - 1
            ? num(totals.tax - running)
            : num(totals.tax * (c.rate / rateSum));
          running = num(running + amount);
          return { ...c, amount };
        });
        tax = { effectivePct: pct, components, configured: comps.length > 0 };
      }

      // Day summary also needs the settlement split (how the money arrived). Same merge
      // the /payments report uses; degrade gracefully if a restaurant's RPC fails.
      let payments: { method: unknown; revenue: number; orders: number }[] | undefined;
      if (type === "daysummary") {
        let payRaw: Row[];
        if (!rid && !scope.all) {
          // scoped owner: ONE grouped call (mig 203) — the RPC already sums per method across
          // p_ids. Fall back to the per-restaurant merge if it errors (degrade gracefully).
          const grp = await sb.rpc("lfh_owner_payment_breakdown", { p_restaurant_id: null, p_from: from, p_to: to, p_ids: scope.ids });
          if (!grp.error) {
            payRaw = (grp.data ?? []) as Row[];
          } else {
            const per = await mapLimit(scope.ids, 8, (id) =>
              sb.rpc("lfh_owner_payment_breakdown", { p_restaurant_id: id, p_from: from, p_to: to }));
            payRaw = mergeBy(per.filter((p) => !p.error).map((p) => (p.data ?? []) as Row[]), "method", ["revenue", "orders"]);
          }
        } else {
          const one = await sb.rpc("lfh_owner_payment_breakdown", { p_restaurant_id: rid, p_from: from, p_to: to });
          payRaw = (one.data ?? []) as Row[];
        }
        payments = payRaw
          .map((r) => ({ method: r.method, revenue: num(r.revenue), orders: Number(r.orders) || 0 }))
          .sort((a, b) => b.revenue - a.revenue);
      }
      // STAFF PAY paid out in this same window (mig 220) — the day book's "money out" line.
      // Cash truth: the day the money actually left, matching the Team & pay report's cash view.
      // Only for a restaurant that HAS the module, and only on the day sheet (one tiny indexed
      // read; a NULL keeps the line off the sheet entirely rather than printing a fake zero).
      let staffPay: { paidOut: number; people: number; entries: number } | null = null;
      if (type === "daysummary") {
        const payIds = (rid ? [rid] : scopeIds).filter(Boolean) as string[];
        const enabled: string[] = [];
        for (const id of payIds) if ((await payrollLadder(id)).effective) enabled.push(id);
        if (enabled.length) {
          const per = await mapLimit(enabled, 6, (id) =>
            sb.rpc("lfh_staff_pay_cashflow", { p_restaurant: id, p_from: from.slice(0, 10), p_to: to.slice(0, 10), p_bucket: "day" }));
          const rowsSp = per.filter((x) => !x.error).flatMap((x) => (x.data ?? []) as Row[]);
          if (rowsSp.length) staffPay = {
            paidOut: rowsSp.reduce((a, r) => a + num(r.paid_out), 0),
            people: Math.max(...rowsSp.map((r) => Number(r.people) || 0)),
            entries: rowsSp.reduce((a, r) => a + (Number(r.entries) || 0), 0),
          };
          else staffPay = { paidOut: 0, people: 0, entries: 0 };
        }
      }
      return { type, range, bucket, rows, totals, tax, payments, staffPay, drillBucket, drillRows };
    }

    // ── breakdown reports: dishes / categories / payments / hourly ──
    if (type === "dishes" || type === "categories" || type === "hourly") {
      const fn = type === "dishes" ? "lfh_owner_dish_breakdown"
        : type === "categories" ? "lfh_owner_category_breakdown" : "lfh_owner_hourly";
      // These RPCs are per-restaurant; "all" = run per restaurant and merge. For the
      // admin all-view, enumerate EVERY restaurant (paged, uncapped) so the merged
      // total matches the sales/payments NULL all-scan universe — no 100-row cap.
      let ids: string[];
      if (rid) ids = [rid];
      else if (!scope.all) ids = scope.ids;
      else ids = await allRestaurantIds();
      const per = await mapLimit(ids, 8, (id) => sb.rpc(fn, { p_restaurant_id: id, p_from: from, p_to: to }));
      // Degrade gracefully (audit 2026-07-09): keep the restaurants that succeeded, drop the
      // ones whose RPC errored, and only surface an error when EVERY one failed. Pair each
      // result with its id so the per-restaurant name labelling below stays aligned.
      const okPairs = ids.map((id, i) => ({ id, p: per[i] })).filter((x) => !x.p.error);
      if (!okPairs.length && per.length) throw per.find((p) => p.error)?.error || new Error("Report failed");
      const okIds = okPairs.map((x) => x.id);
      const keyCol = type === "dishes" ? "title" : type === "categories" ? "category" : "hour";
      const numeric = type === "hourly" ? ["orders", "revenue"] : ["qty", "revenue"];
      // Multi-restaurant dishes/categories: the SAME title in two brands is a DIFFERENT
      // product, so DON'T sum "Water"/"Margherita" across brands into one misleading row.
      // Label each row with its restaurant ("Water · Green Bowl") so identical names stay
      // distinct in the existing list (audit 2026-07-07). Hourly stays a pure cross-restaurant
      // aggregate — an hour-of-day is the same everywhere.
      let rowsets = okPairs.map((x) => (x.p.data ?? []) as Row[]);
      if (type !== "hourly" && okIds.length > 1) {
        const nameById: Record<string, string> = {};
        const nq = await sb.from("restaurants").select("id, name").in("id", okIds);
        for (const x of (nq.data || []) as { id: string; name: string }[]) nameById[x.id] = x.name;
        rowsets = rowsets.map((rows, i) => rows.map((r) => ({ ...r, [keyCol]: `${String(r[keyCol])} · ${nameById[okIds[i]] || "—"}` })));
      }
      const rows: Row[] = mergeBy(rowsets, keyCol, numeric)
        .map((r) => ({ ...r, revenue: num(r.revenue) }));
      rows.sort((a, b) => (type === "hourly" ? Number(a.hour) - Number(b.hour) : Number(b.revenue) - Number(a.revenue)));
      return { type, range, rows };
    }

    // ── per-restaurant brief (all-restaurants hub leaderboard) ──
    // One grouped call returns each in-scope restaurant's revenue + orders for the window.
    if (type === "byrestaurant") {
      const pIds = scope.all ? null : scope.ids;
      const res = await sb.rpc("lfh_owner_restaurant_revenue", { p_from: from, p_to: to, p_ids: pIds });
      if (res.error) throw res.error;
      const rows = ((res.data ?? []) as Row[]).map((r) => ({
        id: r.restaurant_id, name: r.name, accent: r.accent_color || "",
        revenue: num(r.revenue), orders: Number(r.orders) || 0,
      })).sort((a, b) => b.revenue - a.revenue);
      return { type, range, rows };
    }

    if (type === "payments") {
      const per = await mapLimit(ridList, 8, (id) =>
        sb.rpc("lfh_owner_payment_breakdown", { p_restaurant_id: id, p_from: from, p_to: to }));
      // Degrade gracefully: keep the restaurants that succeeded (audit 2026-07-09).
      const okData = per.filter((p) => !p.error).map((p) => (p.data ?? []) as Row[]);
      if (!okData.length && per.length) throw per.find((p) => p.error)?.error || new Error("Report failed");
      const rows = mergeBy(okData, "method", ["revenue", "orders"])
        .map((r) => ({ method: r.method, revenue: num(r.revenue), orders: Number(r.orders) || 0 }))
        .sort((a, b) => b.revenue - a.revenue);
      return { type, range, rows };
    }

    // ── TEAM & PAY: the two money truths side by side ───────────────────────────
    //   cash    — what actually left the till, on the day it left (drives the day book line)
    //   monthly — what the team COST for a month vs what was paid for that month (still owed)
    //   people  — per-person totals for the table
    if (type === "staffpay") {
      const ids = (rid ? [rid] : scopeIds).filter(Boolean) as string[];
      const f = from.slice(0, 10), t2 = to.slice(0, 10);
      const per = await mapLimit(ids, 6, async (id) => {
        const [cash, monthly, people, staff] = await Promise.all([
          sb.rpc("lfh_staff_pay_cashflow", { p_restaurant: id, p_from: f, p_to: t2, p_bucket: bucket === "month" ? "month" : "day" }),
          sb.rpc("lfh_staff_pay_monthly_cost", { p_restaurant: id, p_from: f, p_to: t2 }),
          sb.rpc("lfh_staff_pay_summary", { p_restaurant: id, p_from: f, p_to: t2 }),
          sb.from("staff_users").select("id, name, username, role, designation, pay_type, pay_amount")
            .eq("restaurant_id", id).is("deleted_at", null).limit(500),
        ]);
        return { cash: cash.data || [], monthly: monthly.data || [], people: people.data || [], staff: staff.data || [] };
      });
      const nameOf = new Map<string, { name: string; role: string; designation: string | null; pay_type: string | null; pay_amount: number | null }>();
      for (const p of per) for (const s2 of p.staff as any[])
        nameOf.set(s2.id, { name: s2.name || s2.username, role: s2.role, designation: s2.designation, pay_type: s2.pay_type, pay_amount: s2.pay_amount });
      const cashRows = mergeBy(per.map((p) => p.cash as Row[]), "bucket", ["paid_out", "people", "entries"])
        .map((r) => ({ bucket: String(r.bucket), paid_out: num(r.paid_out), people: Number(r.people) || 0, entries: Number(r.entries) || 0 }))
        .sort((a, b) => a.bucket.localeCompare(b.bucket));
      const monthRows = mergeBy(per.map((p) => p.monthly as Row[]), "bucket", ["expected", "paid", "owed", "people", "est_excluded"])
        .map((r) => ({ bucket: String(r.bucket), expected: num(r.expected), paid: num(r.paid), owed: num(r.owed), people: Number(r.people) || 0, est_excluded: Number(r.est_excluded) || 0 }))
        .sort((a, b) => a.bucket.localeCompare(b.bucket));
      const people = per.flatMap((p) => (p.people as any[]))
        .filter((r) => Number(r.paid) > 0 || Number(r.advance_outstanding) > 0)
        .map((r) => ({
          staff_id: r.staff_id, name: nameOf.get(r.staff_id)?.name || "—", role: nameOf.get(r.staff_id)?.role || "",
          designation: nameOf.get(r.staff_id)?.designation || null,
          pay_type: nameOf.get(r.staff_id)?.pay_type || null, pay_amount: num(nameOf.get(r.staff_id)?.pay_amount),
          paid: num(r.paid), salary: num(r.salary_paid), advance: num(r.advance_paid), bonus: num(r.bonus_paid),
          overtime: num(r.overtime_paid), other: num(r.other_paid), entries: Number(r.entries) || 0,
          advanceOutstanding: num(r.advance_outstanding), lastPaidOn: r.last_paid_on || null,
        }))
        .sort((a, b) => b.paid - a.paid);
      const totals = {
        paidOut: cashRows.reduce((s2, r) => s2 + r.paid_out, 0),
        expected: monthRows.reduce((s2, r) => s2 + r.expected, 0),
        owed: monthRows.reduce((s2, r) => s2 + r.owed, 0),
        people: people.length,
        advanceOutstanding: people.reduce((s2, r) => s2 + r.advanceOutstanding, 0),
        estExcluded: monthRows.reduce((s2, r) => Math.max(s2, r.est_excluded), 0),
      };
      return { type, range, bucket, cashRows, monthRows, people, totals };
    }

    // ── TEAM PERFORMANCE: one row per person, owner-only leaderboard ────────────
    if (type === "staffperf") {
      const ids = (rid ? [rid] : scopeIds).filter(Boolean) as string[];
      const per = await mapLimit(ids, 6, async (id) => {
        const [perf, staff] = await Promise.all([
          sb.rpc("lfh_staff_performance", { p_restaurant: id, p_from: from, p_to: to }),
          sb.from("staff_users").select("id, name, username, role, designation, active")
            .eq("restaurant_id", id).is("deleted_at", null).in("role", ["manager", "tablet"]).limit(500),
        ]);
        return { perf: (perf.data || []) as any[], staff: (staff.data || []) as any[] };
      });
      const who = new Map<string, { name: string; role: string; designation: string | null; active: boolean }>();
      for (const p of per) for (const s2 of p.staff)
        who.set(s2.id, { name: s2.name || s2.username, role: s2.role, designation: s2.designation, active: s2.active });
      const rows = per.flatMap((p) => p.perf)
        .filter((r) => who.has(r.staff_id))                       // managers + waiters only
        .map((r) => ({
          staff_id: r.staff_id, name: who.get(r.staff_id)!.name, role: who.get(r.staff_id)!.role,
          designation: who.get(r.staff_id)!.designation, active: who.get(r.staff_id)!.active,
          daysActive: Number(r.days_active) || 0, hours: num(r.hours_active), actions: Number(r.actions) || 0,
          orders: Number(r.orders_punched) || 0, value: num(r.value_punched),
          tables: Number(r.tables_served) || 0, sittings: Number(r.guests_served) || 0,
          discount: num(r.discount_given), ratings: Number(r.ratings) || 0,
          avgRating: r.avg_rating === null ? null : num(r.avg_rating), paid: num(r.paid),
          lastSeen: r.last_seen || null,
        }))
        .sort((a, b) => b.value - a.value || b.orders - a.orders);
      const totals = {
        people: rows.length,
        active: rows.filter((r) => r.daysActive > 0 || r.orders > 0).length,
        orders: rows.reduce((s2, r) => s2 + r.orders, 0),
        value: rows.reduce((s2, r) => s2 + r.value, 0),
        hours: rows.reduce((s2, r) => s2 + r.hours, 0),
        paid: rows.reduce((s2, r) => s2 + r.paid, 0),
      };
      return { type, range, rows, totals };
    }

        throw new Error("unknown report type");
      },
    });
    return NextResponse.json(payload);
  } catch (e) {
    // Supabase errors are plain objects ({code,message,…}), not Error instances — String(e)
    // rendered "[object Object]". Surface the real message, and turn a statement-timeout
    // (57014, the analytics scan under load) into advice the owner can act on.
    const raw = e instanceof Error ? e.message
      : (e && typeof e === "object" && "message" in e) ? String((e as { message: unknown }).message)
      : String(e);
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
    const msg = (code === "57014" || /statement timeout/i.test(raw))
      ? "This report took too long to build. Try a shorter period, or one restaurant at a time."
      : raw;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
