// Round 3 (owner, 2026-10-09: "check every single bit … replan whole test") — PROPERTIES.
//
// Rounds 1 and 2 proved every line and branch with chosen examples. This suite asks the other
// question: does each RULE hold for every input, not just the ones a person thought of? Each check
// states one rule and runs it against thousands of inputs from a SEEDED generator (the same seed
// gives the same inputs, so a failure is replayable — the first counter-example is printed).
// Real files, in-memory database (./sb.mjs), nothing sent anywhere.
import { suite, quiet } from "./lib.mjs";
import { W, world } from "./sb.mjs";
const t = suite("scripts/t30-harness (properties)", 167001, 300);

const T = await import("@/lib/tax.ts");
const F = await import("@/lib/taxFiling.ts");
const PS = await import("@/lib/paySplit.ts");
const DC = await import("@/lib/discountCap.ts");
const CC = await import("@/lib/clashCompare.ts");
const IR = await import("@/lib/idempotencyRule.ts");
const DB = await import("@/lib/dbRefusal.ts");
const RG = await import("@/lib/readGuard.ts");
const M = await import("@/lib/money.ts");
const MJ = await import("@/lib/money.mjs");
const BILLDOC = (await import("@/public/panels/billdoc.js")).default;
const sb = (await import("./sb.mjs")).supabaseAdmin;

// ── the generator ────────────────────────────────────────────────────────────────────────────────
const gen = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const int = (R, a, b) => a + Math.floor(R() * (b - a + 1));
const pick = (R, xs) => xs[Math.floor(R() * xs.length)];
const paise = (R, maxRs) => int(R, 0, maxRs * 100) / 100;
const P = (x) => Math.round(Number(x) * 100);
const eqp = (a, b) => P(a) === P(b);
const whole = (x) => Number.isFinite(x) && Math.abs(x * 100 - Math.round(x * 100)) < 1e-6;
const r2 = (n) => Math.round(n * 100) / 100;
const shuffle = (R, xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = int(R, 0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };
let SEED = 7001;
const prop = async (what, n, make, ok) => {
  const R = gen(SEED++); let bad = null;
  for (let i = 0; i < n && !bad; i++) {
    const x = make(R, i); let res;
    try { res = await ok(x, R); } catch (e) { res = "threw: " + (e && e.message); }
    if (res !== true) bad = { x, res };
  }
  t(`${what} — ${n.toLocaleString("en-IN")} random cases`, !bad, bad ? `counter-example ${JSON.stringify(bad.x).slice(0, 150)} → ${String(bad.res).slice(0, 40)}` : "");
};

const COMPS = [[], [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }], [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }],
  [{ label: "CGST", rate: 6 }, { label: "SGST", rate: 6 }], [{ label: "IGST", rate: 28 }], [{ label: "VAT", rate: 12.5 }], [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }, { label: "Cess", rate: 1 }]];
const settingsOf = (R) => ({ tax_rate: pick(R, [null, 0.05, 0.12, 0.18, 0.28, 0.025, 0]), tax_components: pick(R, COMPS), price_tax_mode: pick(R, ["excl", "incl", "composition", "excl", undefined]),
  item_tax_modes_allowed: R() < 0.5, mrp_tax_treatment: pick(R, ["inclusive", "none", undefined]) });
const taxedSettings = (R) => { let s; do s = settingsOf(R); while (T.effectiveTaxRate(s) === 0); return s; };
const priceOf = (R) => pick(R, [() => paise(R, 2000), () => int(R, 1, 2000), () => String(int(R, 1, 2000)), () => "₹" + paise(R, 2000).toFixed(2), () => `${int(R, 1, 99)}.99`, () => `₹${int(R, 1, 9)},${String(int(R, 0, 999)).padStart(3, "0")}`])();
const lineOf = (R, mode) => ({ price: priceOf(R), qty: R() < 0.2 ? String(int(R, 1, 6)) : int(R, 1, 6), tax_mode: mode ?? pick(R, ["excl", "incl", "exempt", "excl", undefined]), is_mrp: R() < 0.15 });
const linesOf = (R, k = int(R, 0, 9), mode) => Array.from({ length: k }, () => lineOf(R, mode));
const amtOf = (ln) => Math.round((parseFloat(String(ln.price).replace(/[^0-9.]/g, "")) || 0) * Math.max(1, parseInt(String(ln.qty), 10) || 1) * 100) / 100;
const billCase = (R) => { const s = settingsOf(R); const lines = linesOf(R); const d = R() < 0.4 ? 0 : R() < 0.7 ? paise(R, 500) : paise(R, 30000); return { s, lines, d }; };

// ═══ lib/tax.ts · splitBill — the ONE place a cart turns into money on a screen ═════════════════════
await prop("splitBill never throws and every figure it returns is a finite number", 20000, billCase, ({ s, lines, d }) => {
  const b = T.splitBill(lines, s, d); return ["taxableBase", "nontaxAmount", "mrpAmount", "subtotal", "discountBase", "discount", "taxable", "rate", "tax", "total"].every((k) => Number.isFinite(b[k])) || "non-finite"; });
await prop("splitBill: every money figure is a whole number of paise (when the discount asked for is)", 20000, billCase, ({ s, lines, d }) => {
  const b = T.splitBill(lines, s, d); return ["taxableBase", "nontaxAmount", "mrpAmount", "subtotal", "discountBase", "discount", "taxable", "tax", "total"].every((k) => whole(b[k])) || "fraction of a paisa"; });
await prop("splitBill: subtotal = taxable base + untaxed lines, to the paisa", 20000, billCase, ({ s, lines, d }) => { const b = T.splitBill(lines, s, d); return eqp(b.subtotal, b.taxableBase + b.nontaxAmount); });
await prop("splitBill: THE BILL IDENTITY — total = subtotal − discount + tax, to the paisa, at every rate", 20000, billCase, ({ s, lines, d }) => { const b = T.splitBill(lines, s, d); return eqp(b.total, b.subtotal - b.discount + b.tax) || `${b.total} vs ${r2(b.subtotal - b.discount + b.tax)}`; });
await prop("splitBill: the discount is never below 0 and never above the discount base", 20000, billCase, ({ s, lines, d }) => { const b = T.splitBill(lines, s, d); return (b.discount >= 0 && b.discount <= b.discountBase + 1e-9); });
await prop("splitBill: a discount within the base is applied exactly as asked; one above it is cut to the base", 20000, billCase, ({ s, lines, d }) => {
  const b = T.splitBill(lines, s, d); return d <= b.discountBase ? b.discount === d : b.discount === b.discountBase; });
