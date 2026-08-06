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
import { signRows } from "@/lib/mediaLinks";
import { ownerScope, scopedRestaurantIds, dbFail } from "@/lib/ownerScope";
import { istDateOf } from "@/lib/staffProfileShared";
import { entitledSubset } from "@/lib/ownerEntitlements";
import { effectiveTaxPct, priceTaxMode, TAX_SETTINGS_COLUMNS } from "@/lib/tax";
import { cachedOwnerPayload, scopeKeyOf, ordersFingerprint, reportMonthFingerprint } from "@/lib/ownerCache";
import { payrollLadder, inventoryLadder, payrollEffectiveByRid, inventoryEffectiveByRid } from "@/lib/tableTags";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const IST = 5.5 * 3600_000;
const BIZ_START_H = 5;                       // a restaurant's day starts at 05:00 IST
/** The 05:00-IST business day that CONTAINS the IST calendar date `d` (YYYY-MM-DD). */
function businessDayWindow(d: string): { from: number; to: number } {
  const [y, m, dd] = d.split("-").map(Number);
  const from = Date.UTC(y, (m || 1) - 1, dd || 1, BIZ_START_H, 0, 0) - IST;
  return { from, to: from + DAY };
}
function windowFor(range: string, sp?: URLSearchParams): { from: string; to: string; bucket: string } {
  // ── ONE business day (the Day summary sheet) ────────────────────────────────
  // `range=day&date=YYYY-MM-DD` = [that date 05:00 IST, the next 05:00 IST) — the SAME day a
  // restaurant means by "today": the manager dashboard (businessDayStartIso), the manager
  // Z-report, `range=today` here and the owner dashboard's "TODAY SO FAR" tile all use it.
  //
  // The day sheet used to be fetched as `range=custom&from=D&to=D`, i.e. a CALENDAR day from
  // 00:00 IST, so the 00:00–05:00 slice of trade was counted on the previous business day by
  // every other screen and again on this sheet. Measured 4 Aug 2026 on the backup demo: the
  // sheet said ₹38,640 / 111 orders while Sales "Today", the dashboard and the Z-report all
  // said ₹30,324 / 90 (owner-panel sweep). Named `day` rather than folding it into `custom`
  // because a custom range IS calendar-based on purpose — a GST filing period is.
  if (range === "day" && sp) {
    const d = sp.get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const w = businessDayWindow(d);
      if (Number.isFinite(w.from)) {
        return { from: new Date(w.from).toISOString(), to: new Date(Math.min(w.to, Date.now())).toISOString(), bucket: "hour" };
      }
    }
    return windowFor("today");
  }
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

// ── DOCUMENT DATES vs the 05:00-IST BUSINESS DAY ──────────────────────────────────────────
// Purchases, waste and expenses carry a DATE (bill_date / waste_date / expense_date), not an
// instant, so a window of instants has to be turned into a first/last calendar date.
//
// `istDay(from)` is the low bound and is always right. The HIGH bound used to be
// `istDay(to − 1ms)`, which silently assumes the window ends on an exclusive IST MIDNIGHT.
// That holds for `custom` and `lastmonth` — but NOT for a window that ends on a business-day
// boundary: `range=yesterday` ends at 05:00 IST *today*, so `to − 1ms` still landed on TODAY'S
// date and a one-day report covered TWO calendar days (measured 4 Aug 2026: 2026-08-03 →
// 2026-08-04). Stepping back the 5-hour business-day offset first fixes that case and leaves
// every other range on the same date it had: "now"-ending ranges lose 5h and stay on today,
// a midnight-ending range lands on its last real day.
// mig 288 applies the IDENTICAL rule inside the inventory SQL, so the hero band and these
// lists can never describe different windows.
const istDay = (iso: string, backMs = 0) =>
  new Date(Date.parse(iso) + IST - backMs).toISOString().slice(0, 10);
const docDateHi = (toIso: string) => istDay(toIso, BIZ_START_H * 3600_000 + 1);

/** How many detail rows an inventory list returns before it says "there are more". */
const MERGED_CAP = 300;

