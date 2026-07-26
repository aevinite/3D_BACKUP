// Professional owner report (owner rounds 3–4, 2026-07-26): a REAL restaurant
// business statement — "report is everything compiled: if there is no taxation,
// how can it be a report?" Modelled on the PetPooja-style day summary the owner
// referenced: billing details with the CGST/SGST split, settlement, per-restaurant
// sections, and the group compiled together.
//
// Pure builders, no React:
//   · buildReportHtml()   → a standalone A4 document (new tab, auto-print);
//   · buildReportTables() → the SAME sections as structured tables for CSV / Excel.
// Reused by the Reports panel's export when that section is revamped later.

export type ReportPayments = { method: string; revenue: number; orders: number };
export type TaxComponent = { label: string; amount: number };
export type BillingDetails = {
  gross: number | null;            // subtotal (pre-tax gross sales)
  discount: number | null;         // discounts given
  taxComponents: TaxComponent[];   // CGST / SGST / … amounts (configured tax lines)
  taxTotal: number | null;         // total GST collected
  net: number;                     // revenue kept (paid, net of discounts)
  cancelledOrders: number | null;
  cancelledValue: number | null;
};
export type DailyRow = { label: string; iso: string; orders: number; gross: number; discount: number; tax: number; net: number };
export type ReportRestaurant = {
  name: string; slug: string;
  revenue: number; orders: number; paidOrders: number; avg: number; share: number;
  prevRevenue: number | null;       // previous equal period (for the ▲/▼ line)
  billing: BillingDetails;
  busiestHour: string | null;
  dishes: { title: string; qty: number; revenue: number }[];
  categories: { category: string; qty: number; revenue: number }[];
  payments: ReportPayments[];
  daily: DailyRow[];                // day-by-day (or hour/month) breakdown appendix
  dailyGrain: string;               // hour | day | month — weekday table needs day grain
  hourly: { hour: number; orders: number; revenue: number }[];
};
export type ReportData = {
  scopeName: string;
  periodLabel: string;
  generatedAt: string;
  group: {
    revenue: number; orders: number; paidOrders: number; avg: number;
    prevRevenue: number | null;
    billing: BillingDetails;
    payments: ReportPayments[];
    // Pay Later (khata) liability — a point-in-time "as of today" figure, shown only
    // when the module is on and there is anything outstanding (NOT period-scoped).
    khata: { outstanding: number; people: number; collectedMonth: number } | null;
  };
  restaurants: ReportRestaurant[];
};
export type ExportTable = { title: string; head: string[]; rows: (string | number)[][] };

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const nfmt = (n: number) => Math.round(n).toLocaleString("en-IN");
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) + "%" : "—");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The PetPooja-style "Billing Details" block: gross → discounts → each tax line →
// total GST → net amount, plus what was lost to cancellations.
function billingRows(b: BillingDetails): [string, string][] {
  const rows: [string, string][] = [];
  if (b.gross != null) rows.push(["Gross sales (before tax)", inr(b.gross)]);
  if (b.discount != null) rows.push(["Discounts given", "− " + inr(b.discount)]);
  for (const c of b.taxComponents) rows.push([`${c.label} collected`, inr(c.amount)]);
  if (b.taxTotal != null) rows.push(["Total GST collected", inr(b.taxTotal)]);
  rows.push(["Net amount (kept)", inr(b.net)]);
  if (b.gross != null && b.gross > 0 && b.discount != null) rows.push(["Discount rate", pct(b.discount, b.gross)]);
  if (b.cancelledValue != null) rows.push(["Cancelled orders", `${nfmt(b.cancelledOrders || 0)} · ${inr(b.cancelledValue)} lost`]);
  return rows;
}
// "vs the previous equal period" — the one line every owner asks first.
function prevLine(cur: number, prev: number | null): string {
  if (prev == null || prev <= 0) return "";
  const p = Math.round(((cur - prev) / prev) * 100);
  const arrow = p > 0 ? "▲" : p < 0 ? "▼" : "•";
  return `${arrow} ${p > 0 ? "+" : ""}${p}% vs previous period`;
}
function billingTableHtml(b: BillingDetails): string {
  return `<table class="kvt"><tbody>${billingRows(b).map(([l, v]) =>
    `<tr><td>${esc(l)}</td><td class="r"><b>${esc(v)}</b></td></tr>`).join("")}</tbody></table>`;
}
function settlementHtml(pays: ReportPayments[]): string {
  if (!pays.length) return "";
  const total = pays.reduce((a, x) => a + x.revenue, 0);
  return `<table><thead><tr><th>Method</th><th class="r">Bills</th><th class="r">Amount</th><th class="r">Share</th></tr></thead><tbody>
    ${pays.map((p) => `<tr><td>${esc(p.method)}</td><td class="r">${nfmt(p.orders)}</td><td class="r">${inr(p.revenue)}</td><td class="r">${pct(p.revenue, total)}</td></tr>`).join("")}
    <tr class="tot"><td><b>Total settled</b></td><td class="r"><b>${nfmt(pays.reduce((a, x) => a + x.orders, 0))}</b></td><td class="r"><b>${inr(total)}</b></td><td class="r"><b>100%</b></td></tr>
  </tbody></table>`;
}

