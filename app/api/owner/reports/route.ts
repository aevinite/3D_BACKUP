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
import { effectiveTaxPct } from "@/lib/tax";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
function windowFor(range: string): { from: string; to: string; bucket: string } {
  const now = Date.now();
  const to = new Date(now).toISOString();
  if (range === "12m") return { from: new Date(now - 365 * DAY).toISOString(), to, bucket: "month" };
  if (range === "30d") return { from: new Date(now - 30 * DAY).toISOString(), to, bucket: "day" };
  if (range === "7d") return { from: new Date(now - 7 * DAY).toISOString(), to, bucket: "day" };
  const biz = new Date(now + 5.5 * 3600_000 - 5 * 3600_000);
  const todayStart = Date.UTC(biz.getUTCFullYear(), biz.getUTCMonth(), biz.getUTCDate(), 5, 0, 0) - 5.5 * 3600_000;
  if (range === "yesterday") return { from: new Date(todayStart - DAY).toISOString(), to: new Date(todayStart).toISOString(), bucket: "hour" };
  return { from: new Date(todayStart).toISOString(), to, bucket: "hour" };
}

const num = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
type Row = Record<string, unknown>;

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
  const range = sp.get("range") || "30d";
  const rid = sp.get("rid") || null;
  if (rid && !scope.all && !scope.ids.includes(rid)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
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
        const per = await Promise.all(scope.ids.map((id) =>
          sb.rpc("lfh_owner_sales_report", { p_restaurant_id: id, p_from: from, p_to: to, p_bucket: bucket })));
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
        tax = {
          effectivePct: pct,
          components: effective.map((c) => ({ ...c, amount: num(totals.tax * (c.rate / rateSum)) })),
          configured: comps.length > 0,
        };
      }
      return NextResponse.json({ type, range, bucket, rows, totals, tax });
    }

    // ── breakdown reports: dishes / categories / payments / hourly ──
    if (type === "dishes" || type === "categories" || type === "hourly") {
      const fn = type === "dishes" ? "lfh_owner_dish_breakdown"
        : type === "categories" ? "lfh_owner_category_breakdown" : "lfh_owner_hourly";
      // These RPCs are per-restaurant; "all" = run per restaurant and merge. For the
      // admin all-view, list the active restaurants first.
      let ids: string[];
      if (rid) ids = [rid];
      else if (!scope.all) ids = scope.ids;
      else {
        const r = await sb.from("restaurants").select("id").limit(100);
        if (r.error) throw r.error;
        ids = (r.data ?? []).map((x) => x.id);
      }
      const per = await Promise.all(ids.map((id) => sb.rpc(fn, { p_restaurant_id: id, p_from: from, p_to: to })));
      for (const p of per) if (p.error) throw p.error;
      const keyCol = type === "dishes" ? "title" : type === "categories" ? "category" : "hour";
      const numeric = type === "hourly" ? ["orders", "revenue"] : ["qty", "revenue"];
      const rows: Row[] = mergeBy(per.map((p) => (p.data ?? []) as Row[]), keyCol, numeric)
        .map((r) => ({ ...r, revenue: num(r.revenue) }));
      rows.sort((a, b) => (type === "hourly" ? Number(a.hour) - Number(b.hour) : Number(b.revenue) - Number(a.revenue)));
      return NextResponse.json({ type, range, rows });
    }

    if (type === "payments") {
      const per = await Promise.all(ridList.map((id) =>
        sb.rpc("lfh_owner_payment_breakdown", { p_restaurant_id: id, p_from: from, p_to: to })));
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
