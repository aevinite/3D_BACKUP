// t24-new-c.mjs — sweep #8 T24, block C: the money rules this half states, measured against the
// SAME rules the printed bill, the database and the Pay Later book state. A money rule that
// exists twice is a money rule that drifts — this file's own comments say so three times.
import { check, nid, F } from "./t24-run.mjs";

const { src, HELPERS, GETBLK, billdoc, endpointBlock, sql, FRENCH_HOUSE, live, needLive, J } = F;
const code = (t) => t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const HC = code(HELPERS);
const GC = code(GETBLK);
const SC = code(src);
const BD = billdoc;
const count = (t, re) => (t.match(re) || []).length;


// ── discountBaseOf — what a discount may work on ───────────────────────────────────────────────
// Re-implemented from the rule as WRITTEN DOWN (mig 270/272), then run against the same inputs.
const dbo = (o, rate) => {
  const sub = Number(o?.subtotal) || 0;
  if (rate > 0) return o?.taxable_base == null ? sub : (Number(o.taxable_base) || 0);
  return Math.max(0, sub - (Number(o?.mrp_amount) || 0));
};
const CASES = [
  ["an ordinary taxed order", { subtotal: 1000, taxable_base: 1000, mrp_amount: 0 }, 0.05, 1000],
  ["a taxed bill carrying a sealed bottle", { subtotal: 880, taxable_base: 800, mrp_amount: 80 }, 0.05, 800],
  ["an order from before the columns existed", { subtotal: 500, taxable_base: null, mrp_amount: null }, 0.05, 500],
  ["a composition (0%) restaurant", { subtotal: 880, taxable_base: 800, mrp_amount: 80 }, 0, 800],
  ["a 0% bill that is all sealed goods", { subtotal: 200, taxable_base: 0, mrp_amount: 200 }, 0, 0],
  ["a 0% legacy order", { subtotal: 400, taxable_base: null, mrp_amount: null }, 0, 400],
  ["a nil-rated dish (untaxed but discountable)", { subtotal: 300, taxable_base: 300, mrp_amount: 0 }, 0.05, 300],
  ["an empty order", {}, 0.05, 0],
  ["rubbish in the columns", { subtotal: "abc", taxable_base: "xyz", mrp_amount: "?" }, 0.05, 0],
  ["sealed goods worth more than the bill (nothing left to discount)", { subtotal: 100, taxable_base: 0, mrp_amount: 200 }, 0, 0],
];
for (const [label, o, rate, want] of CASES) {
  check(nid(), `what a discount may work on — ${label} → ${want}`, "run the route's own rule over the case",
    () => ({ ok: dbo(o, rate) === want, note: `got ${dbo(o, rate)}` }));
}
check(nid(), "the route's rule is written EXACTLY as the SQL and billMath state it", "read discountBaseOf",
  () => /if \(rate > 0\) return o\?\.taxable_base == null \? sub : \(Number\(o\.taxable_base\) \|\| 0\);\s*return Math\.max\(0, sub - \(Number\(o\?\.mrp_amount\) \|\| 0\)\);/.test(HC));
check(nid(), "…and billdoc's printed bill caps the same way (with tax → the taxable base)", "read billMoney",
  () => /var discountBase = anyTax \? taxableBase : Math\.max\(0, r2\(subtotal - mrpAmount\)\)/.test(BD));
check(nid(), "a NULL taxable_base means 'placed before this feature' — fully taxable, not zero", "read discountBaseOf",
  () => dbo({ subtotal: 700, taxable_base: null }, 0.05) === 700);
check(nid(), "a nil-rated dish is untaxed but still discountable (mig 272 — `nontax` is NOT the lock)", "read the comment beside discountBaseOf",
  () => /NOT the lock: a nil-rated dish is untaxed but perfectly discountable \(mig 272\)/.test(HELPERS));

// ── billTaxOf — the tax on ONE bill, at each order's own rate ───────────────────────────────────
// The route and the printed bill must answer identically. Both are re-implemented here from their
// own source shape and run over the same bills, including the banquet case that broke this before.
const r2 = (n) => Math.round(n * 100) / 100;
const rateOf = (o, s) => (Number(o.tax_rate) > 0 ? Number(o.tax_rate)
  : (o.tax_rate != null && (parseFloat(o.subtotal) || 0) > 0) ? 0 : (Number(s) || 0));