// Every range windowFor() understands. An unknown value used to fall through to
// "today" for the DATA but was still echoed back verbatim in the response, so the
// client title (which looks range up in a fixed table) rendered blank (bug L-…).
// Normalising here means `range` in the payload is ALWAYS a known key.
const VALID_RANGES = new Set(["today", "yesterday", "week", "7d", "30d", "month", "lastmonth", "12m", "fy", "all", "custom", "day"]);

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

  const KNOWN = new Set(["sales", "tax", "discounts", "cancellations", "daysummary", "dishes", "categories", "hourly", "payments", "byrestaurant", "staffpay", "staffperf",
    // Inventory & stock (mig 227) — one type per sub-tab of the Inventory report.
    "invstock", "invpurchases", "invusage", "invwaste", "invexpenses"]);
  if (!KNOWN.has(type)) return NextResponse.json({ error: "unknown report type" }, { status: 400 });
  // ── Inventory & stock (mig 227) — gated by the inventory MODULE, exactly like the
  // payroll block below: nothing is read, cached or returned for a restaurant that
  // doesn't have the feature, so the report card can never open onto dead UI.
  // Stock is per-restaurant by nature (you can't sum one kitchen's shelf into another's),
  // so an all-restaurants scope must pick one first.
  const invType = type.startsWith("inv");
  if (invType) {
    const ids = (rid ? [rid] : scope.all ? [] : scope.ids).filter(Boolean) as string[];
    if (!ids.length)
      return NextResponse.json({ error: "Pick one restaurant to see its stock.", disabled: true }, { status: 400 });
    const on = await Promise.all(ids.map((id) => inventoryLadder(id).then((l) => l.effective)));
    if (!on.some(Boolean))
      return NextResponse.json({ error: "Inventory isn't enabled for this restaurant — contact Aevidine.", disabled: true }, { status: 403 });
  }
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
  // v3 (mig 227): the money payloads gained `inventory` + `costSeries`. The fingerprint
  // only notices DATA changes, so without bumping this version every owner would keep
  // being served a pre-inventory snapshot — the new day-sheet tiles and the cost line
  // would silently never appear until the snapshot happened to expire. BUMP THIS VERSION
  // WHENEVER A PAYLOAD SHAPE CHANGES, not just when the numbers change.
  // v4: the day sheet moved from a calendar day (`range=custom`) to the 05:00-IST BUSINESS day
  // (`range=day`), so its numbers changed shape-for-shape — old rows must not be served.
  const rangePart = range === "custom" ? `custom:${sp.get("from")}:${sp.get("to")}`
    : range === "day" ? `day:${sp.get("date")}`
    : `${range}:${from.slice(0, 10)}`;
  const cacheKey = `reports:v4:${scopeKeyOf(rid, scope.all, scopeIds)}:${type}:${rangePart}`;
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
  // Inventory reports are driven by inv_movements / inv_purchases / expenses / recipe rows,
  // none of which the orders fingerprint knows about — a recorded purchase or a re-mapped
  // recipe would NOT invalidate the snapshot and the owner would keep reading yesterday's
  // stock. Cheap indexed heads instead (same shape as staffFingerprint).
  const invFingerprint = async (): Promise<string> => {
    const ids = (rid ? [rid] : scope.all ? [] : scope.ids).filter(Boolean) as string[];
    if (!ids.length) return "0";
    const [mv, ex, rl] = await Promise.all([
      sb.from("inv_movements").select("id").in("restaurant_id", ids).order("id", { ascending: false }).limit(1),
      sb.from("expenses").select("created_at, voided_at").in("restaurant_id", ids).order("created_at", { ascending: false }).limit(1),
      sb.from("inv_recipe_lines").select("id", { count: "exact", head: true }).in("restaurant_id", ids),
    ]);
    const m = (mv.data || [])[0] as { id?: number } | undefined;
    const e = (ex.data || [])[0] as { created_at?: string; voided_at?: string | null } | undefined;
    // The dish-cost/coverage views also move when ORDERS move (qty sold), so fold the
    // orders detector in for the usage view — a new order must refresh the cost of sales.
    const ordersPart = type === "invusage" ? await ordersFingerprint(fpIds, from, to).catch(() => "x") : "";
    return [m?.id ?? 0, e?.created_at ?? "", e?.voided_at ?? "", rl.count ?? 0, ordersPart].join("|");
  };

  try {
    const payload = await cachedOwnerPayload({
      key: cacheKey, force,
      fingerprint: () => (invType ? invFingerprint()
        : staffType ? staffFingerprint()
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
      let tax: { effectivePct: number; components: { label: string; rate: number; amount: number }[]; configured: boolean; composition: boolean } | null = null;
      if (rid) {
        const st = await sb.from("settings").select(TAX_SETTINGS_COLUMNS).eq("restaurant_id", rid).maybeSingle();
        if (st.error) throw st.error;
        const comps = (Array.isArray(st.data?.tax_components) ? st.data!.tax_components : [])
          .map((c: Row) => ({ label: String(c?.label ?? "").trim(), rate: Number(c?.rate) || 0 }))
          .filter((c: { label: string; rate: number }) => c.label && c.rate > 0);
        const pct = effectiveTaxPct(st.data);
        // COMPOSITION SCHEME: the restaurant cannot legally pass GST to the diner, so
        // `effectiveTaxPct` is 0 and the printed bill shows NO tax line at all
        // (lib/tax.ts → composition, docs/COMPLIANCE-GUARDRAILS.md). The report used to build
        // the 50/50 fallback anyway and rendered a CGST/SGST table of zeroes plus the note
        // "showing the standard CGST/SGST halves" — telling a composition restaurant it has
        // tax lines and taxable supplies when it has neither (owner-panel sweep 2026-08-04).
        // Ship the FLAG instead and let the report say the true thing.
        const composition = priceTaxMode(st.data) === "composition";
        // No named components → the printed bill splits 50/50 CGST+SGST (mig 117).
        const effective = composition ? [] : comps.length ? comps : [
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
        tax = { effectivePct: pct, components, configured: comps.length > 0, composition };
      }

      // Day summary also needs the settlement split (how the money arrived). Same merge
      // the /payments report uses; degrade gracefully if a restaurant's RPC fails.
      let payments: { method: unknown; revenue: number; orders: number }[] | undefined;
      if (type === "daysummary") {
        let payRaw: Row[];
        // Set when the ONE read this branch depends on failed — see the note in the else-branch.
        let payUnreadable = false;
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
          // AN EMPTY LIST AND A FAILED READ ARE DIFFERENT SENTENCES (T9 sweep, 2026-08-06).
          // `one.error` was never read, so a failed breakdown produced `payments: []` — which renders
          // as a settlement table with no rows, i.e. "no money arrived by any method" on a sheet that
          // is simultaneously showing revenue. Every other optional line on this sheet (tips,
          // staffPay, inventory) is deliberately NULL on failure so the block is omitted entirely
          // rather than stating a zero; the settlement split now follows its neighbours. `undefined`
          // is exactly what `payments` starts as, so the sheet renders as it did before the line
          // existed. The scoped-owner branch above already degrades via its own fallback.
          if (one.error) {
            console.error("[owner/reports] daysummary payment breakdown failed:", one.error.message);
            payRaw = [];
            payUnreadable = true;
          } else {
            payRaw = (one.data ?? []) as Row[];
          }
        }
        // `undefined` (not []) when we couldn't read it, so the sheet omits the block entirely —
        // exactly as it did before this line existed, and as tips/staffPay/inventory already do.
        payments = payUnreadable
          ? undefined
          : payRaw
              .map((r) => ({ method: r.method, revenue: num(r.revenue), orders: Number(r.orders) || 0 }))
              .sort((a, b) => b.revenue - a.revenue);
      }
      // STAFF PAY paid out in this same window (mig 220) — the day book's "money out" line.
      // Cash truth: the day the money actually left, matching the Team & pay report's cash view.
      // Only for a restaurant that HAS the module, and only on the day sheet (one tiny indexed
      // read; a NULL keeps the line off the sheet entirely rather than printing a fake zero).
      let staffPay: { paidOut: number; people: number; entries: number } | null = null;
      if (type === "daysummary") {
        // Enumerate for the ADMIN's all-restaurants sheet too (T9 sweep, 2026-08-05): `scopeIds` is
        // [] for scope.all, so this line used to vanish from that view with no note — the identical
        // fault the tips line above was fixed for. Cheap in practice: payroll is an opt-in module
        // that starts OFF for every restaurant, so `enabled` is a small set, and the rung is now
        // read for the whole list in ONE settings query instead of one round-trip each.
        const payIds = (rid
          ? [rid]
          : scope.all ? await scopedRestaurantIds(scope).catch(() => [] as string[]) : scopeIds
        ).filter(Boolean) as string[];
        const payEff = await payrollEffectiveByRid(payIds);
        const enabled = payIds.filter((id) => payEff[id] === true);
        if (enabled.length) {
          const per = await mapLimit(enabled, 6, (id) =>
            // docDateHi, NOT istDateOf: this window ends at 05:00 IST TOMORROW, so istDateOf
            // returned tomorrow's date and a salary recorded the next morning landed on this
            // day's sheet (T5 sweep, 2026-08-06). Same rule the inventory lists already use.
            sb.rpc("lfh_staff_pay_cashflow", { p_restaurant: id, p_from: istDateOf(from), p_to: docDateHi(to), p_bucket: "day" }));
          const rowsSp = per.filter((x) => !x.error).flatMap((x) => (x.data ?? []) as Row[]);
          if (rowsSp.length) staffPay = {
            paidOut: rowsSp.reduce((a, r) => a + num(r.paid_out), 0),
            people: Math.max(...rowsSp.map((r) => Number(r.people) || 0)),
            entries: rowsSp.reduce((a, r) => a + (Number(r.entries) || 0), 0),
          };
          else staffPay = { paidOut: 0, people: 0, entries: 0 };
        }
      }
      // TIPS COLLECTED in this window (mig 154 stored them, mig 268 surfaces them — sweep F20).
      // Migration 154's own header says "Reports read SUM(orders.tip) as tips collected", and
      // exactly one report did: the manager's Z-report. The OWNER had no tips figure at any
      // range, for any restaurant — yet it is money staff are owed, so it belongs on the day
      // sheet beside "money out". It is deliberately NOT added to revenue: a tip is extra money
      // for staff on top of the bill and must not enter subtotal/tax/total (mig 154's rule).
      // Same nullable shape as staffPay: null keeps the line off the sheet entirely, so a
      // restaurant that takes no tips sees no trace of it rather than a fake ₹0.
      let tips: { collected: number; orders: number } | null = null;
      if (type === "daysummary") {
        // Tips DO merge across restaurants (unlike a shelf of stock or a person's salary), so
        // the ADMIN's all-restaurants day sheet gets them too. `scopeIds` is [] for scope.all,
        // which used to mean the tips line silently vanished from that view with no note
        // (owner-panel sweep 2026-08-04). The ids must be ENUMERATED — mig 281 makes
        // lfh_owner_tips return NOTHING when both scope arguments are null, deliberately, so a
        // caller that forgets its scope gets zero instead of the platform's tips.
        // scopedRestaurantIds now THROWS rather than returning a partial list (T9 sweep,
        // 2026-08-05). This block's own stated policy is fail-open — "a tips hiccup must never
        // blank the sheet" — so an unreadable list drops the tips LINE (null, no trace) instead of
        // failing the whole day sheet. It must never fall back to a partial list: that would print
        // a tips figure that is quietly too small, which is the very thing the throw prevents.
        const tipIds = (rid
          ? [rid]
          : scope.all ? await scopedRestaurantIds(scope).catch(() => [] as string[]) : scopeIds
        ).filter(Boolean) as string[];
        if (tipIds.length) {
          // One indexed read (idx_orders_tips is partial — only orders that carry a tip).
          const t = await sb.rpc("lfh_owner_tips", {
            p_restaurant_id: tipIds.length === 1 ? tipIds[0] : null,
            p_from: from, p_to: to,
            p_ids: tipIds.length === 1 ? null : tipIds,
          });
          // Fail-open like the inventory lines below: a tips hiccup must never blank the sheet.
          if (!t.error) {
            const r0 = ((t.data ?? []) as Row[])[0] || {};
            const collected = num(r0.tips);
            if (collected > 0) tips = { collected, orders: Number(r0.tipped_orders) || 0 };
          }
        }
      }
      // ── INVENTORY on the money reports (mig 227) ────────────────────────────
      // Day summary gets the inventory money lines in the SAME shape as staffPay: a
      // NULL keeps them off the sheet entirely rather than printing fake zeroes, so a
      // restaurant without the module sees no trace of it. The sales report gets the
      // bucketed cost SERIES — the second "cost" line on the chart that was deferred
      // until inventory existed.
      let inventory: {
        bought: number; usedActual: number; usedTheoretical: number; wasted: number;
        expenses: number; stockValue: number; lowCount: number; negativeCount: number;
        foodCostPct: number | null; coveragePct: number; hasRecipes: boolean;
      } | null = null;
      let costSeries: { bucket: string; purchased: number; used: number; wasted: number }[] | null = null;
      // FAIL-OPEN, like the depletion trigger: inventory is an ADD-ON to these money
      // reports, so a stock hiccup (a ladder read blipping, an RPC erroring) must never
      // blank the owner's Sales figures or Day summary. On any failure `inventory` and
      // `costSeries` simply stay null and the sheet renders exactly as it did before the
      // module existed.
      try {
      if (type === "daysummary" || type === "sales") {
        // Same enumeration + one-query rung read as the staff-pay block above, for the same reason:
        // the admin's all-restaurants sheet used to drop these money lines silently. Inventory is
        // also an opt-in module that starts OFF, so `enabledInv` stays small.
        const invIds = (rid
          ? [rid]
          : scope.all ? await scopedRestaurantIds(scope).catch(() => [] as string[]) : scopeIds
        ).filter(Boolean) as string[];
        const invEff = await inventoryEffectiveByRid(invIds);
        const enabledInv = invIds.filter((id) => invEff[id] === true);
        if (enabledInv.length) {
          // Sum across the owner's inventory-enabled restaurants (each RPC is per-restaurant).
          const [sums, covs, dishes, seriesPer] = await Promise.all([
            mapLimit(enabledInv, 6, (id) => sb.rpc("lfh_inv_report_summary", { p_restaurant: id, p_from: from, p_to: to })),
            mapLimit(enabledInv, 6, (id) => sb.rpc("lfh_inv_coverage", { p_restaurant: id, p_from: from, p_to: to })),
            mapLimit(enabledInv, 6, (id) => sb.rpc("lfh_inv_dish_cost", { p_restaurant: id, p_from: from, p_to: to })),
            type === "sales"
              ? mapLimit(enabledInv, 6, (id) => sb.rpc("lfh_inv_cost_series", { p_restaurant: id, p_from: from, p_to: to, p_bucket: bucket === "month" ? "month" : "day" }))
              : Promise.resolve([] as { data?: unknown; error?: unknown }[]),
          ]);
          const sRows = sums.filter((x) => !x.error).flatMap((x) => (x.data ?? []) as Row[]);
          const cRows = covs.filter((x) => !x.error).flatMap((x) => (x.data ?? []) as Row[]);
          const dRows = dishes.filter((x) => !x.error).flatMap((x) => (x.data ?? []) as Row[]);
          const add = (rows: Row[], k: string) => rows.reduce((a, r) => a + num(r[k]), 0);
          const theoretical = dRows.reduce((a, d) => a + num(d.cost_total), 0);
          const covRev = add(cRows, "covered_revenue");
          const totRev = add(cRows, "total_revenue");
          inventory = {
            bought: add(sRows, "purchases_amt"),
            usedActual: add(sRows, "consumed_val"),
            usedTheoretical: theoretical,
            wasted: add(sRows, "wasted_val"),
            expenses: add(sRows, "expenses_amt"),
            stockValue: add(sRows, "stock_value"),
            lowCount: sRows.reduce((a, r) => a + (Number(r.low_count) || 0), 0),
            negativeCount: sRows.reduce((a, r) => a + (Number(r.negative_count) || 0), 0),
            // Same honesty rule as the inventory report: divide by COVERED revenue only.
            foodCostPct: covRev > 0 ? (theoretical / covRev) * 100 : null,
            coveragePct: totRev > 0 ? (covRev / totRev) * 100 : 0,
            // Lets the tile tell "you haven't mapped any recipes" apart from "recipes exist
            // but none of those dishes sold in this window" — the same null otherwise.
            hasRecipes: cRows.some((r) => (Number(r.mapped_recipes) || 0) > 0),
          };
          if (type === "sales" && seriesPer.length) {
            const merged = new Map<string, { bucket: string; purchased: number; used: number; wasted: number }>();
            for (const p of seriesPer) {
              if (p.error) continue;
              for (const r of ((p.data ?? []) as Row[])) {
                const k = String(r.bucket);
                const cur = merged.get(k) || { bucket: k, purchased: 0, used: 0, wasted: 0 };
                cur.purchased += num(r.purchased); cur.used += num(r.used); cur.wasted += num(r.wasted);
                merged.set(k, cur);
              }
            }
            costSeries = [...merged.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
          }
        }
      }
      } catch { inventory = null; costSeries = null; }
      return { type, range, bucket, rows, totals, tax, payments, staffPay, tips, inventory, costSeries, drillBucket, drillRows };
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
        // `.limit()` matters: past PostgREST's 1000-row default every label past the 1000th
        // restaurant silently became "Dish · —". Ask for exactly as many as we're looking up.
        const nq = await sb.from("restaurants").select("id, name").in("id", okIds).limit(okIds.length);
        if (nq.error) throw nq.error;   // a swallowed failure renamed EVERY dish to "Dish · —"
        for (const x of (nq.data || []) as { id: string; name: string }[]) nameById[x.id] = x.name;
        rowsets = rowsets.map((rows, i) => rows.map((r) => ({ ...r, [keyCol]: `${String(r[keyCol])} · ${nameById[okIds[i]] || "—"}` })));
      }
      const rows: Row[] = mergeBy(rowsets, keyCol, numeric)
        .map((r) => ({ ...r, revenue: num(r.revenue) }));
      rows.sort((a, b) => (type === "hourly" ? Number(a.hour) - Number(b.hour) : Number(b.revenue) - Number(a.revenue)));
      return { type, range, rows };
    }

    // ══ INVENTORY & STOCK (mig 227) ═══════════════════════════════════════════
    // One restaurant at a time (stock can't be summed across kitchens — the gate above
    // already refused an all-restaurants scope). Every sub-tab shares the same summary
    // hero band so the five views agree with each other by construction.
    //
    // THE TWO COST TRUTHS, deliberately both returned (research §1.3):
    //   theoreticalCost = recipe cost × qty sold  → valid over ANY window, drives the
    //                     food-cost % and per-dish margins.
    //   actualUsed      = what the movement ledger recorded → only exists from the day
    //                     recipes were mapped, so it is NOT a food-cost denominator;
    //                     it's "what really left the shelf", and the gap vs theoretical
    //                     is the variance. `costDataFrom` tells the UI when the ledger
    //                     started, so a 30-day window can't imply 30 days of ledger.
    if (invType) {
      // ── ALL-RESTAURANTS (merged) mode ────────────────────────────────────────
      // A multi-restaurant owner viewing "All restaurants" must NOT be shown one
      // kitchen's shelf labelled as the whole group's — that was the behaviour when this
      // block assumed a single restaurant (it silently used scopeIds[0]). Totals DO merge
      // meaningfully, so they are summed across the owner's inventory-enabled restaurants
      // and a per-restaurant breakdown is returned beside them.
      // What deliberately does NOT merge: COST PER DISH. A slug belongs to one
      // restaurant's menu, so summing "classic-cheeseburger" across kitchens would invent
      // a dish that doesn't exist. In merged mode the dish table is empty and `merged`
      // tells the UI to say "open one restaurant to see cost per dish".
      const invIdsAll = (rid ? [rid] : scopeIds).filter(Boolean) as string[];
      const invEnabled: string[] = [];
      for (const id of invIdsAll) if ((await inventoryLadder(id)).effective) invEnabled.push(id);
      if (!rid && invEnabled.length > 1) {
        const names = new Map(((await sb.from("restaurants").select("id, name").in("id", invEnabled)).data || [])
          .map((r) => [r.id as string, r.name as string]));
        const per = await mapLimit(invEnabled, 6, async (id) => {
          const [s, c, it, vd, sr] = await Promise.all([
            sb.rpc("lfh_inv_report_summary", { p_restaurant: id, p_from: from, p_to: to }),
            sb.rpc("lfh_inv_coverage", { p_restaurant: id, p_from: from, p_to: to }),
            sb.rpc("lfh_inv_report_items", { p_restaurant: id, p_from: from, p_to: to }),
            sb.rpc("lfh_inv_report_vendors", { p_restaurant: id, p_from: from, p_to: to }),
            sb.rpc("lfh_inv_cost_series", { p_restaurant: id, p_from: from, p_to: to, p_bucket: bucket === "month" ? "month" : "day" }),
          ]);
          const dq = await sb.rpc("lfh_inv_dish_cost", { p_restaurant: id, p_from: from, p_to: to });
          return { id, s: ((s.data ?? []) as Row[])[0] || {}, c: ((c.data ?? []) as Row[])[0] || {},
            items: (it.data ?? []) as Row[], vendors: (vd.data ?? []) as Row[], series: (sr.data ?? []) as Row[],
            theo: ((dq.data ?? []) as Row[]).reduce((a, d) => a + num(d.cost_total), 0) };
        });
        const S = (k: string) => per.reduce((a, p) => a + num(p.s[k]), 0);
        const C = (k: string) => per.reduce((a, p) => a + num(p.c[k]), 0);
        const I = (k: string) => per.reduce((a, p) => a + (Number(p.s[k]) || 0), 0);
        const theoreticalCost = per.reduce((a, p) => a + p.theo, 0);
        const coveredRevenue = C("covered_revenue"), totalRevenue = C("total_revenue");
        // Ingredients merge on (name + buying unit) — same name in a different unit stays a
        // separate row rather than being added to something it isn't.
        const iMap = new Map<string, Record<string, number | string | null>>();
        for (const p of per) for (const i of p.items) {
          const k = `${String(i.name).toLowerCase()}|${i.purchase_uom}`;
          const cur = iMap.get(k) || { id: k, name: String(i.name), category: String(i.category || ""),
            baseUom: String(i.base_uom), buyUom: String(i.purchase_uom), factor: num(i.purchase_factor) || 1,
            onHandBase: 0, onHandVal: 0, parQty: null, boughtBase: 0, boughtVal: 0, usedBase: 0, usedVal: 0,
            wastedBase: 0, wastedVal: 0, adjustBase: 0, adjustVal: 0 };
          for (const [dst, src] of [["onHandBase", "on_hand_base"], ["onHandVal", "on_hand_val"], ["boughtBase", "bought_base"],
            ["boughtVal", "bought_val"], ["usedBase", "used_base"], ["usedVal", "used_val"], ["wastedBase", "wasted_base"],
            ["wastedVal", "wasted_val"], ["adjustBase", "adjust_base"], ["adjustVal", "adjust_val"]] as const)
            (cur as Record<string, number>)[dst] = num((cur as Record<string, number>)[dst]) + num(i[src]);
          if (i.par_qty != null) cur.parQty = num(cur.parQty) + num(i.par_qty);
          iMap.set(k, cur);
        }
        const vMap = new Map<string, { vendor: string; bills: number; amount: number; isCash: boolean }>();
        for (const p of per) for (const v of p.vendors) {
          const k = String(v.vendor);
          const cur = vMap.get(k) || { vendor: k, bills: 0, amount: 0, isCash: v.is_cash === true };
          cur.bills += Number(v.bills) || 0; cur.amount += num(v.amount);
          vMap.set(k, cur);
        }
        const sMap = new Map<string, { bucket: string; purchased: number; used: number; wasted: number }>();
        for (const p of per) for (const r of p.series) {
          const k = String(r.bucket);
          const cur = sMap.get(k) || { bucket: k, purchased: 0, used: 0, wasted: 0 };
          cur.purchased += num(r.purchased); cur.used += num(r.used); cur.wasted += num(r.wasted);
          sMap.set(k, cur);
        }
        const dFromM = istDay(from), dToM = docDateHi(to);   // same business-day rule as single mode
        const [expM, wasteM] = await Promise.all([
          type === "invexpenses"
            ? sb.from("expenses").select("id, category, title, amount, expense_date, note, photo_url, created_by, voided_at, void_reason, restaurant_id")
                .in("restaurant_id", invEnabled).gte("expense_date", dFromM).lte("expense_date", dToM)
                .order("expense_date", { ascending: false }).limit(MERGED_CAP + 1)
            : Promise.resolve({ data: [] as Row[] }),
          type === "invwaste"
            ? sb.from("inv_waste_entries").select("id, item_id, qty_base, reason, note, unit_cost_snap, waste_date, created_by, voided_at")
                .in("restaurant_id", invEnabled).gte("waste_date", dFromM).lte("waste_date", dToM)
                .order("waste_date", { ascending: false }).limit(MERGED_CAP + 1)
            : Promise.resolve({ data: [] as Row[] }),
        ]);
        // Same "say it out loud" rule as the single-restaurant lists below.
        const expMRows = (expM.data || []) as Row[], wasteMRows = (wasteM.data || []) as Row[];
        const expMMore = expMRows.length > MERGED_CAP, wasteMMore = wasteMRows.length > MERGED_CAP;
        return {
          type, range, bucket, merged: true,
          summary: {
            stockValue: S("stock_value"), stockItems: I("stock_items"),
            lowCount: I("low_count"), negativeCount: I("negative_count"),
            purchases: S("purchases_amt"), purchaseCount: I("purchases_count"),
            actualUsed: S("consumed_val"), wasted: S("wasted_val"), wasteCount: I("waste_count"),
            expenses: S("expenses_amt"), corrections: S("adjust_val"),
            theoreticalCost, foodCostPct: coveredRevenue > 0 ? (theoreticalCost / coveredRevenue) * 100 : null,
          },
          coverage: {
            totalRevenue, coveredRevenue,
            totalDishes: C("total_dishes"), coveredDishes: C("covered_dishes"),
            mappedRecipes: C("mapped_recipes"), menuDishes: C("menu_dishes"),
            pct: totalRevenue > 0 ? (coveredRevenue / totalRevenue) * 100 : 0,
          },
          costDataFrom: null,
          dishes: [],                       // per-menu — never merged across restaurants
          perRestaurant: per.map((p) => ({
            name: names.get(p.id) || "Restaurant",
            stockValue: num(p.s.stock_value), purchases: num(p.s.purchases_amt),
            expenses: num(p.s.expenses_amt), wasted: num(p.s.wasted_val), theoreticalCost: p.theo,
          })).sort((a, b) => b.stockValue - a.stockValue),
          items: [...iMap.values()],
          vendors: [...vMap.values()].sort((a, b) => b.amount - a.amount),
          series: [...sMap.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
          // Multi-restaurant path — the same signing (lib/mediaLinks.ts). Both branches matter:
          // an owner with several restaurants reads this one.
          expenses: await signRows("inv-media", (expMMore ? expMRows.slice(0, MERGED_CAP) : expMRows) as Record<string, unknown>[], ["photo_url"]),
          waste: wasteMMore ? wasteMRows.slice(0, MERGED_CAP) : wasteMRows,
          listCap: MERGED_CAP, expensesMore: expMMore, wasteMore: wasteMMore,
        };
      }
      // ── single restaurant (explicit ?rid, or the owner only has one with the module) ──
      const one = rid || invEnabled[0] || (scopeIds[0] as string);
      const [sum, cov, dish, items, vendors, series, firstMv] = await Promise.all([
        sb.rpc("lfh_inv_report_summary", { p_restaurant: one, p_from: from, p_to: to }),
        sb.rpc("lfh_inv_coverage", { p_restaurant: one, p_from: from, p_to: to }),
        sb.rpc("lfh_inv_dish_cost", { p_restaurant: one, p_from: from, p_to: to }),
        type === "invstock" || type === "invusage" || type === "invwaste"
          ? sb.rpc("lfh_inv_report_items", { p_restaurant: one, p_from: from, p_to: to })
          : Promise.resolve({ data: [], error: null }),
        type === "invpurchases"
          ? sb.rpc("lfh_inv_report_vendors", { p_restaurant: one, p_from: from, p_to: to })
          : Promise.resolve({ data: [], error: null }),
        sb.rpc("lfh_inv_cost_series", { p_restaurant: one, p_from: from, p_to: to, p_bucket: bucket === "month" ? "month" : "day" }),
        // When did this restaurant's stock ledger actually start? Anchors the honesty note.
        sb.from("inv_movements").select("created_at").eq("restaurant_id", one).order("id", { ascending: true }).limit(1),
      ]);
      if (sum.error) throw sum.error;
      const s = ((sum.data ?? []) as Row[])[0] || {};
      const c = ((cov.data ?? []) as Row[])[0] || {};
      const dishRows = ((dish.data ?? []) as Row[]).map((d) => ({
        slug: String(d.slug), title: String(d.title), price: num(d.price),
        qtySold: num(d.qty_sold), revenue: num(d.revenue),
        plateCost: num(d.plate_cost), costTotal: num(d.cost_total),
        ingredients: Number(d.ingredients) || 0,
        // Margin only means something once BOTH a price and a recipe exist.
        marginPct: num(d.price) > 0 ? (1 - num(d.plate_cost) / num(d.price)) * 100 : null,
      }));
      const theoreticalCost = dishRows.reduce((a, d) => a + d.costTotal, 0);
      const coveredRevenue = num(c.covered_revenue);
      const totalRevenue = num(c.total_revenue);
      // ONLY ever divided by covered revenue — see the migration header. A partially
      // mapped menu yields an honest "cost % on the dishes you've mapped", never a
      // flattering number spread over unmapped sales.
      const foodCostPct = coveredRevenue > 0 ? (theoreticalCost / coveredRevenue) * 100 : null;
      // DOCUMENT dates here too, so these lists add up to the hero band's totals (which
      // mig 227 computes on bill_date/expense_date/waste_date) and match the Inventory page.
      // from/to are UTC ISO instants — shift into IST before taking the calendar date, or
      // an IST-midnight window reads one day early (the SQL side uses AT TIME ZONE for
      // exactly this reason). The END bound uses the shared docDateHi() rule (lib/businessDay
      // note below) and compares INCLUSIVELY — a bare `< toDay` drops everything dated today.
      const dFrom = istDay(from), dTo = docDateHi(to);
      // LIST CAP, said out loud. These two detail lists are capped at 300 rows while the hero
      // band's totals come from the (uncapped) RPC — so past the cap the list quietly stopped
      // and stopped adding up to the total above it, with nothing on screen (owner-panel sweep
      // 2026-08-04). Ask for ONE more than the cap: if it comes back, the UI says so.
      const LIST_CAP = MERGED_CAP;
      const expensesRaw = type === "invexpenses"
        ? (await sb.from("expenses")
            .select("id, category, title, amount, expense_date, note, photo_url, created_by, voided_at, void_reason")
            .eq("restaurant_id", one).gte("expense_date", dFrom).lte("expense_date", dTo)
            .order("expense_date", { ascending: false }).limit(LIST_CAP + 1)).data || []
        : [];
      const expensesMore = expensesRaw.length > LIST_CAP;
      const expenses = expensesMore ? expensesRaw.slice(0, LIST_CAP) : expensesRaw;
      // Expense slips are private paperwork — sign them on the way out (lib/mediaLinks.ts).
      const expensesOut = await signRows("inv-media", expenses as Record<string, unknown>[], ["photo_url"]);
      const wasteRaw = type === "invwaste"
        ? (await sb.from("inv_waste_entries")
            .select("id, item_id, qty_base, reason, note, unit_cost_snap, waste_date, created_by, voided_at")
            .eq("restaurant_id", one).gte("waste_date", dFrom).lte("waste_date", dTo)
            .order("waste_date", { ascending: false }).limit(LIST_CAP + 1)).data || []
        : [];
      const wasteMore = wasteRaw.length > LIST_CAP;
      const waste = wasteMore ? wasteRaw.slice(0, LIST_CAP) : wasteRaw;
      return {
        type, range, bucket, rid: one,
        summary: {
          stockValue: num(s.stock_value), stockItems: Number(s.stock_items) || 0,
          lowCount: Number(s.low_count) || 0, negativeCount: Number(s.negative_count) || 0,
          purchases: num(s.purchases_amt), purchaseCount: Number(s.purchases_count) || 0,
          actualUsed: num(s.consumed_val), wasted: num(s.wasted_val), wasteCount: Number(s.waste_count) || 0,
          expenses: num(s.expenses_amt), corrections: num(s.adjust_val),
          theoreticalCost, foodCostPct,
        },
        coverage: {
          totalRevenue, coveredRevenue,
          totalDishes: Number(c.total_dishes) || 0, coveredDishes: Number(c.covered_dishes) || 0,
          mappedRecipes: Number(c.mapped_recipes) || 0, menuDishes: Number(c.menu_dishes) || 0,
          pct: totalRevenue > 0 ? (coveredRevenue / totalRevenue) * 100 : 0,
        },
        costDataFrom: ((firstMv.data ?? []) as Row[])[0]?.created_at ?? null,
        dishes: dishRows,
        items: ((items.data ?? []) as Row[]).map((i) => ({
          id: String(i.item_id), name: String(i.name), category: String(i.category || ""),
          baseUom: String(i.base_uom), buyUom: String(i.purchase_uom), factor: num(i.purchase_factor) || 1,
          onHandBase: num(i.on_hand_base), onHandVal: num(i.on_hand_val), parQty: i.par_qty == null ? null : num(i.par_qty),
          boughtBase: num(i.bought_base), boughtVal: num(i.bought_val),
          usedBase: num(i.used_base), usedVal: num(i.used_val),
          wastedBase: num(i.wasted_base), wastedVal: num(i.wasted_val),
          adjustBase: num(i.adjust_base), adjustVal: num(i.adjust_val),
        })),
        vendors: ((vendors.data ?? []) as Row[]).map((v) => ({
          vendor: String(v.vendor), bills: Number(v.bills) || 0, amount: num(v.amount), isCash: v.is_cash === true,
        })),
        series: ((series.data ?? []) as Row[]).map((r) => ({
          bucket: String(r.bucket), purchased: num(r.purchased), used: num(r.used), wasted: num(r.wasted),
        })),
        expenses: expensesOut, waste,
        // "there are more than these" — the UI prints a plain line instead of stopping silently.
        listCap: LIST_CAP, expensesMore, wasteMore,
      };
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
      // The high bound follows the BUSINESS day (docDateHi), so a "yesterday" report can't
      // reach into this morning's payments — the same fix as the day sheet above.
      const f = istDateOf(from), t2 = docDateHi(to);
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
    // Supabase errors are plain objects ({code,message,…}), not Error instances — String(e) rendered
    // "[object Object]". The statement-timeout translation this route pioneered (57014, the analytics
    // scan under load) now lives in the shared `dbFail` helper alongside it, so the other nine owner
    // endpoints get the same treatment instead of each shipping the raw sentence (T9 sweep,
    // 2026-08-06). The non-timeout branch used to return `raw` — the database's own words — which is
    // the one thing this file was already careful about for timeouts and not for anything else.
    return dbFail("owner/reports", e, {
      message: "Couldn't build that report just now — please try again.",
    });
  }
}
