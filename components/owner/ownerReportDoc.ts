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
  // Restaurants whose figures could NOT be read for this period. The gatherer used to throw
  // on the first failure and blank the whole statement; it now drops the restaurant and names
  // it here so the document admits the gap instead of quietly under-reporting (2026-08-04).
  omitted?: string[];
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
// `cols` (OPTIONAL) states what each column IS, so a printed cell never has to be guessed
// from the wording of its header. Builders that don't set it keep the old header heuristic,
// so nothing existing changes. It exists because guessing was wrong twice on the Team & pay
// sheet: none of "Salary" / "Advance" / "Total paid" / "Still owed" matched the money words,
// so every amount printed with no ₹ — and "Rate" (a monthly salary in rupees) matched the
// PERCENT rule, so ₹42,000 printed as "42000%" (found 2026-08-04).
export type ExportCol = "text" | "money" | "num" | "pct";
export type ExportTable = { title: string; head: string[]; rows: (string | number)[][]; cols?: ExportCol[] };

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const nfmt = (n: number) => Math.round(n).toLocaleString("en-IN");
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) + "%" : "—");
// Tolerates null/undefined too — a `label` coming out of settings JSON is not guaranteed
// to be a string, and esc() throwing would take the whole printed report with it.
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The money-flow calculation (owner, 2026-07-27): show the WHOLE journey from gross
// sales to money in hand as one visible calculation — every cut named, every subtotal
// computed in front of the reader. "=" rows are emphasised by billingTableHtml.
export function moneyInHand(b: BillingDetails): number | null {
  return b.gross != null && b.discount != null ? b.gross - b.discount : null;
}
function billingRows(b: BillingDetails): [string, string][] {
  const rows: [string, string][] = [];
  if (b.gross != null && b.discount != null && b.taxTotal != null) {
    rows.push(["Gross sales — everything billed, before tax", inr(b.gross)]);
    rows.push(["Less : discounts given to guests", "− " + inr(b.discount)]);
    rows.push(["= Taxable amount (gross − discounts)", inr(b.gross - b.discount)]);
    // NOT escaped here on purpose. `c.label` is owner-editable (settings.tax_components), so it
    // does need escaping — but billingTableHtml() below already runs esc() over every label it
    // renders, and these same rows also feed the CSV/Excel builders, where HTML entities would be
    // literal text in the cell. Escaping here as well produced a visible "CGST &lt;2.5%&gt;" on
    // the printed sheet (caught by node_modules/.cache test during the 2026-08-04 sweep fixes —
    // the finding was real for the .xls builders, and wrong for this one). Escape AT the sink.
    for (const c of b.taxComponents) rows.push([`Add : ${c.label} collected`, "+ " + inr(c.amount)]);
    rows.push([b.taxComponents.length ? "Add : total GST collected" : "Add : GST collected", "+ " + inr(b.taxTotal)]);
    // computed (not b.net): group-level `net` is summed from a different, created_at-attributed
    // source, so khata orders paid across the period edge could make the printed equation
    // visibly not add up. The calculation must stay self-consistent on paper.
    rows.push(["= Total collected from guests", inr(b.gross - b.discount + b.taxTotal)]);
    rows.push(["Less : GST set aside for the government", "− " + inr(b.taxTotal)]);
    rows.push(["= MONEY IN HAND — what you keep", inr(b.gross - b.discount)]);
    if (b.gross > 0) rows.push(["Discount rate", pct(b.discount, b.gross)]);
  } else {
    // no sales-report data for this scope — show what we do know, no fake maths
    rows.push(["Net amount (kept)", inr(b.net)]);
  }
  if (b.cancelledValue != null) rows.push(["Cancelled orders — never entered the numbers above", `${nfmt(b.cancelledOrders || 0)} · ${inr(b.cancelledValue)} lost`]);
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
  return `<table class="kvt"><tbody>${billingRows(b).map(([l, v]) => {
    const em = l.startsWith("=");                      // computed subtotal rows
    const grand = l.startsWith("= MONEY IN HAND");     // the number the owner reads first
    return `<tr${grand ? ' class="grand"' : em ? ' class="em"' : ""}><td>${esc(l)}</td><td class="r"><b>${esc(v)}</b></td></tr>`;
  }).join("")}</tbody></table>`;
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
  <table><thead><tr><th>Period</th><th class="r">Orders</th><th class="r">Gross</th><th class="r">Discount</th><th class="r">GST</th><th class="r">Collected</th></tr></thead><tbody>
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
    ${rows.map((r) => `<tr${r.name === best.name ? ' style="font-weight:700"' : ""}><td>${esc(r.name)}${r.name === best.name ? " ★" : ""}</td><td class="r">${r.days}</td><td class="r">${inr(r.net / r.days)}</td><td class="r">${inr(r.net)}</td><td class="r">${nfmt(r.orders)}</td></tr>`).join("")}
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
    ${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="r">${nfmt(r.orders)}</td><td class="r">${inr(r.revenue)}</td><td class="r">${pct(r.revenue, total)}</td></tr>`).join("")}
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
// Slow movers — the menu-engineering "Dogs" quadrant. Research (Lightspeed/meez/R365):
// the worst sellers matter MORE than the top ones because they demand a decision —
// re-price, rework, or drop. Only meaningful when the menu is big enough that the
// bottom isn't just the same handful as the top.
function slowDishes(dishes: { title: string; qty: number; revenue: number }[], n = 5): { title: string; qty: number; revenue: number }[] {
  const sold = dishes.filter((x) => x.qty > 0);
  if (sold.length < 8) return [];
  return [...sold].sort((a, b) => a.qty - b.qty || a.revenue - b.revenue).slice(0, n);
}
// Group view: each restaurant's slowest dishes tagged with WHO serves them, weakest first.
function groupSlowDishes(rests: ReportRestaurant[], cap = 10): { restaurant: string; title: string; qty: number; revenue: number }[] {
  const rows = rests.flatMap((r) => slowDishes(r.dishes, 4).map((x) => ({ restaurant: r.name, ...x })));
  return rows.sort((a, b) => a.qty - b.qty || a.revenue - b.revenue).slice(0, cap);
}
// All restaurants' day rows merged into one row per calendar day (day-grain only).
function mergedDaily(rests: ReportRestaurant[]): DailyRow[] {
  const byIso = new Map<string, DailyRow>();
  for (const r of rests) {
    if (r.dailyGrain !== "day") return [];
    for (const d of r.daily) {
      const c = byIso.get(d.iso);
      if (c) { c.orders += d.orders; c.gross += d.gross; c.discount += d.discount; c.tax += d.tax; c.net += d.net; }
      else byIso.set(d.iso, { ...d });
    }
  }
  return Array.from(byIso.values()).sort((a, b) => a.iso.localeCompare(b.iso));
}
// Best & weakest day across the whole scope (day-grain windows of a week or more).
function dayExtremes(rests: ReportRestaurant[]): { best: DailyRow; worst: DailyRow } | null {
  const days = mergedDaily(rests).filter((d) => d.orders > 0);
  if (days.length < 7) return null;
  let best = days[0], worst = days[0];
  for (const d of days) { if (d.net > best.net) best = d; if (d.net < worst.net) worst = d; }
  return { best, worst };
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
  // ESCAPE AT THE SINK. The `hint` of the "Total GST" tile is the joined tax-component
  // LABELS, which the owner types themselves (settings.tax_components) — so a line named
  // `CGST <2.5%>` went into the printed document raw and broke the tile (found 2026-08-04).
  // Every one of the three slots is escaped here rather than at the call sites, so a future
  // tile can't reintroduce it. Callers pass already-formatted money/text, never HTML.
  const kv = (label: string, value: string, hint?: string) =>
    `<div class="kv"><div class="kv-l">${esc(label)}</div><div class="kv-v">${esc(value)}</div>${hint ? `<div class="kv-h">${esc(hint)}</div>` : ""}</div>`;

  const inHand = moneyInHand(g.billing);
  const extremes = dayExtremes(d.restaurants);
  const summary = `
    <section>
      <h2>Executive summary</h2>
      <div class="kvgrid">
        ${kv("Total collected", inr(g.revenue), prevLine(g.revenue, g.prevRevenue) || "everything guests paid — GST included")}
        ${inHand != null ? kv("Money in hand", inr(inHand), "after GST set aside") : ""}
        ${kv("Orders", nfmt(g.orders), `${nfmt(g.paidOrders)} paid`)}
        ${kv("Average bill", inr(g.avg), "per paid order")}
        ${g.billing.taxTotal != null ? kv("Total GST", inr(g.billing.taxTotal), g.billing.taxComponents.map((c) => c.label).join(" + ") || "collected") : ""}
        ${g.billing.discount != null ? kv("Discounts", inr(g.billing.discount)) : ""}
        ${g.billing.cancelledValue != null ? kv("Lost to cancellations", inr(g.billing.cancelledValue), `${nfmt(g.billing.cancelledOrders || 0)} orders`) : ""}
        ${extremes ? kv("Best day", inr(extremes.best.net), extremes.best.label) : ""}
        ${extremes ? kv("Weakest day", inr(extremes.worst.net), extremes.worst.label) : ""}
      </div>
      <div class="two">
        <div><h3>Money flow — from sale to in-hand</h3>${billingTableHtml(g.billing)}</div>
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
      <table><thead><tr><th>#</th><th>Restaurant</th><th class="r">Total collected</th><th class="r">Share</th><th class="r">Orders</th><th class="r">Avg bill</th><th class="r">GST</th><th class="r">Cancelled</th></tr></thead><tbody>
        ${d.restaurants.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.name)}</b></td><td class="r"><b>${inr(r.revenue)}</b></td><td class="r">${Math.round(r.share * 100)}%</td><td class="r">${nfmt(r.orders)}</td><td class="r">${inr(r.avg)}</td><td class="r">${r.billing.taxTotal != null ? inr(r.billing.taxTotal) : "—"}</td><td class="r">${r.billing.cancelledValue != null ? inr(r.billing.cancelledValue) : "—"}</td></tr>`).join("")}
      </tbody></table>
    </section>` : "";

  // Slow movers across the group — worst sellers matter more than top sellers
  // because each one is a decision waiting: re-price, rework, or drop.
  const gSlow = multi ? groupSlowDishes(d.restaurants) : [];
  const slowSection = gSlow.length ? `
    <section>
      <h2>Slow movers — dishes that need a decision</h2>
      <table><thead><tr><th>#</th><th>Dish</th><th>Restaurant</th><th class="r">Sold</th><th class="r">Revenue</th></tr></thead><tbody>
        ${gSlow.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.title)}</td><td>${esc(x.restaurant)}</td><td class="r">${nfmt(x.qty)}</td><td class="r">${inr(x.revenue)}</td></tr>`).join("")}
      </tbody></table>
      <p class="mut" style="font-size:9.5px">The least-ordered dishes of the period, weakest first. Each one costs prep time, inventory and menu space — re-price it, rework it, promote it, or drop it.</p>
    </section>` : "";

  const sections = d.restaurants.map((r, i) => `
    <section class="rest ${multi ? "brk" : ""}">
      <h2>${multi ? `${i + 1}. ` : ""}${esc(r.name)}</h2>
      <div class="kvgrid">
        ${kv("Total collected", inr(r.revenue), prevLine(r.revenue, r.prevRevenue) || (multi ? `${Math.round(r.share * 100)}% of the group` : "everything guests paid — GST included"))}
        ${moneyInHand(r.billing) != null ? kv("Money in hand", inr(moneyInHand(r.billing)!), "after GST set aside") : ""}
        ${kv("Orders", nfmt(r.orders), `${nfmt(r.paidOrders)} paid`)}
        ${kv("Average bill", inr(r.avg), "per paid order")}
        ${r.busiestHour ? kv("Busiest hour", r.busiestHour, "most orders") : ""}
      </div>
      <div class="two">
        <div><h3>Money flow — from sale to in-hand</h3>${billingTableHtml(r.billing)}</div>
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
      ${(() => { const slow = slowDishes(r.dishes); return slow.length ? `
      <h3>Slow movers — needs a decision</h3>
      <table><thead><tr><th>#</th><th>Dish</th><th class="r">Sold</th><th class="r">Revenue</th></tr></thead><tbody>
        ${slow.map((x, j) => `<tr><td>${j + 1}</td><td>${esc(x.title)}</td><td class="r">${nfmt(x.qty)}</td><td class="r">${inr(x.revenue)}</td></tr>`).join("")}
      </tbody></table>
      <p class="mut" style="font-size:9.5px">The least-ordered dishes here this period — re-price, rework, promote, or drop.</p>` : ""; })()}
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
  /* An incomplete statement must SAY it is incomplete, on the paper itself. */
  .omit { margin: 10px 0 0; padding: 8px 11px; border: 1.5px solid #b45309; border-radius: 6px; background: #fff7ed; color: #7c2d12; font-size: 11px; }
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
  .kvt tr.em td { border-top: 1.5px solid #0f766e; background: #f6faf9; }
  .kvt tr.grand td { border-top: 2px solid #0f766e; border-bottom: 2px solid #0f766e; background: #eef7f4; font-size: 13.5px; }
  .r { text-align: right; }
  .mut { color: #6b7f78; }
  .note { margin-top: 26px; font-size: 10px; color: #6b7f78; border-top: 1px solid #d9e5e1; padding-top: 8px; }
  @media print { .brk { page-break-before: always; } body { padding: 0 6px; } .two { grid-template-columns: 1fr 1fr; } }
  @page { margin: 16mm 12mm; }
</style></head><body>
  <div class="mast"><span class="brand">Aevidine · Restaurant OS</span><span class="gen">Generated ${esc(d.generatedAt)}</span></div>
  <h1>Business performance report</h1>
  <div class="scope">${esc(d.scopeName)} · ${esc(d.periodLabel)}</div>
  ${d.omitted?.length ? `<div class="omit"><b>Incomplete:</b> ${esc(d.omitted.join(", "))} could not be read for this period, so ${d.omitted.length === 1 ? "it is" : "they are"} NOT included in any total below. Try again, or run ${d.omitted.length === 1 ? "that restaurant" : "those restaurants"} on their own.</div>` : ""}
  ${summary}
  ${comparison}
  ${slowSection}
  ${sections}
  <div class="note">"Total collected" is every rupee guests paid on paid, non-cancelled orders — the discount already taken off and the GST already included (discount applied before tax). "Money in hand" = total collected minus the GST set aside for the government (equivalently gross sales minus discounts) — that is the figure that is actually yours. GST figures come from the restaurant's configured tax lines; a restaurant with no tax configuration shows total tax only. Generated automatically by the Aevidine owner console.</div>
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},350)});</script>
</body></html>`;
}

// ── the same compiled sections as flat tables (CSV / Excel) ───────────────────
// Layout the owner asked for (2026-07-27): the averages/summary block sits on TOP,
// then the fully detailed day-wise sheet for the whole scope, then the sections.
// The printed sheet and the CSV must head the same value with the same word — this column was
// "Net" on paper and "Collected" in the spreadsheet (T5 sweep, 2026-08-11).
const dayHead = ["Period", "Orders", "Gross", "Discount", "GST", "Collected", "In hand"];
const dayRow = (x: DailyRow): (string | number)[] =>
  [x.label, x.orders, Math.round(x.gross), Math.round(x.discount), Math.round(x.tax), Math.round(x.net), Math.round(x.gross - x.discount)];
export function buildReportTables(d: ReportData): ExportTable[] {
  const g = d.group;
  const inHandOf = moneyInHand;
  const out: ExportTable[] = [];
  const gDaily = mergedDaily(d.restaurants);
  const activeDays = gDaily.filter((x) => x.orders > 0).length;
  if (d.omitted?.length) out.push({
    title: "INCOMPLETE — these restaurants could not be read and are NOT in any total below",
    head: ["Restaurant"], rows: d.omitted.map((n) => [n]),
  });
  out.push({
    title: `Aevidine business performance report — ${d.scopeName} — ${d.periodLabel} — generated ${d.generatedAt}`,
    head: ["Metric", "Value"],
    rows: [
      ["Total collected (paid bills, GST included)", Math.round(g.revenue)],
      ...(inHandOf(g.billing) != null ? [["Money in hand (after GST set aside)", Math.round(inHandOf(g.billing)!)] as (string | number)[]] : []),
      ["Orders", g.orders], ["Paid orders", g.paidOrders],
      ["Average bill", Math.round(g.avg)],
      ...(activeDays > 1 ? [
        ["Active days in the period", activeDays],
        ["Average collected per active day", Math.round(g.revenue / activeDays)],
        ["Average orders per active day", Math.round(g.orders / activeDays)],
      ] as (string | number)[][] : []),
      ...billingRows(g.billing).map(([l, v]) => [l, v] as (string | number)[]),
    ],
  });
  // multi-restaurant only — a single restaurant's own day table below already covers it
  if (d.restaurants.length > 1 && gDaily.length > 1) {
    out.push({
      title: `${d.scopeName} — day-by-day (detailed, whole scope)`,
      head: dayHead,
      rows: gDaily.map(dayRow),
    });
  }
  if (g.payments.length) {
    out.push({ title: "Settlement — all", head: ["Method", "Bills", "Amount"], rows: g.payments.map((p) => [p.method, p.orders, Math.round(p.revenue)]) });
  }
  if (g.khata && g.khata.outstanding > 0) {
    out.push({ title: "Pay Later (khata) — as of today", head: ["Item", "Value"], rows: [["Outstanding with customers", Math.round(g.khata.outstanding)], ["People who owe", g.khata.people], ["Collected this month", Math.round(g.khata.collectedMonth)]] });
  }
  if (d.restaurants.length > 1) {
    out.push({
      title: "Restaurant comparison",
      head: ["#", "Restaurant", "Total collected", "Share %", "Orders", "Paid orders", "Avg bill", "Total GST", "Cancelled value"],
      rows: d.restaurants.map((r, i) => [i + 1, r.name, Math.round(r.revenue), Math.round(r.share * 100), r.orders, r.paidOrders, Math.round(r.avg), r.billing.taxTotal != null ? Math.round(r.billing.taxTotal) : "", r.billing.cancelledValue != null ? Math.round(r.billing.cancelledValue) : ""]),
    });
    const gSlow = groupSlowDishes(d.restaurants);
    if (gSlow.length) out.push({
      title: "Slow movers — dishes that need a decision (weakest first)",
      head: ["#", "Dish", "Restaurant", "Sold", "Revenue"],
      rows: gSlow.map((x, i) => [i + 1, x.title, x.restaurant, x.qty, Math.round(x.revenue)]),
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
    { const slow = slowDishes(r.dishes);
      if (slow.length) out.push({
        title: `${r.name} — slow movers (least ordered)`,
        head: ["#", "Dish", "Sold", "Revenue"],
        rows: slow.map((x, j) => [j + 1, x.title, x.qty, Math.round(x.revenue)]),
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
      out.push({ title: `${r.name} — day-by-day breakdown`, head: dayHead, rows: r.daily.map(dayRow) });
    }
  }
  return out;
}
