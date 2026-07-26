// Professional owner report (owner round-3, 2026-07-26): "check out how restaurants
// create professional reports… each restaurant individually + all together, crazily
// good, professional — you are only printing the UI right now."
//
// Pure builders, no React: the dashboard gathers the numbers (all from the already-
// cached owner APIs), then
//   · buildReportHtml()   → a complete standalone A4 document (opened in a new tab,
//     auto-print — reads like an official statement, never a console screenshot);
//   · buildReportTables() → the same content as structured tables for CSV / Excel.
// The same builders can back the Reports panel's export later (one system).

export type ReportPayments = { method: string; revenue: number; orders: number };
export type ReportRestaurant = {
  name: string; slug: string;
  revenue: number; orders: number; paidOrders: number; avg: number; share: number;
  discount: number | null; cancelledOrders: number | null; cancelledValue: number | null;
  busiestHour: string | null;
  dishes: { title: string; qty: number; revenue: number }[];
  payments: ReportPayments[];
};
export type ReportData = {
  scopeName: string;       // "All 7 restaurants" | one restaurant's name
  periodLabel: string;     // "27 Jun – 26 Jul (30 days)"
  generatedAt: string;
  group: {
    revenue: number; orders: number; paidOrders: number; avg: number;
    discount: number | null; cancelledOrders: number | null; cancelledValue: number | null;
    payments: ReportPayments[];
  };
  restaurants: ReportRestaurant[];
};
export type ExportTable = { title: string; head: string[]; rows: (string | number)[][] };

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const nfmt = (n: number) => Math.round(n).toLocaleString("en-IN");
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) + "%" : "—");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── the printable document ────────────────────────────────────────────────────
export function buildReportHtml(d: ReportData): string {
  const multi = d.restaurants.length > 1;
  const g = d.group;
  const kv = (label: string, value: string, hint?: string) =>
    `<div class="kv"><div class="kv-l">${label}</div><div class="kv-v">${value}</div>${hint ? `<div class="kv-h">${hint}</div>` : ""}</div>`;

  const summary = `
    <section>
      <h2>Executive summary</h2>
      <div class="kvgrid">
        ${kv("Revenue", inr(g.revenue), "paid orders, net of discounts")}
        ${kv("Orders", nfmt(g.orders), `${nfmt(g.paidOrders)} paid`)}
        ${kv("Average order", inr(g.avg), "per paid order")}
        ${g.discount != null ? kv("Discounts given", inr(g.discount)) : ""}
        ${g.cancelledValue != null ? kv("Lost to cancellations", inr(g.cancelledValue), `${nfmt(g.cancelledOrders || 0)} orders`) : ""}
      </div>
      ${g.payments.length ? `
      <h3>How the money arrived</h3>
      <table><thead><tr><th>Method</th><th class="r">Bills</th><th class="r">Revenue</th><th class="r">Share</th></tr></thead><tbody>
        ${g.payments.map((p) => `<tr><td>${esc(p.method)}</td><td class="r">${nfmt(p.orders)}</td><td class="r">${inr(p.revenue)}</td><td class="r">${pct(p.revenue, g.payments.reduce((a, x) => a + x.revenue, 0))}</td></tr>`).join("")}
      </tbody></table>` : ""}
    </section>`;

  const comparison = multi ? `
    <section>
      <h2>Restaurant comparison</h2>
      <table><thead><tr><th>#</th><th>Restaurant</th><th class="r">Revenue</th><th class="r">Share</th><th class="r">Orders</th><th class="r">Avg order</th><th class="r">Cancelled</th></tr></thead><tbody>
        ${d.restaurants.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.name)}</b></td><td class="r"><b>${inr(r.revenue)}</b></td><td class="r">${Math.round(r.share * 100)}%</td><td class="r">${nfmt(r.orders)}</td><td class="r">${inr(r.avg)}</td><td class="r">${r.cancelledValue != null ? inr(r.cancelledValue) : "—"}</td></tr>`).join("")}
      </tbody></table>
    </section>` : "";

  const sections = d.restaurants.map((r, i) => `
    <section class="rest ${multi ? "brk" : ""}">
      <h2>${multi ? `${i + 1}. ` : ""}${esc(r.name)}</h2>
      <div class="kvgrid">
        ${kv("Revenue", inr(r.revenue), multi ? `${Math.round(r.share * 100)}% of the group` : "")}
        ${kv("Orders", nfmt(r.orders), `${nfmt(r.paidOrders)} paid`)}
        ${kv("Average order", inr(r.avg), "per paid order")}
        ${r.cancelledValue != null ? kv("Lost to cancellations", inr(r.cancelledValue), `${nfmt(r.cancelledOrders || 0)} orders`) : ""}
        ${r.busiestHour ? kv("Busiest hour", r.busiestHour, "most orders") : ""}
      </div>
      ${r.dishes.length ? `
      <h3>Top dishes</h3>
      <table><thead><tr><th>#</th><th>Dish</th><th class="r">Sold</th><th class="r">Revenue</th><th class="r">Share of dish revenue</th></tr></thead><tbody>
        ${r.dishes.slice(0, 12).map((x, j) => `<tr><td>${j + 1}</td><td>${esc(x.title)}</td><td class="r">${nfmt(x.qty)}</td><td class="r">${inr(x.revenue)}</td><td class="r">${pct(x.revenue, r.dishes.reduce((a, y) => a + y.revenue, 0))}</td></tr>`).join("")}
      </tbody></table>` : `<p class="mut">No dish sales in this period.</p>`}
      ${r.payments.length ? `
      <h3>Payment methods</h3>
      <table><thead><tr><th>Method</th><th class="r">Bills</th><th class="r">Revenue</th><th class="r">Share</th></tr></thead><tbody>
        ${r.payments.map((p) => `<tr><td>${esc(p.method)}</td><td class="r">${nfmt(p.orders)}</td><td class="r">${inr(p.revenue)}</td><td class="r">${pct(p.revenue, r.payments.reduce((a, x) => a + x.revenue, 0))}</td></tr>`).join("")}
      </tbody></table>` : ""}
    </section>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>Aevidine report · ${esc(d.scopeName)} · ${esc(d.periodLabel)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Inter, Roboto, sans-serif; color: #10231c; margin: 0; padding: 34px 40px 50px; font-size: 12.5px; line-height: 1.5; }
  .mast { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 3px solid #0f766e; padding-bottom: 10px; }
  .brand { font-weight: 800; font-size: 13px; letter-spacing: .06em; color: #0f766e; text-transform: uppercase; }
  .gen { font-size: 10.5px; color: #6b7f78; }
  h1 { font-size: 24px; margin: 14px 0 2px; letter-spacing: -0.02em; }
  .scope { color: #4b615a; font-size: 13px; margin-bottom: 6px; }
  h2 { font-size: 15px; margin: 26px 0 10px; color: #0f766e; border-bottom: 1px solid #d9e5e1; padding-bottom: 5px; }
  h3 { font-size: 12px; margin: 18px 0 7px; text-transform: uppercase; letter-spacing: .05em; color: #4b615a; }
  .kvgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .kv { border: 1px solid #d9e5e1; border-radius: 9px; padding: 9px 12px; }
  .kv-l { font-size: 9.5px; text-transform: uppercase; letter-spacing: .06em; color: #6b7f78; font-weight: 700; }
  .kv-v { font-size: 17px; font-weight: 800; font-variant-numeric: tabular-nums; margin-top: 1px; }
  .kv-h { font-size: 10px; color: #6b7f78; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; color: #4b615a; border-bottom: 1.5px solid #0f766e; padding: 5px 8px; }
  td { padding: 5.5px 8px; border-bottom: 1px solid #e5eeeb; font-variant-numeric: tabular-nums; }
  tr:nth-child(even) td { background: #f6faf9; }
  .r { text-align: right; }
  .mut { color: #6b7f78; }
  .note { margin-top: 26px; font-size: 10px; color: #6b7f78; border-top: 1px solid #d9e5e1; padding-top: 8px; }
  @media print { .brk { page-break-before: always; } body { padding: 0 6px; } }
  @page { margin: 16mm 12mm; }
</style></head><body>
  <div class="mast"><span class="brand">Aevidine · Restaurant OS</span><span class="gen">Generated ${esc(d.generatedAt)}</span></div>
  <h1>Performance report</h1>
  <div class="scope">${esc(d.scopeName)} · ${esc(d.periodLabel)}</div>
  ${summary}
  ${comparison}
  ${sections}
  <div class="note">Revenue counts paid, non-cancelled orders and is net of discounts (discount applied before tax). Generated automatically by the Aevidine owner console.</div>
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},350)});</script>
</body></html>`;
}

// ── the same content as flat tables (CSV / Excel) ────────────────────────────
export function buildReportTables(d: ReportData): ExportTable[] {
  const g = d.group;
  const out: ExportTable[] = [];
  out.push({
    title: `Aevidine performance report — ${d.scopeName} — ${d.periodLabel}`,
    head: ["Metric", "Value"],
    rows: [
      ["Revenue (paid, net of discounts)", Math.round(g.revenue)],
      ["Orders", g.orders], ["Paid orders", g.paidOrders],
      ["Average order", Math.round(g.avg)],
      ...(g.discount != null ? [["Discounts given", Math.round(g.discount)] as (string | number)[]] : []),
      ...(g.cancelledValue != null ? [["Lost to cancellations", Math.round(g.cancelledValue)] as (string | number)[], ["Cancelled orders", g.cancelledOrders || 0] as (string | number)[]] : []),
      ["Generated", d.generatedAt],
    ],
  });
  if (d.restaurants.length > 1) {
    out.push({
      title: "Restaurant comparison",
      head: ["#", "Restaurant", "Revenue", "Share %", "Orders", "Paid orders", "Avg order", "Cancelled value"],
      rows: d.restaurants.map((r, i) => [i + 1, r.name, Math.round(r.revenue), Math.round(r.share * 100), r.orders, r.paidOrders, Math.round(r.avg), r.cancelledValue != null ? Math.round(r.cancelledValue) : ""]),
    });
  }
  if (g.payments.length) {
    out.push({ title: "Payment methods — all", head: ["Method", "Bills", "Revenue"], rows: g.payments.map((p) => [p.method, p.orders, Math.round(p.revenue)]) });
  }
  for (const r of d.restaurants) {
    out.push({
      title: `${r.name} — top dishes`,
      head: ["#", "Dish", "Sold", "Revenue"],
      rows: r.dishes.slice(0, 15).map((x, j) => [j + 1, x.title, x.qty, Math.round(x.revenue)]),
    });
    if (r.payments.length) {
      out.push({ title: `${r.name} — payment methods`, head: ["Method", "Bills", "Revenue"], rows: r.payments.map((p) => [p.method, p.orders, Math.round(p.revenue)]) });
    }
  }
  return out;
}