const routeTax = (g, s) => {
  const cap = g.reduce((a, o) => a + dbo(o, rateOf(o, s)), 0);
  const disc = Math.min(g.reduce((a, o) => a + (Number(o.discount) || 0), 0), cap);
  const b = new Map();
  for (const o of g) { const r = rateOf(o, s); const x = b.get(r) || { base: 0, disc: 0 };
    x.base += o.taxable_base == null ? (Number(o.subtotal) || 0) : (Number(o.taxable_base) || 0);
    x.disc += Number(o.discount) || 0; b.set(r, x); }
  let taxable = 0, tax = 0;
  for (const [r, x] of b) { const bB = r2(x.base);
    const bT = Math.max(0, r2(bB - Math.min(Math.max(0, r2(x.disc)), bB)));
    taxable = r2(taxable + bT); tax = r2(tax + r2(bT * r)); }
  return { disc, taxable, tax };
};
const paperTax = (g, s) => {
  const live = g.filter((o) => o.status !== "cancelled" && !o.deleted_at);
  const buckets = {};
  let taxableBase = 0, nontax = 0;
  live.forEach((o) => {
    const sub = parseFloat(o.subtotal) || 0;
    const base = o.taxable_base == null ? sub : (parseFloat(o.taxable_base) || 0);
    taxableBase += base; nontax += o.nontax_amount == null ? 0 : (parseFloat(o.nontax_amount) || 0);
    const r = rateOf(o, s); const k = String(r);
    const bk = buckets[k] || (buckets[k] = { rate: r, base: 0, disc: 0 });
    bk.base += base; bk.disc += parseFloat(o.discount) || 0;
  });
  taxableBase = r2(taxableBase);
  const list = Object.values(buckets);
  const anyTax = list.some((b) => b.rate > 0);
  const discountBase = anyTax ? taxableBase : Math.max(0, r2(r2(taxableBase + nontax) - 0));
  const rawDisc = r2(live.reduce((a, o) => a + (parseFloat(o.discount) || 0), 0));
  const disc = Math.min(Math.max(0, rawDisc), discountBase);
  let tax = 0;
  list.forEach((bk) => { const bB = r2(bk.base);
    const bD = Math.min(Math.max(0, r2(bk.disc)), bB);
    tax = r2(tax + r2(Math.max(0, r2(bB - bD)) * bk.rate)); });
  return { disc, tax };
};
const BILLS = [
  ["one plain 5% order", [{ subtotal: 1000, taxable_base: 1000, tax_rate: 0.05, discount: 0 }], 0.05],
  ["5% food beside an 18% banquet on one bill", [
    { subtotal: 1000, taxable_base: 1000, tax_rate: 0.05, discount: 0 },
    { subtotal: 2000, taxable_base: 2000, tax_rate: 0.18, discount: 0 }], 0.05],
  ["…with a discount on the food half", [
    { subtotal: 1000, taxable_base: 1000, tax_rate: 0.05, discount: 200 },
    { subtotal: 2000, taxable_base: 2000, tax_rate: 0.18, discount: 0 }], 0.05],
  ["a stamped ZERO on an order that carries money", [{ subtotal: 1000, taxable_base: 1000, tax_rate: 0, discount: 0 }], 0.05],
  ["a legacy order with no stamped rate", [{ subtotal: 1000, taxable_base: null, tax_rate: null, discount: 0 }], 0.05],
  ["a sealed bottle beside food", [{ subtotal: 880, taxable_base: 800, nontax_amount: 80, mrp_amount: 80, tax_rate: 0.05, discount: 0 }], 0.05],
  ["a discount bigger than the bill can carry", [{ subtotal: 880, taxable_base: 800, nontax_amount: 80, mrp_amount: 80, tax_rate: 0.05, discount: 880 }], 0.05],
  ["three orders at three rates", [
    { subtotal: 100, taxable_base: 100, tax_rate: 0.05, discount: 0 },
    { subtotal: 100, taxable_base: 100, tax_rate: 0.12, discount: 0 },
    { subtotal: 100, taxable_base: 100, tax_rate: 0.18, discount: 0 }], 0.05],
  ["a bill with nothing on it", [], 0.05],
  ["a ₹0 line sitting on a taxed bill", [
    { subtotal: 0, taxable_base: 0, tax_rate: 0, discount: 0 },
    { subtotal: 500, taxable_base: 500, tax_rate: 0.05, discount: 0 }], 0.05],
];
for (const [label, g, s] of BILLS) {
  check(nid(), `the day-close sheet and the printed bill agree on the TAX — ${label}`, "run both rules over the same bill",
    () => { const a = routeTax(g, s), b = paperTax(g, s);
      return { ok: a.tax === b.tax, note: `sheet ${a.tax} · paper ${b.tax}` }; });
  check(nid(), `…and on the DISCOUNT — ${label}`, "run both rules over the same bill",
    () => { const a = routeTax(g, s), b = paperTax(g, s);
      return { ok: a.disc === b.disc, note: `sheet ${a.disc} · paper ${b.disc}` }; });
}
check(nid(), "the sheet takes each order's OWN rate, never one borrowed from whichever came first", "read billTaxOf",
  () => /const rateOf = \(o: BillTaxRow\) => BILLDOC\.orderTaxRate\(o, settingsRate\)/.test(HC));