await prop("splitBill: a negative, blank or nonsense discount is read as no discount", 5000, (R) => ({ s: settingsOf(R), lines: linesOf(R, int(R, 1, 6)), d: pick(R, [-1, -500, NaN, "abc", null, undefined, ""]) }), ({ s, lines, d }) => T.splitBill(lines, s, d).discount === 0);
await prop("splitBill: when tax applies, the discount comes off the TAXABLE part (taxable = base − discount)", 20000, billCase, ({ s, lines, d }) => { const b = T.splitBill(lines, s, d); return b.rate === 0 || eqp(b.taxable, b.taxableBase - b.discount); });
await prop("splitBill: the tax is the taxable amount × the rate, rounded once to the paisa", 20000, billCase, ({ s, lines, d }) => { const b = T.splitBill(lines, s, d); return eqp(b.tax, b.taxable * b.rate); });
await prop("splitBill: at a 0% rate there is no tax at all", 10000, (R) => { const c = billCase(R); c.s = { ...c.s, price_tax_mode: "composition" }; return c; }, ({ s, lines, d }) => { const b = T.splitBill(lines, s, d); return b.tax === 0 && b.rate === 0 && b.composition === true; });
await prop("splitBill: the discount base is the taxable base when tax applies, else everything but the locked MRP part", 20000, billCase, ({ s, lines, d }) => {
  const b = T.splitBill(lines, s, d); return b.rate > 0 ? b.discountBase === b.taxableBase : eqp(b.discountBase, Math.max(0, b.taxableBase + b.nontaxAmount - b.mrpAmount)); });
await prop("splitBill: the rate it uses is exactly effectiveTaxRate(settings)", 10000, billCase, ({ s, lines, d }) => T.splitBill(lines, s, d).rate === T.effectiveTaxRate(s));
await prop("splitBill: the ORDER of the lines never changes a single figure", 10000, (R) => ({ ...billCase(R), seed: int(R, 1, 1e9) }), ({ s, lines, d, seed }) => {
  const a = T.splitBill(lines, s, d), b = T.splitBill(shuffle(gen(seed), lines), s, d); return JSON.stringify(a) === JSON.stringify(b); });
await prop("splitBill: the locked MRP amount is exactly the MRP lines' amounts added up, and hasMrp says whether there are any", 20000, billCase, ({ s, lines, d }) => {
  const b = T.splitBill(lines, s, d); const m = lines.filter((l) => l.is_mrp); return eqp(b.mrpAmount, m.reduce((a, l) => a + amtOf(l), 0)) && b.hasMrp === m.length > 0; });
await prop("splitBill: an untaxed (exempt) line lands in the untaxed figure, whole, and nowhere else", 10000, (R) => ({ ...billCase(R), x: lineOf(R, "exempt") }), ({ s, lines, d, x }) => {
  const a = T.splitBill(lines, s, d), b = T.splitBill([...lines, x], s, d); return eqp(b.nontaxAmount - a.nontaxAmount, amtOf(x)) && eqp(b.taxableBase, a.taxableBase); });
await prop("splitBill: a tax-on-top line adds its whole amount to the taxable base", 10000, (R) => ({ ...billCase(R), x: lineOf(R, "excl") }), ({ s, lines, d, x }) => {
  const a = T.splitBill(lines, s, d), b = T.splitBill([...lines, x], s, d); return eqp(b.taxableBase - a.taxableBase, amtOf(x)) && eqp(b.nontaxAmount, a.nontaxAmount); });
await prop("splitBill: a tax-inside line adds amount ÷ (1 + rate), rounded per line, to the taxable base", 10000, (R) => ({ ...billCase(R), x: lineOf(R, "incl") }), ({ s, lines, d, x }) => {
  const a = T.splitBill(lines, s, d), b = T.splitBill([...lines, x], s, d); return eqp(b.taxableBase - a.taxableBase, Math.round((amtOf(x) / (1 + a.rate)) * 100) / 100); });
await prop("splitBill: one tax-inside dish, no discount — the guest pays its printed price, give or take one paisa", 20000, (R) => ({ s: taxedSettings(R), x: lineOf(R, "incl") }), ({ s, x }) => {
  const b = T.splitBill([x], s, 0); return Math.abs(P(b.total) - P(amtOf(x))) <= 1 || `${b.total} for a ${amtOf(x)} dish`; });
await prop("splitBill: a whole cart of tax-inside dishes stays within half a paisa per dish of the printed prices (+1)", 10000, (R) => ({ s: taxedSettings(R), lines: linesOf(R, int(R, 1, 12), "incl") }), ({ s, lines }) => {
  const b = T.splitBill(lines, s, 0); const want = lines.reduce((a, l) => a + amtOf(l), 0); return Math.abs(P(b.total) - P(want)) <= Math.ceil(lines.length / 2) + 1 || `${b.total} vs ${r2(want)}`; });
await prop("splitBill: adding any dish never makes the bill smaller (no discount)", 10000, (R) => ({ ...billCase(R), x: lineOf(R) }), ({ s, lines, x }) => T.splitBill([...lines, x], s, 0).total >= T.splitBill(lines, s, 0).total);
await prop("splitBill: a bigger discount never makes the bill bigger", 10000, (R) => ({ ...billCase(R), d2: paise(R, 5000) }), ({ s, lines, d, d2 }) => {
  const lo = Math.min(d, d2), hi = Math.max(d, d2); return T.splitBill(lines, s, hi).total <= T.splitBill(lines, s, lo).total; });
await prop("splitBill: tax-on-top dishes, no discount — total = base + base × rate, exactly", 10000, (R) => ({ s: settingsOf(R), lines: linesOf(R, int(R, 1, 10), "excl").map((l) => ({ ...l, is_mrp: false })) }), ({ s, lines }) => {
  const b = T.splitBill(lines, s, 0); const base = r2(lines.reduce((a, l) => a + amtOf(l), 0)); return eqp(b.taxableBase, base) && eqp(b.total, base + r2(base * b.rate)); });
await prop("splitBill: a hole or junk in the cart (null, {}, text, a NaN price) never throws and counts as ₹0 × 1", 5000, (R) => ({ s: settingsOf(R), lines: [...linesOf(R, int(R, 0, 4)), pick(R, [null, {}, "x", { price: NaN }, { price: "free", qty: "lots" }, { qty: -4 }])] }), ({ s, lines }) => {
  const clean = lines.filter((l) => l && typeof l === "object" && Number.isFinite(parseFloat(String(l.price ?? "").replace(/[^0-9.]/g, ""))));
  return eqp(T.splitBill(lines, s, 0).total, T.splitBill(clean, s, 0).total); });
await prop("splitBill: a quantity of 0, a negative one, or text counts as 1; '3' counts as 3", 5000, (R) => ({ s: settingsOf(R), p: int(R, 1, 900), q: pick(R, [0, -2, "abc", "", null, "3", 3]) }), ({ s, p, q }) => {
  const want = q === "3" || q === 3 ? 3 : 1; return eqp(T.splitBill([{ price: p, qty: q, tax_mode: "excl" }], s, 0).taxableBase, p * want); });
await prop("splitBill: a price written '₹1,250.50' is read as 1250.5", 2000, (R) => ({ s: settingsOf(R), rs: int(R, 1, 9), ps: int(R, 0, 99) }), ({ s, rs, ps }) => {
  const txt = `₹${rs},${String(int(gen(rs * 1000 + ps), 0, 999)).padStart(3, "0")}.${String(ps).padStart(2, "0")}`; return eqp(T.splitBill([{ price: txt, qty: 1 }], s, 0).taxableBase, parseFloat(txt.replace(/[^0-9.]/g, ""))); });