function dailyHtml(rows: DailyRow[]): string {
  if (rows.length < 2) return "";
  // very long custom windows: keep the sheet printable — cap with an honest note
  const cap = 92;
  const shown = rows.length > cap ? rows.slice(-cap) : rows;
  return `<h3>Day-by-day breakdown</h3>
  ${rows.length > cap ? `<p class="mut">Showing the most recent ${cap} of ${rows.length} rows — download the CSV for the complete series.</p>` : ""}
  <table><thead><tr><th>Period</th><th class="r">Orders</th><th class="r">Gross</th><th class="r">Discount</th><th class="r">GST</th><th class="r">Net</th></tr></thead><tbody>
    ${shown.map((r) => `<tr><td>${esc(r.label)}</td><td class="r">${nfmt(r.orders)}</td><td class="r">${inr(r.gross)}</td><td class="r">${inr(r.discount)}</td><td class="r">${inr(r.tax)}</td><td class="r"><b>${inr(r.net)}</b></td></tr>`).join("")}
  </tbody></table>`;
}
const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Day-of-week performance — which weekdays actually carry the business (Toast/PetPooja
// staple). Needs day-grain rows spanning at least a week.
function weekdayRows(daily: DailyRow[], grain: string): { name: string; days: number; net: number; orders: number }[] {
  if (grain !== "day" || daily.length < 7) return [];
  const agg = DOW_NAMES.map((name) => ({ name, days: 0, net: 0, orders: 0 }));
  for (const r of daily) {
    const d = new Date(r.iso);
    if (Number.isNaN(d.getTime())) continue;
    // IST weekday of the bucket
    const dow = new Date(d.getTime() + 5.5 * 3600_000).getUTCDay();
    agg[dow].days += 1; agg[dow].net += r.net; agg[dow].orders += r.orders;
  }
  return agg.filter((a) => a.days > 0);
}
function weekdayHtml(daily: DailyRow[], grain: string): string {
  const rows = weekdayRows(daily, grain);
  if (rows.length < 4) return "";
  const best = rows.reduce((a, b) => (b.net / b.days > a.net / a.days ? b : a), rows[0]);
  return `<h3>Day-of-week performance</h3>
  <table><thead><tr><th>Weekday</th><th class="r">Days</th><th class="r">Avg net / day</th><th class="r">Total net</th><th class="r">Orders</th></tr></thead><tbody>
    ${rows.map((r) => `<tr${r.name === best.name ? ' style="font-weight:700"' : ""}><td>${r.name}${r.name === best.name ? " ★" : ""}</td><td class="r">${r.days}</td><td class="r">${inr(r.net / r.days)}</td><td class="r">${inr(r.net)}</td><td class="r">${nfmt(r.orders)}</td></tr>`).join("")}
  </tbody></table>`;
}
// Dayparts — breakfast/lunch/evening/dinner/late-night split from the hourly pattern.
const DAYPARTS: { name: string; from: number; to: number }[] = [
  { name: "Breakfast (6–11)", from: 6, to: 11 }, { name: "Lunch (11–15)", from: 11, to: 15 },
  { name: "Evening (15–19)", from: 15, to: 19 }, { name: "Dinner (19–23)", from: 19, to: 23 },
  { name: "Late night (23–6)", from: 23, to: 30 },
];
function daypartRows(hourly: { hour: number; orders: number; revenue: number }[]): { name: string; orders: number; revenue: number }[] {
  if (!hourly.some((h) => h.orders > 0)) return [];
  return DAYPARTS.map((p) => {
    let orders = 0, revenue = 0;
    for (const h of hourly) {
      const hh = h.hour < 6 ? h.hour + 24 : h.hour; // fold 0–5 into the late-night band
      if (hh >= p.from && hh < p.to) { orders += h.orders; revenue += h.revenue; }
    }
    return { name: p.name, orders, revenue };
  }).filter((p) => p.orders > 0);
}
function daypartsHtml(hourly: { hour: number; orders: number; revenue: number }[]): string {
  const rows = daypartRows(hourly);
  if (rows.length < 2) return "";
  const total = rows.reduce((a, r) => a + r.revenue, 0);
  return `<h3>Dayparts — when the money comes in</h3>
  <table><thead><tr><th>Daypart</th><th class="r">Orders</th><th class="r">Revenue</th><th class="r">Share</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${r.name}</td><td class="r">${nfmt(r.orders)}</td><td class="r">${inr(r.revenue)}</td><td class="r">${pct(r.revenue, total)}</td></tr>`).join("")}
  </tbody></table>`;
}
// Menu-engineering tag (Lightspeed-style 2×2): popularity (qty) × unit price medians.
function dishTag(d: { qty: number; revenue: number }, qtyMed: number, priceMed: number): string {
  const price = d.qty > 0 ? d.revenue / d.qty : 0;
  if (d.qty >= qtyMed && price >= priceMed) return "⭐ Star";
  if (d.qty >= qtyMed) return "Crowd favourite";
  if (price >= priceMed) return "Hidden gem";
  return "Rethink";
}
function medians(dishes: { qty: number; revenue: number }[]): { qtyMed: number; priceMed: number } {
  const med = (a: number[]) => { const x = [...a].sort((p, q) => p - q); const m = x.length >> 1; return x.length ? (x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2) : 0; };
  return { qtyMed: med(dishes.map((d) => d.qty)), priceMed: med(dishes.map((d) => (d.qty ? d.revenue / d.qty : 0))) };
}
function categoriesHtml(cats: { category: string; qty: number; revenue: number }[]): string {
  if (!cats.length) return "";
  const total = cats.reduce((a, c) => a + c.revenue, 0);
  return `<h3>Category mix</h3>
  <table><thead><tr><th>Category</th><th class="r">Items sold</th><th class="r">Revenue</th><th class="r">Share</th></tr></thead><tbody>
    ${cats.slice(0, 10).map((c) => `<tr><td>${esc(c.category)}</td><td class="r">${nfmt(c.qty)}</td><td class="r">${inr(c.revenue)}</td><td class="r">${pct(c.revenue, total)}</td></tr>`).join("")}
  </tbody></table>`;
}
export function buildReportHtml(d: ReportData): string {
  const multi = d.restaurants.length > 1;
  const g = d.group;
  const kv = (label: string, value: string, hint?: string) =>
    `<div class="kv"><div class="kv-l">${label}</div><div class="kv-v">${value}</div>${hint ? `<div class="kv-h">${hint}</div>` : ""}</div>`;

  const summary = `
    <section>
      <h2>Executive summary</h2>
      <div class="kvgrid">
        ${kv("Net revenue", inr(g.revenue), prevLine(g.revenue, g.prevRevenue) || "paid, net of discounts")}
        ${kv("Orders", nfmt(g.orders), `${nfmt(g.paidOrders)} paid`)}
        ${kv("Average bill", inr(g.avg), "per paid order")}
        ${g.billing.taxTotal != null ? kv("Total GST", inr(g.billing.taxTotal), g.billing.taxComponents.map((c) => c.label).join(" + ") || "collected") : ""}
        ${g.billing.discount != null ? kv("Discounts", inr(g.billing.discount)) : ""}
        ${g.billing.cancelledValue != null ? kv("Lost to cancellations", inr(g.billing.cancelledValue), `${nfmt(g.billing.cancelledOrders || 0)} orders`) : ""}
      </div>
      <div class="two">
        <div><h3>Billing &amp; tax details</h3>${billingTableHtml(g.billing)}</div>
        <div><h3>Settlement — how the money arrived</h3>${settlementHtml(g.payments)}</div>
      </div>
      ${g.khata && g.khata.outstanding > 0 ? `
      <h3>Pay Later (khata) — as of today</h3>
      <table class="kvt"><tbody>
        <tr><td>Outstanding with customers</td><td class="r"><b>${inr(g.khata.outstanding)}</b></td></tr>
        <tr><td>People who owe</td><td class="r"><b>${nfmt(g.khata.people)}</b></td></tr>
        <tr><td>Collected this month</td><td class="r"><b>${inr(g.khata.collectedMonth)}</b></td></tr>
      </tbody></table>
      <p class="mut" style="font-size:9.5px">A point-in-time balance — not limited to the report period.</p>` : ""}
    </section>`;

  const comparison = multi ? `
    <section>
      <h2>Restaurant comparison</h2>
      <table><thead><tr><th>#</th><th>Restaurant</th><th class="r">Net revenue</th><th class="r">Share</th><th class="r">Orders</th><th class="r">Avg bill</th><th class="r">GST</th><th class="r">Cancelled</th></tr></thead><tbody>
        ${d.restaurants.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.name)}</b></td><td class="r"><b>${inr(r.revenue)}</b></td><td class="r">${Math.round(r.share * 100)}%</td><td class="r">${nfmt(r.orders)}</td><td class="r">${inr(r.avg)}</td><td class="r">${r.billing.taxTotal != null ? inr(r.billing.taxTotal) : "—"}</td><td class="r">${r.billing.cancelledValue != null ? inr(r.billing.cancelledValue) : "—"}</td></tr>`).join("")}
      </tbody></table>
    </section>` : "";

  const sections = d.restaurants.map((r, i) => `
    <section class="rest ${multi ? "brk" : ""}">
      <h2>${multi ? `${i + 1}. ` : ""}${esc(r.name)}</h2>
      <div class="kvgrid">
        ${kv("Net revenue", inr(r.revenue), prevLine(r.revenue, r.prevRevenue) || (multi ? `${Math.round(r.share * 100)}% of the group` : "paid, net of discounts"))}
        ${kv("Orders", nfmt(r.orders), `${nfmt(r.paidOrders)} paid`)}
        ${kv("Average bill", inr(r.avg), "per paid order")}
        ${r.busiestHour ? kv("Busiest hour", r.busiestHour, "most orders") : ""}
      </div>
      <div class="two">
        <div><h3>Billing &amp; tax details</h3>${billingTableHtml(r.billing)}</div>
        <div><h3>Settlement</h3>${settlementHtml(r.payments)}</div>
      </div>
      ${categoriesHtml(r.categories)}
      ${daypartsHtml(r.hourly)}
      ${weekdayHtml(r.daily, r.dailyGrain)}
      ${r.dishes.length ? (() => { const { qtyMed, priceMed } = medians(r.dishes); return `
      <h3>Top dishes</h3>
      <table><thead><tr><th>#</th><th>Dish</th><th class="r">Sold</th><th class="r">Revenue</th><th class="r">Share</th><th>Verdict</th></tr></thead><tbody>
        ${r.dishes.slice(0, 12).map((x, j) => `<tr><td>${j + 1}</td><td>${esc(x.title)}</td><td class="r">${nfmt(x.qty)}</td><td class="r">${inr(x.revenue)}</td><td class="r">${pct(x.revenue, r.dishes.reduce((a, y) => a + y.revenue, 0))}</td><td>${dishTag(x, qtyMed, priceMed)}</td></tr>`).join("")}
      </tbody></table>
      <p class="mut" style="font-size:9.5px">Verdict: ⭐ Star = sells a lot at a good price · Crowd favourite = sells a lot, cheap · Hidden gem = pricey but under-ordered (promote it) · Rethink = neither (re-price, rework or drop).</p>`; })() : `<p class="mut">No dish sales in this period.</p>`}
      ${dailyHtml(r.daily)}
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
  h3 { font-size: 11.5px; margin: 16px 0 7px; text-transform: uppercase; letter-spacing: .05em; color: #4b615a; }
  .kvgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 10px; }
  .kv { border: 1px solid #d9e5e1; border-radius: 9px; padding: 9px 12px; }
  .kv-l { font-size: 9.5px; text-transform: uppercase; letter-spacing: .06em; color: #6b7f78; font-weight: 700; }
  .kv-v { font-size: 17px; font-weight: 800; font-variant-numeric: tabular-nums; margin-top: 1px; }
  .kv-h { font-size: 10px; color: #6b7f78; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; color: #4b615a; border-bottom: 1.5px solid #0f766e; padding: 5px 8px; }
  td { padding: 5.5px 8px; border-bottom: 1px solid #e5eeeb; font-variant-numeric: tabular-nums; }
  tr:nth-child(even) td { background: #f6faf9; }
  tr.tot td { border-top: 1.5px solid #0f766e; background: #eef7f4; }
  .kvt td:first-child { color: #4b615a; }
  .r { text-align: right; }
  .mut { color: #6b7f78; }
  .note { margin-top: 26px; font-size: 10px; color: #6b7f78; border-top: 1px solid #d9e5e1; padding-top: 8px; }
  @media print { .brk { page-break-before: always; } body { padding: 0 6px; } .two { grid-template-columns: 1fr 1fr; } }
  @page { margin: 16mm 12mm; }
</style></head><body>
  <div class="mast"><span class="brand">Aevidine · Restaurant OS</span><span class="gen">Generated ${esc(d.generatedAt)}</span></div>
  <h1>Business performance report</h1>
  <div class="scope">${esc(d.scopeName)} · ${esc(d.periodLabel)}</div>
  ${summary}
  ${comparison}
  ${sections}
  <div class="note">Net revenue counts paid, non-cancelled orders and is net of discounts (discount applied before tax). GST figures come from the restaurant's configured tax lines; a restaurant with no tax configuration shows total tax only. Generated automatically by the Aevidine owner console.</div>
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},350)});</script>
</body></html>`;
}

