// Round 4 (owner, 2026-10-10: "do all the things you have listed") — items 10–16, checked from the real
// files with the in-memory database. APPEND ONLY; ids are permanent.
import { suite } from "./lib.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { root } from "./hooks.mjs";
const t = suite("round 4 (items 10–16)", 166001, 200);
const src = (p) => readFileSync(join(root, p), "utf8");
const DB = await import("@/lib/dbRefusal.ts");
const PAY = await import("@/lib/payments.ts");
const TT = await import("@/lib/tableTags.ts");

// ── item 11: a bill is paid by a method the app knows ──
{ const mig = existsSync(join(root, "supabase/migrations/417_a_bill_is_paid_by_a_method_the_app_knows.sql")) ? src("supabase/migrations/417_a_bill_is_paid_by_a_method_the_app_knows.sql") : "";
  const lists = [...mig.matchAll(/payment_method (?:NOT )?IN \(([^)]*)\)/g)].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort().join("|"));
  const app = [...PAY.PAYMENT_METHODS, "Split", TT.ON_THE_HOUSE_METHOD].sort().join("|");
  t("item 11: migration 417 adds orders_payment_method_is_known, NOT VALID first, validated only when no row breaks it", /ADD CONSTRAINT orders_payment_method_is_known/.test(mig) && /NOT VALID;/.test(mig) && /IF NOT EXISTS \(\s*SELECT 1 FROM public\.orders[\s\S]*?VALIDATE CONSTRAINT orders_payment_method_is_known/.test(mig));
  t("item 11: …its list is EXACTLY the app's — PAYMENT_METHODS + 'Split' (Pay in parts) + ON_THE_HOUSE_METHOD — in both places it is written", lists.length === 2 && lists.every((l) => l === app), `${lists.join(" / ")} vs ${app}`);
  t("item 11: …and it rewrites no data (no UPDATE or DELETE outside comments)", !/\b(UPDATE|DELETE)\b/i.test(mig.replace(/--.*$/gm, "")));
  t("item 11: a refused method reads as a sentence that says what to pick", /pick UPI, cash, card or other/.test(DB.refusalMessage({ code: "23514", message: 'new row for relation "orders" violates check constraint "orders_payment_method_is_known"' })));
  t("item 11: the Pay in parts and on-the-house spellings the app writes are the ones the rule allows", /payment_method: "Split"/.test(src("lib/paySplit.ts")) && TT.ON_THE_HOUSE_METHOD === "On the house"); }