// ═══ splitBill ⇄ the printed bill ⇄ Pay in parts — three places, one bill ═══════════════════════════
const asOrder = (b, lines, id, extra = {}) => ({ id, restaurant_id: "R", table_number: "5", session_id: "s1", status: "served", payment_status: "pending", deleted_at: null, archived: false,
  subtotal: b.subtotal, taxable_base: b.taxableBase, nontax_amount: b.nontaxAmount, mrp_amount: b.mrpAmount, discount: b.discount, tax: b.tax, total: b.total, tax_rate: b.rate,
  items: lines.map((l) => ({ ...l, price: parseFloat(String(l.price).replace(/[^0-9.]/g, "")) || 0, qty: Math.max(1, parseInt(String(l.qty), 10) || 1) })), ...extra });
await prop("ONE ORDER: the printed bill (billdoc billMoney) and the screen (splitBill) show the SAME total", 20000, billCase, ({ s, lines, d }) => {
  const b = T.splitBill(lines, s, d); const m = BILLDOC.billMoney([asOrder(b, lines, "o1")], s); return eqp(m.total, b.total) || `paper ${m.total} vs screen ${b.total}`; });
await prop("ONE ORDER: …and the same tax, discount and subtotal", 20000, billCase, ({ s, lines, d }) => {
  const b = T.splitBill(lines, s, d); const m = BILLDOC.billMoney([asOrder(b, lines, "o1")], s); return (eqp(m.tax, b.tax) && eqp(m.disc, b.discount) && eqp(m.subtotal, b.subtotal)) || `tax ${m.tax}/${b.tax} disc ${m.disc}/${b.discount}`; });
await prop("the printed bill's rate model (billdoc taxModel) = effectiveTaxRate for every real tax set-up", 20000, settingsOf, (s) => BILLDOC.taxModel(s).rate === T.effectiveTaxRate(s) || `${BILLDOC.taxModel(s).rate} vs ${T.effectiveTaxRate(s)}`);
const billOf = (R) => {
  const s = settingsOf(R); const k = int(R, 1, 5); const orders = [];
  for (let i = 0; i < k; i++) {
    const lines = linesOf(R, int(R, 1, 6)); const b0 = T.splitBill(lines, s, 0);
    const b = T.splitBill(lines, s, R() < 0.5 ? 0 : paise(R, Math.max(0, b0.discountBase)));
    // a banquet order stamped at its own rate makes a MIXED-rate bill (the case item 23 was about)
    const stamped = R() < 0.2 && b.rate > 0 ? { ...b, rate: pick(R, [0.12, 0.18]), tax: r2(b.taxable * 0.18) } : b;
    orders.push(asOrder(stamped, lines, `o${i}`));
  }
  return { s, orders };
};
await prop("PAY IN PARTS asks for exactly what the printed bill says is due — accepts parts adding to it, to the paisa", 3000, billOf, async ({ s, orders }) => {
  const m = BILLDOC.billMoney(orders, s); if (m.total < 0.02) return true;
  world({ sessions: [{ id: "s1", restaurant_id: "R", table_number: "5", status: "open", last_activity_at: "2026-10-09T10:00:00Z" }], orders, settings: [{ restaurant_id: "R", ...s }], session_payments: [], khata_customers: [] });
  const a = r2(Math.floor(m.total * 50) / 100); const r = await quiet(() => PS.settleBillInParts(sb, { rid: "R", table: "5", splits: [{ amount: a, method: "Cash" }, { amount: r2(m.total - a), method: "UPI" }] }));
  return (r.ok && eqp(r.due, m.total)) || `paper ${m.total} vs pay-in-parts ${r.due ?? r.message}`; });
await prop("PAY IN PARTS refuses parts that miss the printed bill's total by 3 paise or more, either way", 2000, (R) => ({ ...billOf(R), off: pick(R, [0.03, -0.03, 0.5, -1, 10]) }), async ({ s, orders, off }) => {
  const m = BILLDOC.billMoney(orders, s); if (m.total < 20) return true;
  world({ sessions: [{ id: "s1", restaurant_id: "R", table_number: "5", status: "open", last_activity_at: "2026-10-09T10:00:00Z" }], orders, settings: [{ restaurant_id: "R", ...s }], session_payments: [], khata_customers: [] });
  const r = await quiet(() => PS.settleBillInParts(sb, { rid: "R", table: "5", splits: [{ amount: 10, method: "Cash" }, { amount: r2(m.total - 10 + off), method: "UPI" }] }));
  return (!r.ok && r.status === 409 && W.FIX.session_payments.length === 0) || `accepted ${off} off`; });
await prop("PAY IN PARTS: when it settles, the parts it stores add up to what it collected plus what it parked", 1500, billOf, async ({ s, orders }) => {
  const m = BILLDOC.billMoney(orders, s); if (m.total < 1) return true;
  world({ sessions: [{ id: "s1", restaurant_id: "R", table_number: "5", status: "open", last_activity_at: "2026-10-09T10:00:00Z" }], orders, settings: [{ restaurant_id: "R", ...s }], session_payments: [], khata_customers: [] });
  const a = r2(Math.floor(m.total * 30) / 100); const r = await quiet(() => PS.settleBillInParts(sb, { rid: "R", table: "5", splits: [{ amount: a, method: "Card" }, { amount: r2(m.total - a), method: "Pay later", khataName: "Ravi" }] }));
  const stored = W.FIX.session_payments.reduce((x, l) => x + Number(l.amount), 0);
  return (r.ok && eqp(stored, r.collected + r.owed) && eqp(r.owed, r2(m.total - a)) && r.parked === true) || JSON.stringify(r).slice(0, 60); });

// ═══ lib/tax.ts · the rate and the per-dish behaviour ════════════════════════════════════════════════
await prop("effectiveTaxRate: named components → their percents added up ÷ 100; composition → 0; else tax_rate, else 5%", 20000, settingsOf, (s) => {
  const want = s.price_tax_mode === "composition" ? 0 : s.tax_components.length ? s.tax_components.reduce((a, c) => a + c.rate, 0) / 100 : (Number(s.tax_rate) || 0.05);
  return T.effectiveTaxRate(s) === want; });
await prop("effectiveTaxRate: a component with no name, or a rate of 0 or less, is not counted", 10000, (R) => ({ good: pick(R, COMPS.slice(1)), junk: pick(R, [{ label: "", rate: 5 }, { label: "  ", rate: 5 }, { label: "X", rate: 0 }, { label: "Y", rate: -3 }, { rate: 4 }, null]) }), ({ good, junk }) =>
  T.effectiveTaxRate({ tax_components: [...good, junk] }) === T.effectiveTaxRate({ tax_components: good }));
