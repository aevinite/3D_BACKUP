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

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
function windowFor(range: string): { from: string; to: string; bucket: string } {
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
const VALID_RANGES = new Set(["today", "yesterday", "7d", "30d", "month", "lastmonth", "12m", "fy", "all"]);

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
  const { from, to, bucket } = windowFor(range);

  // The restaurants this call may touch (for the merged all-restaurants shapes).
  const ridList: (string | null)[] = rid ? [rid] : scope.all ? [null] : scope.ids;

  try {
    // ── money reports: one bucketed summary drives sales/tax/discounts/cancellations ──
    if (type === "sales" || type === "tax" || type === "discounts" || type === "cancellations") {
      const res = await sb.rpc("lfh_owner_sales_report", {
        p_restaurant_id: rid, p_from: from, p_to: to, p_bucket: bucket,
      });
      if (res.error) throw res.error;
      // all-restaurants for a scoped owner: the RPC can't filter by ownership, so
      // sum each owned restaurant separately and merge the tiny bucket rows.
      let raw = (res.data ?? []) as Row[];
      if (!rid && !scope.all) {
        const per = await mapLimit(scope.ids, 8, (id) =>
          sb.rpc("lfh_owner_sales_report", { p_restaurant_id: id, p_from: from, p_to: to, p_bucket: bucket }));
        for (const p of per) if (p.error) throw p.error;
        raw = mergeBy(per.map((p) => (p.data ?? []) as Row[]), "bucket",
          ["orders", "paid_orders", "subtotal", "tax", "discount", "revenue", "cancelled_orders", "cancelled_value"]);
        raw.sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
      }
      const rows = raw.map((r) => ({
        bucket: r.bucket,
        orders: Number(r.orders) || 0,
        paidOrders: Number(r.paid_orders) || 0,
        subtotal: num(r.subtotal), tax: num(r.tax), discount: num(r.discount), revenue: num(r.revenue),
        cancelledOrders: Number(r.cancelled_orders) || 0, cancelledValue: num(r.cancelled_value),
      }));
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
      return NextResponse.json({ type, range, bucket, rows, totals, tax });
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
      for (const p of per) if (p.error) throw p.error;
      const keyCol = type === "dishes" ? "title" : type === "categories" ? "category" : "hour";
      const numeric = type === "hourly" ? ["orders", "revenue"] : ["qty", "revenue"];
      // Multi-restaurant dishes/categories: the SAME title in two brands is a DIFFERENT
      // product, so DON'T sum "Water"/"Margherita" across brands into one misleading row.
      // Label each row with its restaurant ("Water · Green Bowl") so identical names stay
      // distinct in the existing list (audit 2026-07-07). Hourly stays a pure cross-restaurant
      // aggregate — an hour-of-day is the same everywhere.
      let rowsets = per.map((p) => (p.data ?? []) as Row[]);
      if (type !== "hourly" && ids.length > 1) {
        const nameById: Record<string, string> = {};
        const nq = await sb.from("restaurants").select("id, name").in("id", ids);
        for (const x of (nq.data || []) as { id: string; name: string }[]) nameById[x.id] = x.name;
        rowsets = rowsets.map((rows, i) => rows.map((r) => ({ ...r, [keyCol]: `${String(r[keyCol])} · ${nameById[ids[i]] || "—"}` })));
      }
      const rows: Row[] = mergeBy(rowsets, keyCol, numeric)
        .map((r) => ({ ...r, revenue: num(r.revenue) }));
      rows.sort((a, b) => (type === "hourly" ? Number(a.hour) - Number(b.hour) : Number(b.revenue) - Number(a.revenue)));
      return NextResponse.json({ type, range, rows });
    }

    if (type === "payments") {
      const per = await mapLimit(ridList, 8, (id) =>
        sb.rpc("lfh_owner_payment_breakdown", { p_restaurant_id: id, p_from: from, p_to: to }));
      for (const p of per) if (p.error) throw p.error;
      const rows = mergeBy(per.map((p) => (p.data ?? []) as Row[]), "method", ["revenue", "orders"])
        .map((r) => ({ method: r.method, revenue: num(r.revenue), orders: Number(r.orders) || 0 }))
        .sort((a, b) => b.revenue - a.revenue);
      return NextResponse.json({ type, range, rows });
    }

    return NextResponse.json({ error: "unknown report type" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