// ── the same compiled sections as flat tables (CSV / Excel) ───────────────────
export function buildReportTables(d: ReportData): ExportTable[] {
  const g = d.group;
  const out: ExportTable[] = [];
  out.push({
    title: `Aevidine business performance report — ${d.scopeName} — ${d.periodLabel} — generated ${d.generatedAt}`,
    head: ["Metric", "Value"],
    rows: [
      ["Net revenue (paid, net of discounts)", Math.round(g.revenue)],
      ["Orders", g.orders], ["Paid orders", g.paidOrders],
      ["Average bill", Math.round(g.avg)],
      ...billingRows(g.billing).map(([l, v]) => [l, v] as (string | number)[]),
    ],
  });
  if (g.payments.length) {
    out.push({ title: "Settlement — all", head: ["Method", "Bills", "Amount"], rows: g.payments.map((p) => [p.method, p.orders, Math.round(p.revenue)]) });
  }
  if (g.khata && g.khata.outstanding > 0) {
    out.push({ title: "Pay Later (khata) — as of today", head: ["Item", "Value"], rows: [["Outstanding with customers", Math.round(g.khata.outstanding)], ["People who owe", g.khata.people], ["Collected this month", Math.round(g.khata.collectedMonth)]] });
  }
  if (d.restaurants.length > 1) {
    out.push({
      title: "Restaurant comparison",
      head: ["#", "Restaurant", "Net revenue", "Share %", "Orders", "Paid orders", "Avg bill", "Total GST", "Cancelled value"],
      rows: d.restaurants.map((r, i) => [i + 1, r.name, Math.round(r.revenue), Math.round(r.share * 100), r.orders, r.paidOrders, Math.round(r.avg), r.billing.taxTotal != null ? Math.round(r.billing.taxTotal) : "", r.billing.cancelledValue != null ? Math.round(r.billing.cancelledValue) : ""]),
    });
  }
  for (const r of d.restaurants) {
    out.push({
      title: `${r.name} — billing & tax details`,
      head: ["Item", "Value"],
      rows: billingRows(r.billing).map(([l, v]) => [l, v] as (string | number)[]),
    });
    if (r.payments.length) {
      out.push({ title: `${r.name} — settlement`, head: ["Method", "Bills", "Amount"], rows: r.payments.map((p) => [p.method, p.orders, Math.round(p.revenue)]) });
    }
    { const { qtyMed, priceMed } = medians(r.dishes);
    out.push({
      title: `${r.name} — top dishes`,
      head: ["#", "Dish", "Sold", "Revenue", "Verdict"],
      rows: r.dishes.slice(0, 15).map((x, j) => [j + 1, x.title, x.qty, Math.round(x.revenue), dishTag(x, qtyMed, priceMed)]),
    }); }
    { const dp = daypartRows(r.hourly);
      if (dp.length > 1) out.push({ title: `${r.name} — dayparts`, head: ["Daypart", "Orders", "Revenue"], rows: dp.map((x) => [x.name, x.orders, Math.round(x.revenue)]) }); }
    { const wd = weekdayRows(r.daily, r.dailyGrain);
      if (wd.length >= 4) out.push({ title: `${r.name} — day-of-week performance`, head: ["Weekday", "Days", "Avg net/day", "Total net", "Orders"], rows: wd.map((x) => [x.name, x.days, Math.round(x.net / x.days), Math.round(x.net), x.orders]) }); }
    if (r.categories.length) {
      out.push({ title: `${r.name} — category mix`, head: ["Category", "Items sold", "Revenue"], rows: r.categories.map((c) => [c.category, c.qty, Math.round(c.revenue)]) });
    }
    if (r.daily.length > 1) {
      // CSV carries the COMPLETE series (the print sheet caps very long windows)
      out.push({ title: `${r.name} — day-by-day breakdown`, head: ["Period", "Orders", "Gross", "Discount", "GST", "Net"], rows: r.daily.map((x) => [x.label, x.orders, Math.round(x.gross), Math.round(x.discount), Math.round(x.tax), Math.round(x.net)]) });
    }
  }
  return out;
}