await prop("effectiveTaxPct = the rate as a percent, two decimals", 20000, settingsOf, (s) => T.effectiveTaxPct(s) === Math.round(T.effectiveTaxRate(s) * 10000) / 100);
await prop("taxComponents returns only named, positive components, in order", 10000, settingsOf, (s) => JSON.stringify(T.taxComponents(s)) === JSON.stringify(s.tax_components.filter((c) => c.label && c.rate > 0)));
const ORACLE = (dish, s) => { const pm = s.price_tax_mode === "incl" || s.price_tax_mode === "composition" ? s.price_tax_mode : "excl"; if (pm === "composition") return "exempt";
  const rest = pm === "incl" ? "incl" : "excl"; if (s.item_tax_modes_allowed !== true) return rest; const m = dish ?? "default";
  return m === "excl" || m === "incl" ? m : m === "none" ? "exempt" : m === "mrp" ? (s.mrp_tax_treatment === "inclusive" ? "incl" : "exempt") : rest; };
for (const dish of ["default", "excl", "incl", "mrp", "none", null, undefined, "garbage"]) {
  let bad = null, n = 0;
  for (const pm of ["excl", "incl", "composition", undefined, "weird"]) for (const allowed of [true, false, "true", undefined]) for (const mt of ["inclusive", "none", undefined]) {
    n++; const s = { price_tax_mode: pm, item_tax_modes_allowed: allowed, mrp_tax_treatment: mt }; if (T.resolveTaxMode(dish, s) !== ORACLE(dish, s)) bad ||= JSON.stringify(s);
  }
  t(`resolveTaxMode(${JSON.stringify(dish) ?? "undefined"}) gives the written rule for EVERY restaurant set-up (all ${n} combinations)`, !bad, bad || "");
}
t("isMrpDish is true exactly when the dish says 'mrp' AND per-dish modes are switched on (every combination)", ["mrp", "default", null, "MRP"].every((d) => [true, false, "true"].every((a) => T.isMrpDish(d, { item_tax_modes_allowed: a }) === (d === "mrp" && a === true))));
t("priceTaxMode only ever answers excl, incl or composition", [null, undefined, "", "incl", "composition", "excl", "INCL", 5, {}].every((v) => ["excl", "incl", "composition"].includes(T.priceTaxMode({ price_tax_mode: v }))));
t("itemTaxModesAllowed is true only for the boolean true (the text 'true' does not switch it on)", [true].every((v) => T.itemTaxModesAllowed({ item_tax_modes_allowed: v })) && [false, "true", 1, null, undefined].every((v) => !T.itemTaxModesAllowed({ item_tax_modes_allowed: v })));

// ═══ lib/taxFiling.ts · the GST filing's sums ═══════════════════════════════════════════════════════
const ratesOf = (R) => Array.from({ length: int(R, 1, 4) }, () => pick(R, [2.5, 9, 6, 14, 1, 0.5, 12.5, 3]));
await prop("splitTax: the parts add up to the target EXACTLY, to the paisa", 30000, (R) => ({ rates: ratesOf(R), target: paise(R, pick(R, [1, 50, 5000, 500000])) }), ({ rates, target }) => eqp(F.splitTax(rates, target).reduce((a, x) => a + x, 0), target));
await prop("splitTax: one part per rate, each a whole number of paise", 30000, (R) => ({ rates: ratesOf(R), target: paise(R, 50000) }), ({ rates, target }) => { const p = F.splitTax(rates, target); return p.length === rates.length && p.every(whole); });
await prop("splitTax: no part is ever negative when every rate is positive and the target is not", 30000, (R) => ({ rates: ratesOf(R), target: pick(R, [int(R, 0, 5) / 100, paise(R, 3), int(R, 0, 50000)]) }), ({ rates, target }) => F.splitTax(rates, target).every((x) => x >= 0) || JSON.stringify(F.splitTax(rates, target)));
await prop("splitTax: every part is within one paisa per rate of its exact share", 30000, (R) => ({ rates: ratesOf(R), target: paise(R, 50000) }), ({ rates, target }) => {
  const sum = rates.reduce((a, r) => a + r, 0); return F.splitTax(rates, target).every((x, i) => Math.abs(P(x) - P(target * (rates[i] / sum))) <= rates.length); });
await prop("splitTax: equal rates (CGST = SGST) split a whole-rupee target to within one paisa of each other", 30000, (R) => ({ n: int(R, 2, 3), r: pick(R, [2.5, 9, 6, 14]), target: int(R, 0, 100000) }), ({ n, r, target }) => {
  const p = F.splitTax(Array(n).fill(r), target); return P(Math.max(...p)) - P(Math.min(...p)) <= 1; });
t("splitTax: no rates → no parts", F.splitTax([], 100).length === 0);
await prop("allocateWhole: the whole rupees add up to round(total) EXACTLY", 30000, (R) => ({ total: (R() - 0.2) * pick(R, [10, 1000, 1e6]), w: Array.from({ length: int(R, 1, 30) }, () => (R() < 0.2 ? 0 : R() * pick(R, [1, 100, 1e5]))) }), ({ total, w }) => F.allocateWhole(total, w).reduce((a, x) => a + x, 0) === Math.round(total));
await prop("allocateWhole: every share is a whole rupee within ONE rupee of its exact share", 30000, (R) => ({ total: R() * 1e6, w: Array.from({ length: int(R, 1, 30) }, () => (R() < 0.2 ? 0 : R() * 1000)) }), ({ total, w }) => {
  const s = w.reduce((a, x) => a + x, 0); if (s <= 0) return true; const out = F.allocateWhole(total, w); return out.every((x, i) => Number.isInteger(x) && Math.abs(x - (w[i] / s) * Math.round(total)) < 1); });
await prop("allocateWhole: nothing is negative when the total is not", 30000, (R) => ({ total: R() * 1e5, w: Array.from({ length: int(R, 1, 20) }, () => R() * 100) }), ({ total, w }) => F.allocateWhole(total, w).every((x) => x >= 0));
await prop("allocateWhole: a row with no weight gets nothing, while any row has weight", 30000, (R) => ({ total: R() * 1e5, w: Array.from({ length: int(R, 2, 20) }, (_, i) => (i === 0 ? 1 + R() : R() < 0.4 ? 0 : R() * 100)) }), ({ total, w }) => F.allocateWhole(total, w).every((x, i) => w[i] > 0 || x === 0));
await prop("allocateWhole: no weight anywhere → the whole amount sits on the first row", 5000, (R) => ({ total: R() * 1e5, n: int(R, 1, 10) }), ({ total, n }) => { const o = F.allocateWhole(total, Array(n).fill(0)); return o[0] === Math.round(total) && o.slice(1).every((x) => x === 0); });
await prop("allocateWhole: scaling every weight by the same amount changes nothing", 20000, (R) => ({ total: int(R, 0, 1e5), w: Array.from({ length: int(R, 1, 15) }, () => int(R, 0, 1000)), k: pick(R, [2, 10, 0.5, 100]) }), ({ total, w, k }) => JSON.stringify(F.allocateWhole(total, w)) === JSON.stringify(F.allocateWhole(total, w.map((x) => x * k))));
await prop("allocateWhole: a negative total (a refund-heavy month) still adds up exactly and stays within one rupee", 20000, (R) => ({ total: -R() * 1e5, w: Array.from({ length: int(R, 1, 20) }, () => R() * 100) }), ({ total, w }) => {
  const o = F.allocateWhole(total, w); const s = w.reduce((a, x) => a + x, 0); return o.reduce((a, x) => a + x, 0) === Math.round(total) && o.every((x, i) => Math.abs(x - (w[i] / s) * Math.round(total)) < 1); });