check(nid(), "…and it imports that definition rather than restating it", "read the import list",
  () => /import BILLDOC from "@\/public\/panels\/billdoc\.js"/.test(src));
check(nid(), "tax is rounded ONCE PER RATE, never per order", "read billTaxOf",
  () => /const buckets = new Map<number, \{ base: number; disc: number \}>\(\)/.test(HC));
check(nid(), "the whole-bill discount is capped by the same rule every discount door uses", "read billTaxOf",
  () => /const cap = g\.reduce\(\(a, o\) => a \+ discountBaseOf\(o, rateOf\(o\)\), 0\)/.test(HC));
check(nid(), "the settings rate is only ever the FALLBACK, for rows from before the column", "read billTaxOf's signature",
  () => /function billTaxOf\(g: BillTaxRow\[\], settingsRate: number\)/.test(HC));
check(nid(), "the tax settings read is one small row, and only on a discount write", "read taxSettings",
  () => /from\("settings"\)\.select\("tax_rate,tax_components,price_tax_mode"\)/.test(HC));

// ── THE PAY LATER BOOK: ONE definition of what is owed ─────────────────────────────────────────
// mig 310's own column comment: "EVERY money reader … sums THIS column, so no two screens can
// compute revenue differently." mig 364: a bill's debt is the order net MINUS what arrived with it.
const KC = code(endpointBlock("khata/customers"));
check(nid(), "the Pay Later BOOK asks the database for what is owed, in one place", "read GET /khata",
  () => /sb\.rpc\("lfh_khata_outstanding", \{ p_restaurant_ids: \[rid\] \}\)/.test(code(endpointBlock("khata"))));
check(nid(), "the person PICKER's 'owes ₹x' tag comes from that same one answer", "read GET /khata/customers",
  () => ({ ok: /lfh_khata_outstanding/.test(KC), note: /1 \+ rate/.test(KC) ? "it works the debt out for itself instead" : "" }));
check(nid(), "…so it cannot re-derive a tax rate from tax ÷ subtotal, which mig 301 removed", "read GET /khata/customers",
  () => ({ ok: !/tax \/ sub/.test(KC), note: /tax \/ sub/.test(KC) ? "the picker still divides tax by subtotal" : "" }));
check(nid(), "…and cannot count a BINNED bill as still owed (the book excludes deleted_at)", "read GET /khata/customers",
  () => ({ ok: /lfh_khata_outstanding/.test(KC) || /deleted_at/.test(KC), note: "the RPC filters deleted_at IS NULL" }));
check(nid(), "…and shows what is STILL owed on a part-collected tab, not the whole bill (mig 364)", "read GET /khata/customers",
  () => ({ ok: /lfh_khata_outstanding/.test(KC) || /lfh_session_collected|settle_group/.test(KC),
           note: "mig 364 subtracts the parts that arrived alongside the owed part" }));
check(nid(), "the picker's read is bounded like every other read here", "read GET /khata/customers",
  () => { const m = KC.match(/from\("orders"\)[\s\S]{0,400}?(?=\n\s*const|\n\s*\}|$)/); return { ok: !m || /\.limit\(/.test(m[0]) || !/from\("orders"\)/.test(KC), note: m ? m[0].replace(/\s+/g, " ").slice(0, 90) : "no orders read" }; });
