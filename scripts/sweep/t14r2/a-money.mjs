// Round 2 · bank A — MONEY ON PAPER (P214001–P214096). Re-planned from scratch on 2026-10-16 (owner:
// "replan whole test. Don't use the previous one"). Twelve tax set-ups × eight rules, each rule judged on
// 400 fresh random bills of that set-up, read off the PRINTED paper (billMoney → billData → billDocHtml).
import { sec, imp } from "../t14s10/lib.mjs";

const B = (await imp("public/panels/billdoc.js")).default;
const F = "public/panels/billdoc.js";
const a = sec(214000);

let seed = 20261016;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const G = "24AAAAA0000A1Z5";
// name, settings, the rates an order may be stamped at (null = never stamped → the settings rate)
const SETUPS = [
  ["plain 5%", { gstin: G, tax_rate: 0.05 }, [null, 0.05]],
  ["plain 18%", { gstin: G, tax_rate: 0.18 }, [null, 0.18]],
  ["named CGST+SGST 2.5", { gstin: G, tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }] }, [null, 0.05]],
  ["named with CESS (6%)", { gstin: G, tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }, { label: "CESS", rate: 1 }] }, [null, 0.06]],
  ["GST inside the price", { gstin: G, tax_rate: 0.05, price_tax_mode: "incl" }, [null, 0.05]],
  ["composition scheme", { gstin: G, tax_rate: 0.05, price_tax_mode: "composition" }, [null, 0]],
  ["no GSTIN (mig 426)", { gstin: "", tax_rate: 0.05 }, [null, 0]],
  ["mixed 5% + 18% banquet", { gstin: G, tax_rate: 0.05, banquet_tax_components: [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }] }, [0.05, 0.18]],
  ["MRP lines, no GST on MRP", { gstin: G, tax_rate: 0.05, item_tax_modes_allowed: true, mrp_tax_treatment: "none" }, [null, 0.05]],
  ["MRP lines, GST inside MRP", { gstin: G, tax_rate: 0.05, item_tax_modes_allowed: true, mrp_tax_treatment: "inclusive" }, [null, 0.05]],
  ["no GSTIN, older bill charged 5%", { gstin: "", tax_rate: 0.05 }, [0.05]],
  ["composition today, older bill charged 5%", { gstin: G, price_tax_mode: "composition" }, [0.05]],
];
// Each random order is PRICED the way the server prices it — lib/tax.ts splitBill, the TypeScript twin of
// lfh_price_order (verify:tax-mode holds the two together) — so every stored column is one the app could
// really have written: a tax-inside dish stores its NET as the taxable base, an MRP line its own pile.
const TAX = await imp("lib/tax.ts");
function order(st, rates) {
  const lines = [];
  for (let i = 0, n = 1 + Math.floor(rnd() * 5); i < n; i++) {
    const isMrp = !!st.item_tax_modes_allowed && rnd() < 0.2;
    const mode = isMrp ? "mrp" : "default";
    lines.push({ title: `Dish ${i}`, qty: 1 + Math.floor(rnd() * 4), price: isMrp ? pick([10, 20, 21, 40]) : Math.round(15 + rnd() * 700),
      tax_mode: TAX.resolveTaxMode(mode, st), is_mrp: TAX.isMrpDish(mode, st) });
  }
  const r = pick(rates);
  // a stamped rate other than today's (an older bill) is priced at THAT rate
  const st2 = r == null ? st : { ...st, gstin: "X", price_tax_mode: r === 0 && st.price_tax_mode === "composition" ? "composition" : (st.price_tax_mode === "composition" ? "excl" : st.price_tax_mode), tax_components: [], tax_rate: r || 0.0000001 };
  const pre = TAX.splitBill(lines, st2, 0);
  const disc = rnd() < 0.4 ? B.moneyRound(pre.discountBase * pick([0.03, 0.1, 0.15, 0.2, 0.5])) : 0;
  const sp = TAX.splitBill(lines, st2, disc);
  return { status: "served", subtotal: sp.subtotal, taxable_base: sp.taxableBase, nontax_amount: sp.nontaxAmount, mrp_amount: sp.mrpAmount ?? 0,
    discount: sp.discount, ...(r == null ? {} : { tax_rate: r }), items: lines, tip: rnd() < 0.1 ? Math.round(rnd() * 150) : 0 };
}
const rowsOf = (h) => {
  const top = h.slice(h.indexOf('<div class="totals">'), h.indexOf('class="g"><span>TOTAL'));
  return { rows: [...top.matchAll(/<div class="t(?: tx)?"><span>([^<]+)<\/span><span>([−+]?\s*)₹([\d,.]+)<\/span><\/div>/g)].map((m) => ({ k: m[1], v: (m[2].includes("−") ? -1 : 1) * Number(m[3].replace(/,/g, "")) })),
    total: Number(((h.match(/class="g"><span>TOTAL<\/span><span>₹([\d,]+)</) || [])[1] || "NaN").replace(/,/g, "")) };
};
const foot = (r) => r.rows.filter((x) => x.k !== "Taxable value").reduce((s, x) => s + x.v, 0);
const BILLS = SETUPS.map(([, st, rates]) => Array.from({ length: 400 }, () => {
  const os = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => order(st, rates));
  const m = B.billMoney(os, st);
  const html = B.billDocHtml(B.billData({ orders: os, settings: st, session: { bill_no: 7, invoice_no: rnd() < 0.5 ? 11 : null, invoice_at: "2026-10-01T10:00:00Z" } }));
  return { os, m, html, r: rowsOf(html) };
}));
const expectHead = (st, b) => {
  const charged = b.m.tax > 0;
  if (st.price_tax_mode === "composition" && !charged) return "Bill of Supply";
  return String(st.gstin || "").trim() ? "Tax Invoice" : "Bill";
};
let n = 1;
SETUPS.forEach(([name, st], si) => {
  const bills = BILLS[si];
  const first = (pred) => bills.findIndex(pred);
  const R = [
    ["every money row above the TOTAL adds up to it", (b) => Math.abs(foot(b.r) - b.r.total) < 0.001],
    ["the TOTAL is what was charged — billMoney's total, rounded once", (b) => b.r.total === Math.round(b.m.total)],
    ["no row but Discount / Round off is negative, and a Round off is never above ₹2", (b) => b.r.rows.every((x) => x.v >= 0 || /^Discount|^Round off/.test(x.k)) && b.r.rows.filter((x) => x.k === "Round off").every((x) => Math.abs(x.v) <= 2)],
    ["no 'undefined', 'NaN', '[object Object]' or '${' anywhere on the paper", (b) => !/undefined|NaN|\[object Object\]|\$\{/.test(b.html)],
    ["the heading names what the bill is (Tax Invoice / Bill / Bill of Supply) from what it CHARGED", (b) => new RegExp(`class="kind">${expectHead(st, b)}<`).test(b.html)],
    ["every tax line is named by the restaurant's own set for its rate, else the CGST/SGST halves — never a stretched rate", (b) => {
      const lines = b.r.rows.filter((x) => /^(CGST|SGST|CESS|IGST|GST) /.test(x.k)).map((x) => x.k);
      return lines.every((k) => { const [lbl, pct] = [k.split(" ")[0], Number(k.split(" ")[1].replace("%", ""))];
        const sets = [st.tax_components || [], st.banquet_tax_components || []];
        return sets.some((s) => s.some((c) => c.label === lbl && Math.abs(c.rate - pct) < 0.01)) || ((lbl === "CGST" || lbl === "SGST") && (b.m.rateRows || []).some((rr) => Math.abs(rr.rate * 50 - pct) < 0.01)); });
    }],
    // The label is worked out from the exact amounts, the rows are whole rupees — so it is judged within
    // the two roundings, never re-derived from rounded rows (3% of ₹552.00 is ₹16.56, printed ₹17).
    ["a discount's percentage describes the rupees printed beside it (within the whole-rupee rounding)", (b) => { const d = b.r.rows.find((x) => x.k.startsWith("Discount")); if (!d) return true; const m = d.k.match(/\(([\d.]+)%\)/); if (!m) return true; const p = Number(m[1]) / 100; return Math.abs(p * b.r.rows[0].v - -d.v) <= 1 + p + 0.051 * b.r.rows[0].v / 100; }],
    ["a tip prints BELOW the TOTAL, PAID = TOTAL + tip, and never above the line", (b) => { const tip = b.os.reduce((t, o) => t + (o.tip || 0), 0); if (!tip) return !/<span>Tip/.test(b.html); const paid = b.html.match(/PAID<\/span><span>₹([\d,]+)/); return b.html.indexOf("<span>Tip") > b.html.indexOf('class="g"><span>TOTAL') && paid && Number(paid[1].replace(/,/g, "")) === b.r.total + Math.round(tip); }],
  ];
  R.forEach(([rule, pass]) => {
    const id = n++;
    a(id, F, `${name}: ${rule}`, "400 fresh random bills of this set-up, judged on the printed paper", () => {
      const i = first((b) => !pass(b));
      return i < 0 || `bill #${i} fails: rows ${JSON.stringify(bills[i].r.rows).slice(0, 160)} total ${bills[i].r.total} charged ${bills[i].m.total}`;
    });
  });
});