const filingCase = (R) => ({ rows: Array.from({ length: int(R, 0, 40) }, () => ({ t: R() < 0.1 ? 0 : paise(R, pick(R, [50, 5000, 50000])) })), lines: pick(R, [[{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }], [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }], [{ label: "IGST", rate: 18 }], [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }, { label: "Cess", rate: 1 }]]) });
await prop("buildFiling: the filing's total = the rows' tax added up and rounded to the rupee", 20000, filingCase, ({ rows, lines }) => F.buildFiling(rows, lines, (r) => r.t).total === Math.round(rows.reduce((a, r) => a + r.t, 0)));
await prop("buildFiling: the rows' whole-rupee tax adds up to the filing's total", 20000, filingCase, ({ rows, lines }) => { const f = F.buildFiling(rows, lines, (r) => r.t); return f.rows.reduce((a, r) => a + r.tax, 0) === f.total; });
await prop("buildFiling: on every row, CGST + SGST (+ cess) = that row's tax, to the paisa", 20000, filingCase, ({ rows, lines }) => F.buildFiling(rows, lines, (r) => r.t).rows.every((r) => eqp(r.parts.reduce((a, x) => a + x, 0), r.tax)));
await prop("buildFiling: the column totals add up to the filing's total, to the paisa", 20000, filingCase, ({ rows, lines }) => { const f = F.buildFiling(rows, lines, (r) => r.t); return eqp(f.columnTotals.reduce((a, x) => a + x, 0), f.total); });
await prop("buildFiling: no column total and no row part is negative", 20000, filingCase, ({ rows, lines }) => { const f = F.buildFiling(rows, lines, (r) => r.t); return f.columnTotals.every((x) => x >= 0) && f.rows.every((r) => r.parts.every((x) => x >= 0)); });
const moneyRow = (R) => ({ tax: paise(R, 5000), subtotal: paise(R, 100000), discount: R() < 0.5 ? 0 : paise(R, 2000), paidOrders: int(R, 0, 3000) });
await prop("taxableValue never exceeds net sales, and equals net sales when no rate is known", 20000, (R) => ({ row: moneyRow(R), pct: pick(R, [null, 0, 5, 12, 18, 28]) }), ({ row, pct }) => {
  const v = F.taxableValue(row, pct), net = row.subtotal - row.discount; return v <= net + 1e-9 && (pct ? true : v === net); });
await prop("netSalesOf = subtotal − discount, to the paisa", 20000, moneyRow, (row) => F.netSalesOf(row) === r2(row.subtotal - row.discount));
await prop("exemptTolerance = the larger of ₹100 and 50 paise per paid order", 20000, (R) => int(R, 0, 100000), (n) => F.exemptTolerance(n) === Math.max(100, n * 0.5));
await prop("exemptIsMaterial: false with no rate; otherwise true exactly when the untaxed residue beats the tolerance", 20000, (R) => ({ row: moneyRow(R), pct: pick(R, [null, 5, 18]) }), ({ row, pct }) => {
  const want = !pct ? false : Math.max(0, r2(r2(row.subtotal - row.discount) - F.taxableValue(row, pct))) > F.exemptTolerance(row.paidOrders); return F.exemptIsMaterial(row, pct) === want; });
await prop("taxableFor picks the taxable value only when the exempt part is material", 20000, (R) => ({ row: moneyRow(R), pct: pick(R, [null, 5, 18]), m: R() < 0.5 }), ({ row, pct, m }) => F.taxableFor(row, pct, m) === (m ? F.taxableValue(row, pct) : F.netSalesOf(row)));

// ═══ lib/paySplit.ts · badSplitShape — the shape rule, against an independent copy of the rule ══════
const legOf = (R) => ({ amount: pick(R, [paise(R, 2000), 0, -5, NaN, "12", "x", undefined]), method: pick(R, ["Cash", "UPI", "Card", "Other", "Pay later", "Bitcoin", "cash", undefined]),
  note: pick(R, [undefined, null, "", "x".repeat(int(R, 0, 210))]), khataCustomerId: pick(R, [undefined, "", "  ", "k1"]), khataName: pick(R, [undefined, "", " ", "Ravi"]) });
const SHAPE = (sp) => { if (!Array.isArray(sp) || sp.length < 2 || sp.length > 12) return "count";
  for (const s of sp) { if (!(Number(s?.amount) > 0)) return "amount"; if (!["UPI", "Cash", "Card", "Other", "Pay later"].includes(String(s?.method))) return "method"; if (s?.note != null && String(s.note).length > 200) return "note";
    if (s?.method === "Pay later" && !String(s?.khataCustomerId || "").trim() && !String(s?.khataName || "").trim()) return "person"; }
  return sp.filter((s) => s.method === "Pay later").length > 1 ? "two-later" : null; };
const KIND = (msg) => msg == null ? null : /at least two/.test(msg) ? "count" : /above zero/.test(msg) ? "amount" : /invalid payment method/.test(msg) ? "method" : /note too long/.test(msg) ? "note" : /needs a person/.test(msg) ? "person" : /Only one part/.test(msg) ? "two-later" : "?" + msg;
await prop("badSplitShape refuses exactly what the written rule refuses, for the same reason, and passes the rest", 50000, (R) => (R() < 0.05 ? pick(R, [null, "x", {}, 5]) : Array.from({ length: int(R, 0, 14) }, () => legOf(R))), (sp) => KIND(PS.badSplitShape(sp)) === SHAPE(sp) || `${KIND(PS.badSplitShape(sp))} vs ${SHAPE(sp)}`);

// ═══ lib/discountCap.ts ══════════════════════════════════════════════════════════════════════════════
await prop("overDiscountCap: over exactly when amount ÷ base is more than the cap + 0.01 percentage points", 50000, (R) => ({ a: paise(R, 5000), b: pick(R, [0, -1, paise(R, 10000)]), c: pick(R, [null, 0, 5, 10, 50, 100, paise(R, 100)]) }), ({ a, b, c }) =>
  DC.overDiscountCap(a, b, c) === (c != null && b > 0 && (a / b) * 100 > c + 0.01));
await prop("overDiscountCap: a discount of exactly the cap is never over it (a 10% cap allows exactly 10%)", 20000, (R) => ({ b: int(R, 1, 100000), c: pick(R, [5, 10, 15, 20, 25, 50]) }), ({ b, c }) => !DC.overDiscountCap(r2((b * c) / 100), b, c));
await prop("overDiscountCap: giving more never turns an over-cap discount back into an allowed one", 20000, (R) => ({ a: paise(R, 5000), more: paise(R, 500), b: int(R, 1, 10000), c: pick(R, [5, 10, 50]) }), ({ a, more, b, c }) => !DC.overDiscountCap(a, b, c) || DC.overDiscountCap(a + more, b, c));
t("discountRole: no role (the admin) and the owner are uncapped; manager is manager; every other role is waiter", DC.discountRole(null) === null && DC.discountRole("") === null && DC.discountRole("owner") === null && DC.discountRole("manager") === "manager" && ["waiter", "tablet", "kitchen", "x"].every((r) => DC.discountRole(r) === "waiter"));

