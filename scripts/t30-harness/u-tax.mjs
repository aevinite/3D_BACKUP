// lib/tax.ts — every function and branch, run for real.
import { suite } from "./lib.mjs";
const t = suite("lib/tax.ts", 168001, 80);
const T = await import("@/lib/tax.ts");
const r2 = (n) => Math.round(n * 100) / 100;
// effectiveTaxRate / components
t("effectiveTaxRate(null) is the 5% default", T.effectiveTaxRate(null) === 0.05);
t("effectiveTaxRate({}) is the 5% default", T.effectiveTaxRate({}) === 0.05);
t("tax_components that is not a list falls through to tax_rate", T.effectiveTaxRate({ tax_components: { a: 1 }, tax_rate: 0.12 }) === 0.12);
t("a null entry inside tax_components is skipped, not a crash", T.effectiveTaxRate({ tax_components: [null, { label: "GST", rate: 5 }] }) === 0.05);
t("an entry with no label is skipped", T.effectiveTaxRate({ tax_components: [{ rate: 9 }], tax_rate: 0.12 }) === 0.12);
t("an entry with a non-numeric rate is skipped", T.effectiveTaxRate({ tax_components: [{ label: "GST", rate: "abc" }], tax_rate: 0.12 }) === 0.12);
t("an entry with a negative rate is skipped", T.effectiveTaxRate({ tax_components: [{ label: "GST", rate: -5 }] }) === 0.05);
t("CGST 2.5 + SGST 2.5 = 0.05", T.effectiveTaxRate({ tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }] }) === 0.05);
t("IGST 18 alone = 0.18 (components beat tax_rate)", T.effectiveTaxRate({ tax_components: [{ label: "IGST", rate: 18 }], tax_rate: 0.05 }) === 0.18);
t("tax_rate 0 falls back to 5% (the NULLIF(tax_rate,0) rule the SQL uses)", T.effectiveTaxRate({ tax_rate: 0 }) === 0.05);
t("tax_rate '0.12' (a string) reads as 0.12", T.effectiveTaxRate({ tax_rate: "0.12" }) === 0.12);
t("tax_rate 'junk' falls back to 5%", T.effectiveTaxRate({ tax_rate: "junk" }) === 0.05);
t("composition → exactly 0, whatever else is set", T.effectiveTaxRate({ price_tax_mode: "composition", tax_rate: 0.18, tax_components: [{ label: "GST", rate: 5 }] }) === 0);
t("taxComponents returns only the real named lines, rates as percents", JSON.stringify(T.taxComponents({ tax_components: [{ label: " CGST ", rate: "2.5" }, { label: "", rate: 9 }] })) === '[{"label":"CGST","rate":2.5}]');
t("taxComponents(null) is []", T.taxComponents(null).length === 0);
t("effectiveTaxPct: 0.05 → 5, 0.0825 → 8.25, composition → 0", T.effectiveTaxPct({ tax_rate: 0.05 }) === 5 && T.effectiveTaxPct({ tax_rate: 0.0825 }) === 8.25 && T.effectiveTaxPct({ price_tax_mode: "composition" }) === 0);
// modes
t("priceTaxMode: absent → excl", T.priceTaxMode(null) === "excl" && T.priceTaxMode({}) === "excl");
t("priceTaxMode: 'incl' and 'composition' pass through, anything else → excl", T.priceTaxMode({ price_tax_mode: "incl" }) === "incl" && T.priceTaxMode({ price_tax_mode: "composition" }) === "composition" && T.priceTaxMode({ price_tax_mode: "mrp" }) === "excl");
t("itemTaxModesAllowed is true only for the boolean true", T.itemTaxModesAllowed({ item_tax_modes_allowed: true }) && !T.itemTaxModesAllowed({ item_tax_modes_allowed: "true" }) && !T.itemTaxModesAllowed(null));
const ON = (o = {}) => ({ item_tax_modes_allowed: true, ...o });
t("resolveTaxMode: composition → exempt for every dish mode", ["default", "excl", "incl", "mrp", "none", undefined].every((m) => T.resolveTaxMode(m, { price_tax_mode: "composition", item_tax_modes_allowed: true }) === "exempt"));
t("resolveTaxMode: overrides OFF → the restaurant's mode (excl)", ["incl", "none", "mrp"].every((m) => T.resolveTaxMode(m, {}) === "excl"));
t("resolveTaxMode: overrides OFF at an 'incl' restaurant → incl", T.resolveTaxMode("none", { price_tax_mode: "incl" }) === "incl");
t("resolveTaxMode: overrides ON, dish 'excl' → excl, 'incl' → incl", T.resolveTaxMode("excl", ON({ price_tax_mode: "incl" })) === "excl" && T.resolveTaxMode("incl", ON()) === "incl");
t("resolveTaxMode: overrides ON, dish 'none' → exempt", T.resolveTaxMode("none", ON()) === "exempt");
t("resolveTaxMode: overrides ON, dish 'mrp' with treatment 'inclusive' → incl", T.resolveTaxMode("mrp", ON({ mrp_tax_treatment: "inclusive" })) === "incl");
t("resolveTaxMode: overrides ON, dish 'mrp' with any other treatment → exempt", T.resolveTaxMode("mrp", ON({ mrp_tax_treatment: "none" })) === "exempt" && T.resolveTaxMode("mrp", ON()) === "exempt");
t("resolveTaxMode: overrides ON, dish 'default' / unknown / missing → the restaurant's", T.resolveTaxMode("default", ON({ price_tax_mode: "incl" })) === "incl" && T.resolveTaxMode("weird", ON()) === "excl" && T.resolveTaxMode(undefined, ON()) === "excl");
t("isMrpDish: only 'mrp' with overrides on", T.isMrpDish("mrp", ON()) && !T.isMrpDish("mrp", {}) && !T.isMrpDish(null, ON()) && !T.isMrpDish("none", ON()));
t("TAX_SETTINGS_COLUMNS names the three columns effectiveTaxRate reads", T.TAX_SETTINGS_COLUMNS === "tax_rate, tax_components, price_tax_mode");
// splitBill
const S5 = { tax_rate: 0.05 }, S0 = { price_tax_mode: "composition" };
{ const b = T.splitBill([{ price: "100", qty: 2 }], S5); t("splitBill: 2 × ₹100 at 5% → base 200, tax 10, total 210", b.taxableBase === 200 && b.tax === 10 && b.total === 210 && b.subtotal === 200); }
t("splitBill: a missing price counts 0", T.splitBill([{ qty: 3 }], S5).total === 0);
t("splitBill: a null line is skipped (no crash)", T.splitBill([null, { price: "10" }], S5).taxableBase === 10);
t("splitBill: price '₹1,250.50' → 1250.5", T.splitBill([{ price: "₹1,250.50" }], S5).taxableBase === 1250.5);
t("splitBill: price as a number works", T.splitBill([{ price: 80 }], S5).taxableBase === 80);
t("splitBill: qty missing → 1", T.splitBill([{ price: "10" }], S0).subtotal === 10);
t("splitBill: qty 0 / -2 / 'abc' → 1 (a line on a bill always counts once)", [0, -2, "abc"].every((q) => T.splitBill([{ price: "10", qty: q }], S0).subtotal === 10));
t("splitBill: qty '3' multiplies", T.splitBill([{ price: "10", qty: "3" }], S0).subtotal === 30);
t("splitBill: each line is rounded to the paisa before it is added (₹0.333 × 3 = ₹1.00)", T.splitBill([{ price: "0.333", qty: 3 }], S0).subtotal === 1);
t("splitBill: an 'incl' line is divided by (1 + rate) and rounded (₹105 at 5% → base ₹100)", T.splitBill([{ price: "105", tax_mode: "incl" }], S5).taxableBase === 100);
t("splitBill: an 'exempt' line goes to nontaxAmount only", (() => { const b = T.splitBill([{ price: "40", tax_mode: "exempt" }], S5); return b.nontaxAmount === 40 && b.taxableBase === 0 && b.tax === 0 && b.total === 40; })());
t("splitBill: an unknown tax_mode is treated as excl", T.splitBill([{ price: "100", tax_mode: "weird" }], S5).tax === 5);
t("splitBill: is_mrp adds to mrpAmount AND hasMrp, on top of its mode bucket", (() => { const b = T.splitBill([{ price: "50", tax_mode: "exempt", is_mrp: true }], S5); return b.mrpAmount === 50 && b.hasMrp && b.nontaxAmount === 50; })());
t("splitBill: no MRP line → hasMrp false, mrpAmount 0", (() => { const b = T.splitBill([{ price: "50" }], S5); return !b.hasMrp && b.mrpAmount === 0; })());
t("splitBill: at a taxed restaurant the discount ceiling is the TAXABLE base", T.splitBill([{ price: "100" }, { price: "50", tax_mode: "exempt" }], S5).discountBase === 100);
t("splitBill: at a zero rate the ceiling is everything but the MRP lines", T.splitBill([{ price: "100", tax_mode: "exempt" }, { price: "50", tax_mode: "exempt", is_mrp: true }], S0).discountBase === 100);
t("splitBill: at a zero rate an all-MRP bill can take no discount (ceiling never below 0)", T.splitBill([{ price: "50", tax_mode: "exempt", is_mrp: true }], S0).discountBase === 0);
t("splitBill: a discount above the ceiling is clamped to it", T.splitBill([{ price: "100" }], S5, 500).discount === 100);
t("splitBill: a negative discount is clamped to 0", T.splitBill([{ price: "100" }], S5, -10).discount === 0);
t("splitBill: a non-numeric discount counts as 0", T.splitBill([{ price: "100" }], S5, "lots").discount === 0);
t("splitBill: the discount comes off BEFORE tax (₹100 − ₹20 → tax ₹4, total ₹84)", (() => { const b = T.splitBill([{ price: "100" }], S5, 20); return b.taxable === 80 && b.tax === 4 && b.total === 84; })());
t("splitBill: at a zero rate taxable stays the base and the discount comes off the total", (() => { const b = T.splitBill([{ price: "100", tax_mode: "exempt" }], S0, 30); return b.taxable === 0 && b.total === 70 && b.tax === 0; })());
t("splitBill: composition is reported true only for a composition restaurant", T.splitBill([], S0).composition === true && T.splitBill([], S5).composition === false);
t("splitBill(undefined lines) is all zeros", (() => { const b = T.splitBill(undefined, S5); return b.total === 0 && b.subtotal === 0 && b.discountBase === 0; })());
t("splitBill: the rate it reports is effectiveTaxRate's", T.splitBill([], { tax_components: [{ label: "IGST", rate: 18 }] }).rate === 0.18);
{ let ok = true, bad = ""; let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 5000 && ok; i++) { const lines = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => ({ price: String(Math.round(rnd() * 99999) / 100), qty: 1 + Math.floor(rnd() * 5), tax_mode: ["excl", "incl", "exempt"][Math.floor(rnd() * 3)], is_mrp: rnd() < 0.15 }));
    const s = [S5, { tax_rate: 0.18 }, S0][Math.floor(rnd() * 3)]; const b = T.splitBill(lines, s, Math.round(rnd() * 50000) / 100);
    if (Math.abs(r2(b.subtotal - b.discount + b.tax) - b.total) > 0.011 || b.discount > b.discountBase + 1e-9 || b.subtotal !== r2(b.taxableBase + b.nontaxAmount)) { ok = false; bad = JSON.stringify(b); } }
  t("splitBill on 5,000 random bills: subtotal − discount + tax = total, discount ≤ ceiling, subtotal = base + untaxed", ok, bad); }