check(nid(), "the 'owes ₹x' tag the PICKER shows equals what the Pay Later book says that person owes", "drive GET /khata/customers live, then redo the book's own rule in SQL",
  async () => {
    // The book's rule, written out from mig 364 rather than called — the function is service-role
    // only, and writing it out also makes this a check of the RULE and not of a name.
    const book = await sql(`
      WITH collected AS (
        SELECT sp.session_id, round(sum(sp.amount), 2) AS collected
          FROM session_payments sp
         WHERE sp.reversed_at IS NULL AND sp.khata_customer_id IS NULL AND sp.settle_group IS NOT NULL
           AND sp.restaurant_id = '${FRENCH_HOUSE}'
           AND EXISTS (SELECT 1 FROM session_payments owed
                        WHERE owed.settle_group = sp.settle_group AND owed.khata_customer_id IS NOT NULL
                          AND owed.settled_at IS NULL AND owed.reversed_at IS NULL)
         GROUP BY sp.session_id),
      oo AS (
        SELECT o.khata_customer_id, coalesce(o.session_id::text, o.id::text) AS bill_key, o.session_id,
               round(coalesce(o.net_amount, 0)::numeric, 2) AS due
          FROM orders o
         WHERE o.restaurant_id = '${FRENCH_HOUSE}' AND o.khata_at IS NOT NULL
           AND o.payment_status <> 'paid' AND o.status <> 'cancelled'
           AND o.deleted_at IS NULL AND o.khata_customer_id IS NOT NULL),
      per_bill AS (
        SELECT b.khata_customer_id, greatest(round(sum(b.due), 2) - coalesce(max(c.collected), 0), 0) AS amt
          FROM oo b LEFT JOIN collected c ON c.session_id = b.session_id
         GROUP BY b.khata_customer_id, b.bill_key)
      SELECT kc.name, round(sum(pb.amt), 2) AS owed
        FROM per_bill pb JOIN khata_customers kc ON kc.id = pb.khata_customer_id
       GROUP BY kc.name HAVING sum(pb.amt) > 0 ORDER BY 2 DESC LIMIT 3`);
    if (!book.length) return "skip: nobody on this restaurant currently owes anything";
    const off = [];
    for (const row of book) {
      const r = await F.api(`/khata/customers?q=${encodeURIComponent(String(row.name).slice(0, 12))}`);
      if (r.status !== 200) return { ok: false, note: `the picker answered ${r.status}` };
      const hit = (r.json.customers || []).find((c) => c.name === row.name);
      if (!hit) { off.push(`${row.name}: not found by the picker`); continue; }
      if (Math.abs(Number(hit.outstanding || 0) - Number(row.owed)) > 0.011)
        off.push(`${row.name}: the picker says \u20b9${hit.outstanding}, the book says \u20b9${row.owed}`);
    }
    return { ok: off.length === 0, note: off.length ? off.join(" · ") : `${book.length} people, every one agreeing` };
  });
check(nid(), "orders.net_amount is still the one stored definition of a bill's net", "one read-only SQL statement",
  async () => { const r = await sql(`SELECT count(*)::int n FROM orders WHERE net_amount IS DISTINCT FROM (total - disc_gross)`);
    return { ok: Number(r[0].n) === 0, note: `${r[0].n} orders out of step` }; });
check(nid(), "verify:one-number's allowance for this route covers only the LIVE-bill path its reason names", "read the guard's allow-list beside every line in this route that grosses a discount",
  async () => {
    const { readFileSync } = await import("node:fs");
    const guard = readFileSync(new URL("../verify-one-number.mjs", import.meta.url), "utf8");
    if (!/app\/api\/editor\/\[\.\.\.path\]\/route\.ts/.test(guard)) return { ok: true, note: "the file is no longer on the allow-list at all" };
    // The reason recorded is "the LIVE bill: due-now, close-the-table and the manager's own day
    // figures, on an OPEN session". A file-level allowance quietly covers every OTHER line too —
    // which is how the Pay Later picker came to work a debt out for itself under a green guard.
    const lines = code(src).split(/\r?\n/)
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => /\*\s*\(\s*1\s*\+/.test(l) && /disc/i.test(l));
    const inKhata = lines.filter(({ n }) => {
      const off = src.split(/\r?\n/).slice(0, n).join("\n").length;
      const k = src.indexOf('if (p === "khata/customers")');
      return k >= 0 && off > k && off < k + 1400;
    });
    return { ok: inKhata.length === 0, note: inKhata.length
      ? `line ${inKhata.map((x) => x.n).join(",")} is the Pay Later BOOK's figure, not a live bill`
      : `${lines.length} lines gross a discount here, none of them in the Pay Later picker` };
  });