// ═══ lib/clashCompare.ts · the "first save wins" comparison ══════════════════════════════════════════
const valOf = (R, d = 0) => pick(R, [() => null, () => undefined, () => int(R, 0, 9), () => String(int(R, 0, 9)), () => pick(R, ["a", " a ", "A", "b", "a,b", 'x,"k":1', ""]), () => R() < 0.5,
  () => (d > 3 ? "z" : Array.from({ length: int(R, 0, 3) }, () => valOf(R, d + 1))), () => (d > 3 ? "z" : Object.fromEntries(Array.from({ length: int(R, 0, 3) }, () => [pick(R, ["k", "j", "a b", "1"]), valOf(R, d + 1)])))])();
await prop("sameValue: every value is the same as itself", 30000, (R) => valOf(R), (v) => CC.sameValue(v, v));
await prop("sameValue: asking a-vs-b and b-vs-a always gives the same answer", 30000, (R) => [valOf(R), valOf(R)], ([a, b]) => CC.sameValue(a, b) === CC.sameValue(b, a));
await prop("sameValue: a list in another order is the same list (an allergen list is a set)", 20000, (R) => ({ xs: Array.from({ length: int(R, 0, 6) }, () => pick(R, ["nuts", "dairy", "egg", "Gluten", " soy "])), seed: int(R, 1, 1e9) }), ({ xs, seed }) => CC.sameValue(xs, shuffle(gen(seed), xs)));
await prop("sameValue: an object with its keys in another order is the same object", 20000, (R) => ({ o: Object.fromEntries(Array.from({ length: int(R, 1, 6) }, (_, i) => [`k${i}`, valOf(R)])), seed: int(R, 1, 1e9) }), ({ o, seed }) => CC.sameValue(o, Object.fromEntries(shuffle(gen(seed), Object.entries(o)))));
await prop("sameValue: changing ONE text value anywhere inside an object is always seen as a change", 20000, (R) => ({ o: Object.fromEntries(Array.from({ length: int(R, 1, 5) }, (_, i) => [`k${i}`, pick(R, ["Patio", "Bar", "Snug", "Window"])])), k: int(R, 0, 4) }), ({ o, k }) => {
  const key = Object.keys(o)[k % Object.keys(o).length]; return !CC.sameValue(o, { ...o, [key]: o[key] + "!" }); });
// THE RULE, written independently: a missing value, null and a blank are one "nothing"; text is trimmed;
// a number equals its text; object keys are unordered; a list INSIDE an object keeps its order.
// stableJson must give the same text exactly when this says the two are the same — no more, no less.
const norm = (v) => (v === null || v === undefined ? "" : Array.isArray(v) ? v.map(norm) : typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])])) : String(v).trim());
await prop("stableJson: two values give the same text EXACTLY when the written rule calls them the same — no two different values collide", 50000, (R) => [valOf(R), valOf(R)], ([a, b]) =>
  (CC.stableJson(a) === CC.stableJson(b)) === (JSON.stringify(norm(a)) === JSON.stringify(norm(b))) || `${CC.stableJson(a)} / ${CC.stableJson(b)}`);
await prop("stableJson: commas and quotes inside a value are never read as structure (['a,b'] is not ['a','b'])", 20000, (R) => pick(R, ["a,b", 'x,"k":1', "[1]", "{}", '"', ",", "a\\b"]), (v) =>
  CC.stableJson([v]) !== CC.stableJson(v.split(",")) || v.split(",").length === 1);
await prop("isPlainObject is true for objects only — never null, a list, text or a number", 20000, (R) => valOf(R), (v) => CC.isPlainObject(v) === (!!v && typeof v === "object" && !Array.isArray(v)));

// ═══ lib/idempotencyRule.ts · what a repeated request may hand back ═════════════════════════════════
const SECRETS = ["password", "passcode", "pass", "secret", "token", "access_token", "pin", "staff_pin", "pins", "otp", "otp_code", "api_key", "apikey", "setup_code", "private_key", "PASSWORD", "clientSecret"];
const SAFE = ["name", "total", "pinned", "opinion", "spinach", "passenger", "bypassed_never", "id", "kot_no", "shipping", "otpsent", "topping"];
const bodyOf = (R, d = 0) => Object.fromEntries(Array.from({ length: int(R, 0, 5) }, () => { const k = R() < 0.3 ? pick(R, SECRETS) : pick(R, SAFE); return [k, d < 4 && R() < 0.3 ? (R() < 0.5 ? bodyOf(R, d + 1) : [bodyOf(R, d + 1)]) : int(R, 0, 99)]; }));
const keysDeep = (v, out = []) => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (!Array.isArray(v)) out.push(k); keysDeep(x, out); } return out; };
await prop("withoutSecrets: no password, PIN, token, OTP, key or setup code survives, at any depth", 30000, (R) => bodyOf(R), (b) => keysDeep(IR.withoutSecrets(b)).every((k) => !SECRETS.includes(k)) || keysDeep(IR.withoutSecrets(b)).find((k) => SECRETS.includes(k)));
// (an ordinary key INSIDE a secret one goes with it — the whole secret branch is dropped — so only the
// ordinary keys with no secret above them are owed back)
const keysOpen = (v, out = []) => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (!Array.isArray(v)) { if (SECRETS.includes(k)) continue; out.push(k); } keysOpen(x, out); } return out; };
await prop("withoutSecrets: every ordinary key survives — 'pinned', 'spinach', 'topping' and 'passenger' are not secrets", 30000, (R) => bodyOf(R), (b) => {
  return JSON.stringify(keysOpen(IR.withoutSecrets(b))) === JSON.stringify(keysOpen(b)) || "dropped an ordinary key"; });
await prop("withoutSecrets: a list keeps its length; text and numbers are returned untouched", 20000, (R) => [bodyOf(R), pick(R, [5, "x", null, true])], ([b, v]) => IR.withoutSecrets([b, b]).length === 2 && IR.withoutSecrets(v) === v);
await prop("a kept reply hands back the same answer to the SAME caller, and nothing to anyone else", 20000, (R) => ({ b: bodyOf(R), by: pick(R, ["dev-a", "dev-b"]) }), ({ b, by }) => {
  const kept = IR.keptReply(b, by); return JSON.stringify(IR.replyFor(kept, by)) === JSON.stringify(IR.withoutSecrets(b)) && JSON.stringify(IR.replyFor(kept, by === "dev-a" ? "dev-b" : "dev-a")) === "{}"; });