// ── item 10: the panels' own copies of the bill rule, lifted out and RUN against lib/tax.ts ──
const T = await import("@/lib/tax.ts");
const BILLDOC = (await import("@/public/panels/billdoc.js")).default;
const fnSrc = (text, name) => { const at = text.search(new RegExp(`^(?:async )?function ${name}\\(`, "m")); if (at < 0) throw new Error(`${name} not found`); const end = text.indexOf("\n}\n", at); return text.slice(at, end + 2); };
const lineOf = (text, re) => (text.match(re) || [""])[0];
const ED = src("public/panels/editor/app.js"), TB = src("public/panels/tablet/app.js");
const edMR = lineOf(ED, /^const moneyRound = .*$/m), tbMR = lineOf(TB, /^const moneyRound = .*$/m);
const EDF = new Function("LFH_BILLDOC", "state", [edMR, ...["taxModel", "priceTaxMode", "itemTaxModesAllowed", "resolveTaxMode", "isMrpDish", "splitCartLines"].map((n) => fnSrc(ED, n))].join("\n") + "\nreturn { taxModel, priceTaxMode, resolveTaxMode, isMrpDish, splitCartLines, moneyRound };");
const TBF = new Function("LFH_BILLDOC", "state", [tbMR, lineOf(TB, /^const preTax = .*$/m), ...["effRate", "orderTaxSplit"].map((n) => fnSrc(TB, n))].join("\n") + "\nreturn { effRate, orderTaxSplit, moneyRound };");
const gen = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const int = (R, a, b) => a + Math.floor(R() * (b - a + 1)); const pick = (R, xs) => xs[Math.floor(R() * xs.length)];
const COMPS = [[], [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }], [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }], [{ label: "IGST", rate: 28 }], [{ label: "VAT", rate: 12.5 }]];
const setOf = (R) => ({ tax_rate: pick(R, [null, 0.05, 0.12, 0.18, 0.28]), tax_components: pick(R, COMPS), price_tax_mode: pick(R, ["excl", "incl", "composition", "excl"]), item_tax_modes_allowed: R() < 0.5, mrp_tax_treatment: pick(R, ["inclusive", "none"]) });
const dishLine = (R) => ({ price: pick(R, [() => int(R, 1, 200000) / 100, () => String(int(R, 1, 2000)), () => "₹" + (int(R, 1, 200000) / 100).toFixed(2)])(), qty: int(R, 1, 5), tax_mode: pick(R, ["default", "excl", "incl", "mrp", "none", null]) });
let SEED = 4001;
const prop = (what, n, make, ok) => { const R = gen(SEED++); let bad = null; for (let i = 0; i < n && !bad; i++) { const x = make(R); let r; try { r = ok(x); } catch (e) { r = "threw: " + e.message; } if (r !== true) bad = { x, r }; }
  t(`${what} — ${n.toLocaleString("en-IN")} random cases`, !bad, bad ? `counter-example ${JSON.stringify(bad.x).slice(0, 140)} → ${String(bad.r).slice(0, 60)}` : ""); };
{ const E = EDF(BILLDOC, { data: { settings: {} } });
  t("item 10: the manager panel's bill rules can be lifted out and run (taxModel, resolveTaxMode, isMrpDish, splitCartLines, moneyRound)", typeof E.splitCartLines === "function" && E.moneyRound(0.7 * 0.05) === 0.04);
  prop("item 10: the manager's quick-order cart split (splitCartLines) = lib/tax.ts splitBill on the same dishes — taxable, untaxed and MRP, to the paisa", 20000, (R) => ({ s: setOf(R), lines: Array.from({ length: int(R, 0, 8) }, () => dishLine(R)) }), ({ s, lines }) => {
    const p = E.splitCartLines(lines, s); const b = T.splitBill(lines.map((l) => ({ ...l, tax_mode: T.resolveTaxMode(l.tax_mode, s), is_mrp: T.isMrpDish(l.tax_mode, s) })), s, 0);
    return (p.taxableBase === b.taxableBase && p.nontax === b.nontaxAmount && p.mrpAmount === b.mrpAmount) || `panel ${p.taxableBase}/${p.nontax}/${p.mrpAmount} vs lib ${b.taxableBase}/${b.nontaxAmount}/${b.mrpAmount}`; });
  prop("item 10: the manager panel's resolveTaxMode and isMrpDish = lib/tax.ts's, for every dish mode and set-up", 20000, (R) => ({ s: setOf(R), m: pick(R, ["default", "excl", "incl", "mrp", "none", null, "x"]) }), ({ s, m }) => (E.resolveTaxMode(m, s) === T.resolveTaxMode(m, s) && E.isMrpDish(m, s) === T.isMrpDish(m, s)) || `${E.resolveTaxMode(m, s)} vs ${T.resolveTaxMode(m, s)}`);
  prop("item 10: the manager panel's rate (taxModel, the shared bill file's) = lib/tax.ts effectiveTaxRate", 20000, setOf, (s) => E.taxModel(s).rate === T.effectiveTaxRate(s) || `${E.taxModel(s).rate} vs ${T.effectiveTaxRate(s)}`); }
{ const NO = new Function("state", edMR + "\nreturn moneyRound;")({});
  t("item 10: before billdoc.js has loaded, the panel helper still answers (the old float rounding, by design) — it never throws", NO(1.234) === 1.23 && typeof NO(NaN) === "number"); }
prop("item 10: the waiter tablet's order split (orderTaxSplit) = lib/tax.ts splitBill on the order's dishes", 20000, (R) => ({ s: { ...setOf(R), price_tax_mode: "excl" }, items: Array.from({ length: int(R, 1, 8) }, () => ({ ...dishLine(R), tax_mode: pick(R, ["excl", "incl", "exempt"]) })) }), ({ s, items }) => {
  const P = TBF(BILLDOC, { data: { settings: s } }); const o = P.orderTaxSplit({ items, total: 0 }); const b = T.splitBill(items, s, 0);
  return (o.base === b.taxableBase && o.nontax === b.nontaxAmount) || `tablet ${o.base}/${o.nontax} vs lib ${b.taxableBase}/${b.nontaxAmount}`; });
prop("item 10: the waiter tablet's rate (effRate) = lib/tax.ts effectiveTaxRate for every tax set-up — composition included", 20000, setOf, (s) => { const r = TBF(BILLDOC, { data: { settings: s } }).effRate(); return r === T.effectiveTaxRate(s) || `tablet ${r} vs lib ${T.effectiveTaxRate(s)} (${s.price_tax_mode})`; });
// ── item 28 (found by the check above): the tablet's rate knows the composition scheme ──
t("item 28: a composition-scheme restaurant's rate on the waiter tablet is 0 — with billdoc.js loaded AND before it has", TBF(BILLDOC, { data: { settings: { price_tax_mode: "composition", tax_rate: 0.05 } } }).effRate() === 0 && TBF(undefined, { data: { settings: { price_tax_mode: "composition", tax_rate: 0.05 } } }).effRate() === 0);
prop("item 28: …and before billdoc.js has loaded, the tablet's fallback still agrees with lib/tax.ts on every set-up", 20000, setOf, (s) => { const r = TBF(undefined, { data: { settings: s } }).effRate(); return r === T.effectiveTaxRate(s) || `${r} vs ${T.effectiveTaxRate(s)}`; });