await prop("didSomething: a 4xx/5xx or an {ok:false} body did nothing; anything else did", 20000, (R) => ({ s: pick(R, [200, 201, 204, 302, 400, 401, 404, 409, 429, 500, 503]), b: pick(R, [null, {}, { ok: true }, { ok: false }, "x", [], { ok: "false" }]) }), ({ s, b }) =>
  IR.didSomething(s, b) === (s < 400 && !(b && typeof b === "object" && b.ok === false)));
await prop("storedIsRefusal is true exactly for a stored {ok:false}", 10000, (R) => pick(R, [null, undefined, {}, { ok: false }, { ok: true }, { ok: 0 }, "no", []]), (v) => IR.storedIsRefusal(v) === (!!v && typeof v === "object" && v.ok === false));

// ═══ lib/dbRefusal.ts · how a database answer becomes a sentence and a status ═══════════════════════
const CODES = ["23505", "23514", "23503", "23502", "22P02", "22001", "22003", "22007", "23P01", "LFH01", "LFH02", "LFH03", "LFH04", "57014", "08006", "08001", "53300", "40001", "40P01", "57P01", "55P03", "PGRST116", "42501", "42P01", "XX000", "", undefined];
const MSGS = ["boom", "canceling statement due to statement timeout", "fetch failed", "TypeError: fetch failed", 'duplicate key value violates unique constraint "x"', 'new row violates check constraint "settings_tax_rate_is_a_rate"', "invalid input syntax for type uuid", "value too long for type character varying(20)", "socket hang up", "502: Bad gateway", "permission denied for table orders", ""];
const errOf = (R) => ({ code: pick(R, CODES), message: pick(R, MSGS), details: pick(R, [undefined, "The result contains 0 rows", "Results contain 2 rows", "x"]), hint: pick(R, [undefined, "h"]) });
await prop("refusalStatus only ever answers 409, 404, 400, 503 or the fallback", 50000, errOf, (e) => [409, 404, 400, 503, 418].includes(DB.refusalStatus(e, 418)));
await prop("an answer is never BOTH 'the value was refused' and 'the database didn't answer'", 50000, errOf, (e) => !(DB.isDataRefusal(e) && DB.isDbUnreachable(e)));
await prop("the database didn't answer → the busy sentence, status 503 (unless it is one of our own codes or a missing row)", 50000, errOf, (e) => !DB.isDbUnreachable(e) || (DB.refusalMessage(e) === DB.BUSY_MESSAGE && DB.refusalStatus(e) === 503));
await prop("a refused value never shows its raw database wording ('violates … constraint', 'invalid input syntax')", 50000, errOf, (e) => !DB.isDataRefusal(e) || DB.isMissingRow(e) || !/violates|invalid input syntax|value too long/i.test(DB.refusalMessage(e)) || DB.refusalMessage(e));
await prop("every refusal gets a sentence — never an empty string", 50000, errOf, (e) => !(DB.isDataRefusal(e) || DB.isDbUnreachable(e) || DB.ownRefusalCode(e)) || DB.refusalMessage(e).length > 10);
await prop("pgError keeps the code, message, details and hint — so wrapping an answer never changes its status or sentence", 50000, errOf, (e) => {
  const w = DB.pgError(e); return w instanceof Error && DB.refusalStatus(w) === DB.refusalStatus(e) && DB.refusalMessage(w) === DB.refusalMessage(e) || `${DB.refusalStatus(w)} vs ${DB.refusalStatus(e)}`; });
await prop("our own codes (LFH01–04) always answer 409 with their own sentence", 20000, (R) => ({ code: pick(R, ["LFH01", "LFH02", "LFH03", "LFH04"]), message: pick(R, MSGS) }), (e) => DB.refusalStatus(e) === 409 && DB.ownRefusalCode(e) === e.code);
await prop("a missing row is 404 and is never written to the error log", 20000, (R) => ({ code: "PGRST116", details: pick(R, ["The result contains 0 rows", "Results contain 0 rows"]), message: pick(R, MSGS) }), (e) => DB.isMissingRow(e) && DB.refusalStatus(e) === 404 && DB.worthLogging(e) === false);
await prop("'2 rows where 1 was expected' is NOT a missing row (it is a real fault, and it is logged)", 10000, (R) => ({ code: "PGRST116", details: pick(R, ["Results contain 2 rows", "The result contains 5 rows"]), message: "JSON object requested, multiple (or no) rows returned" }), (e) => !DB.isMissingRow(e) && DB.worthLogging(e));

// ═══ lib/readGuard.ts · a read that failed can never pass for an empty one ══════════════════════════
const readsOf = (R) => Array.from({ length: int(R, 0, 8) }, (_, i) => ({ name: `r${i}`, data: R() < 0.5 ? [{ id: i }] : null, error: R() < 0.35 ? { message: "x", code: "57014" } : null, count: R() < 0.5 ? int(R, 0, 9) : null, ms: int(R, 0, 900), retried: false }));
const quietSet = (reads) => { const e = console.error; console.error = () => {}; try { return new RG.ReadSet("p", reads); } finally { console.error = e; } };
await prop("ReadSet: anyFailed / allFailed / failedNames agree with the reads, in order", 30000, readsOf, (rs) => {
  const s = quietSet(rs); return s.anyFailed === rs.some((r) => r.error) && s.allFailed === (rs.length > 0 && rs.every((r) => r.error)) && s.failedNames.join() === rs.filter((r) => r.error).map((r) => r.name).join(); });
await prop("ReadSet: rows(), one(), value() and count() THROW on a failed read and never hand back an empty list", 30000, readsOf, (rs) => {
  const s = quietSet(rs); return rs.every((r) => { const th = (f) => { try { f(); return false; } catch (e) { return e instanceof RG.ReadFailed; } }; return !r.error || (th(() => s.rows(r.name)) && th(() => s.one(r.name)) && th(() => s.value(r.name)) && th(() => s.count(r.name))); }); });
await prop("ReadSet: rowsOr() gives the fallback exactly when the read failed (or was never made)", 30000, readsOf, (rs) => { const s = quietSet(rs); const fb = ["fb"]; return rs.every((r) => (s.rowsOr(r.name, fb) === fb) === !!r.error) && s.rowsOr("nope", fb) === fb; });
await prop("ReadSet: partial() lists each failed screen-part once, and only failed ones", 30000, (R) => ({ rs: readsOf(R), map: null }), ({ rs }) => {
  const s = quietSet(rs); const map = Object.fromEntries(rs.map((r, i) => [r.name, i % 2 ? "orders" : "sales"])); const want = [...new Set(rs.filter((r) => r.error).map((r) => map[r.name]))]; return JSON.stringify(s.partial(map)) === JSON.stringify(want); });
await prop("ReadSet: slowerThan(ms) names exactly the reads slower than ms", 20000, (R) => ({ rs: readsOf(R), ms: int(R, 0, 900) }), ({ rs, ms }) => quietSet(rs).slowerThan(ms).map((x) => x.name).join() === rs.filter((r) => r.ms > ms).map((r) => r.name).join());
await prop("named(): keeps data, error and a numeric count; anything else becomes null", 20000, (R) => ({ data: pick(R, [null, undefined, [1]]), error: pick(R, [null, undefined, { m: 1 }]), count: pick(R, [null, undefined, 3, "3"]) }), (r) => {
  const n = RG.named("x", r); return n.data === (r.data ?? null) && n.error === (r.error ?? null) && n.count === (typeof r.count === "number" ? r.count : null); });

// ═══ lib/money.ts and lib/money.mjs · the money a chart or a converter prints ═══════════════════════
const parseInr = (s) => { const m = /^(−?)₹(\d+(?:\.\d)?)(k|L|Cr)?$/.exec(s); if (!m) return NaN; return (m[1] ? -1 : 1) * Number(m[2]) * ({ k: 1e3, L: 1e5, Cr: 1e7 }[m[3]] || 1); };
const bigOf = (R) => (R() < 0.5 ? -1 : 1) * pick(R, [int(R, 0, 999), int(R, 999, 1001), int(R, 1000, 99999), int(R, 99940, 100060), int(R, 100000, 9999999), int(R, 9994000, 10006000), int(R, 1e7, 1e10)]) + (R() < 0.3 ? R() : 0);
await prop("compactINR always prints '₹N', '₹Nk', '₹NL' or '₹NCr' (one decimal at most, a real minus sign)", 50000, bigOf, (v) => !Number.isNaN(parseInr(M.compactINR(v))) || M.compactINR(v));
await prop("compactINR never prints a 3-digit k or L — ₹100k is ₹1L and ₹100L is ₹1Cr", 50000, bigOf, (v) => { const m = /(\d+(?:\.\d)?)(k|L)$/.exec(M.compactINR(v)); return !m || Number(m[1]) < 100 || M.compactINR(v); });
await prop("compactINR is within 5% of the real amount once it is ₹1,000 or more", 50000, bigOf, (v) => Math.abs(v) < 1000 || Math.abs(parseInr(M.compactINR(v)) - v) <= Math.abs(v) * 0.05 || M.compactINR(v));
await prop("compactINR keeps the sign, and a bigger amount never prints smaller", 50000, (R) => [bigOf(R), bigOf(R)], ([a, b]) => {
  const [lo, hi] = a <= b ? [a, b] : [b, a]; return Math.sign(parseInr(M.compactINR(a))) * Math.sign(Math.round(a) || 0) >= 0 && parseInr(M.compactINR(lo)) <= parseInr(M.compactINR(hi)); });
await prop("roundTicks: the ticks sit inside the range, evenly spaced on a 1/2/2.5/5 step, at least two of them", 30000, (R) => { const a = (R() - 0.5) * pick(R, [10, 1e3, 1e6]); return [a, a + R() * pick(R, [1, 100, 1e5]) + 1e-3, int(R, 2, 10)]; }, ([lo, hi, n]) => {
  const tk = M.roundTicks(lo, hi, n); if (!tk.length) return true; const st = tk[1] - tk[0]; const mag = Math.pow(10, Math.floor(Math.log10(st))); const m = Math.round((st / mag) * 1000) / 1000;
  return tk.length >= 2 && tk[0] >= lo - st * 1e-6 && tk[tk.length - 1] <= hi + st * 1e-6 && tk.every((x, i) => i === 0 || Math.abs(x - tk[i - 1] - st) <= st * 1e-6) && [1, 2, 2.5, 5, 10].includes(m) || JSON.stringify(tk).slice(0, 60); });
await prop("roundTicks: an empty, reversed or non-finite range gives no ticks", 10000, (R) => pick(R, [[5, 5], [9, 1], [NaN, 1], [0, Infinity], [-Infinity, 0]]), ([a, b]) => M.roundTicks(a, b).length === 0);
await prop("snapToStep lands on a multiple of the step, at most half a step from the value", 50000, (R) => [(R() - 0.5) * 1e5, pick(R, [0.01, 0.05, 0.5, 1, 5, 10, 100])], ([v, s]) => {
  const x = MJ.snapToStep(v, s); return Math.abs(x / s - Math.round(x / s)) < 1e-6 && Math.abs(x - v) <= s / 2 + 1e-6; });
await prop("snapToStep with no usable step (0, negative, NaN) gives 0", 5000, (R) => [R() * 100, pick(R, [0, -1, NaN, Infinity])], ([v, s]) => MJ.snapToStep(v, s) === 0);
await prop("niceUsd ends in .00, .50 or .99 and is never more than one dollar from the input", 30000, (R) => R() * 500, (v) => { const x = MJ.niceUsd(v); const c = Math.round((x - Math.floor(x)) * 100); return [0, 50, 99].includes(c) && Math.abs(x - v) < 1; });
await prop("displayAmount = the converted amount snapped to the step; minorRound = snapToStep", 30000, (R) => [R() * 500, pick(R, [83.2, 1, 0.92]), pick(R, [1, 0.01, 5])], ([u, rate, st]) => MJ.displayAmount(u, rate, st) === MJ.snapToStep(u * rate, st) && MJ.minorRound(u, st) === MJ.snapToStep(u, st));

// ═══ appended in round 3 after coverage: item 26's fallback, exactly ═══════════════════════════════
t("splitTax item 26: rates 6/6/9/3 on ₹0.02 → 0.01 + 0 + 0.01 + 0 (largest remainder), never a −0.01 line", JSON.stringify(F.splitTax([6, 6, 9, 3], 0.02)) === "[0.01,0,0.01,0]", JSON.stringify(F.splitTax([6, 6, 9, 3], 0.02)));
t("splitTax item 26: a nonsense rate inside such a split counts as 0% and the parts still add up, none negative", (() => { const p = F.splitTax([6, 6, "x", 9, 3], 0.02); return P(p.reduce((a, x) => a + x, 0)) === 2 && p.every((x) => x >= 0) && p[2] === 0; })(), JSON.stringify(F.splitTax([6, 6, "x", 9, 3], 0.02)));
t("splitTax item 26: every split that was already right is unchanged — CGST/SGST on every paisa from ₹0 to ₹3,000 at 2.5/2.5 and 9/9 matches the old rule", (() => {
  const old = (rates, target) => { const sum = rates.reduce((a, r) => a + r, 0); let run = 0; return rates.map((r, i) => { const amt = i === rates.length - 1 ? r2(target - run) : r2(target * (r / sum)); run = r2(run + amt); return amt; }); };
  for (const rates of [[2.5, 2.5], [9, 9], [6, 6], [2.5, 2.5, 1]]) for (let p = 0; p <= 300000; p++) if (F.splitTax(rates, p / 100).join() !== old(rates, p / 100).join() && old(rates, p / 100).every((x) => x >= 0)) return false; return true; })());
await prop("splitTax: a negative target (a refund) never gets a line pointing the other way, and still adds up exactly", 30000, (R) => ({ rates: ratesOf(R), target: -pick(R, [int(R, 1, 5) / 100, paise(R, 3), int(R, 1, 50000)]) }), ({ rates, target }) => {
  const p = F.splitTax(rates, target); return (p.every((x) => x <= 0) && eqp(p.reduce((a, x) => a + x, 0), target)) || JSON.stringify(p); });
