// verify-t24-money-rules.mjs — the permanent regression guard for the money and safety
// libraries: lib/tax.ts, lib/taxFiling.ts, lib/paySplit.ts, lib/clash.ts, lib/clashCompare.ts,
// lib/idempotency.ts, lib/idempotencyRule.ts, lib/logTrail.ts, lib/userAuth.ts, lib/rateLimit.ts.
//
// WHY IT EXISTS. Sweep 6 / terminal 24 checked those files against 500 written-down phases
// (.claude/sweep/LEDGER/T24.md). Most of those phases are a NUMBER a person could be charged, or a
// SENTENCE a person has to read, and both were only ever checked by hand. A fix nothing guards
// comes back, so every phase that a script can answer is answered here.
//
// IT RUNS THE REAL FUNCTIONS, NOT A COPY. Every file above is loaded through a tiny `@/` resolver
// and called directly, because a guard that re-implements the rule it checks proves nothing about
// the rule that ships (the same reason lib/idempotencyRule.ts and lib/clashCompare.ts were split
// out into import-free files in the first place).
//
//   node scripts/verify-t24-money-rules.mjs          # the pure rules — no database, no network
//   node scripts/verify-t24-money-rules.mjs --db     # …plus the TS-rule-vs-SQL-function checks
//
// The --db block compares lib/tax.ts against lfh_effective_tax_rate / lfh_split_items_tax /
// lfh_order_discount_base on the DEV database only, reads nothing but settings and its own
// throwaway rows, and refuses to run against any other project.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };

// `@/x` → <root>/x, adding the extension when the import omits it (Next resolves these; plain
// Node does not). This is what lets the guard import lib/paySplit.ts, which pulls in
// lib/payments.ts and public/panels/billdoc.js.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith("@/")) {
      let p = join(root, spec.slice(2));
      if (!existsSync(p)) for (const ext of [".ts", ".tsx", ".js", ".mjs"]) if (existsSync(p + ext)) { p += ext; break; }
      return next(pathToFileURL(p).href, ctx);
    }
    return next(spec, ctx);
  },
});

let pass = 0;
const fails = [];
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m, got) => { fails.push(m); console.log(`  ✗ ${m}${got === undefined ? "" : `  → got ${JSON.stringify(got)}`}`); };
const check = (m, cond, got) => (cond ? ok(m) : bad(m, got));
const eq = (m, got, want) => check(m, JSON.stringify(got) === JSON.stringify(want), got);
const near = (m, got, want, tol = 0.005) => check(m, Math.abs(got - want) <= tol, got);
const head = (t) => console.log(`\n── ${t} ──`);

const tax = await import("@/lib/tax.ts");
const tf = await import("@/lib/taxFiling.ts");
const cc = await import("@/lib/clashCompare.ts");
const ir = await import("@/lib/idempotencyRule.ts");
const lt = await import("@/lib/logTrail.ts");
const ps = await import("@/lib/paySplit.ts");
const BILLDOC = (await import("@/public/panels/billdoc.js")).default;

// ═══════════════════════════════════════════════════════════════════════════════════════════
head("1. lib/tax.ts — ONE source of truth for a restaurant's rate");
// ═══════════════════════════════════════════════════════════════════════════════════════════
const { effectiveTaxRate, effectiveTaxPct, taxComponents, priceTaxMode, itemTaxModesAllowed,
        resolveTaxMode, isMrpDish, splitBill, maxDiscount, TAX_SETTINGS_COLUMNS } = tax;

eq("composition ⇒ the effective rate is exactly 0, not a hidden 5%",
  effectiveTaxRate({ price_tax_mode: "composition", tax_rate: 0.05 }), 0);
near("named components SUM: 12.5 + 2.5 ⇒ 0.15",
  effectiveTaxRate({ tax_components: [{ label: "A", rate: 12.5 }, { label: "B", rate: 2.5 }] }), 0.15);
near("a component with a blank label is ignored",
  effectiveTaxRate({ tax_components: [{ label: "  ", rate: 9 }, { label: "B", rate: 5 }] }), 0.05);
near("a component with rate 0 is ignored",
  effectiveTaxRate({ tax_components: [{ label: "A", rate: 0 }, { label: "B", rate: 5 }] }), 0.05);
near("a component with a NEGATIVE rate is ignored",
  effectiveTaxRate({ tax_components: [{ label: "A", rate: -5 }, { label: "B", rate: 5 }] }), 0.05);
near("tax_components that is not an array falls through to the flat rate",
  effectiveTaxRate({ tax_components: { a: 1 }, tax_rate: 0.12 }), 0.12);
near("tax_rate stored as exactly 0 falls back to 5% — the NULLIF(tax_rate,0) rule of mig 119/272",
  effectiveTaxRate({ tax_rate: 0 }), 0.05);
near("tax_rate null falls back to 5%", effectiveTaxRate({ tax_rate: null }), 0.05);
near("a settings row that is null at all falls back to 5%", effectiveTaxRate(null), 0.05);
near("tax_rate arriving as the string \"0.12\" is read as 0.12, not NaN",
  effectiveTaxRate({ tax_rate: "0.12" }), 0.12);
eq("effectiveTaxPct(8.25%) === 8.25 with no float dust", effectiveTaxPct({ tax_rate: 0.0825 }), 8.25);
eq("effectiveTaxPct(5%) === 5 exactly", effectiveTaxPct({ tax_rate: 0.05 }), 5);
check("TAX_SETTINGS_COLUMNS names all three columns the rate depends on",
  ["tax_rate", "tax_components", "price_tax_mode"].every((c) => TAX_SETTINGS_COLUMNS.includes(c)), TAX_SETTINGS_COLUMNS);
eq("taxComponents() keeps only labelled, positive components",
  taxComponents({ tax_components: [{ label: "CGST", rate: 2.5 }, { label: "", rate: 2.5 }, { label: "X", rate: 0 }] }),
  [{ label: "CGST", rate: 2.5 }]);
eq("priceTaxMode() answers 'excl' for a garbage stored value", priceTaxMode({ price_tax_mode: "wat" }), "excl");
eq("priceTaxMode() passes 'incl' through", priceTaxMode({ price_tax_mode: "incl" }), "incl");
eq("priceTaxMode() passes 'composition' through", priceTaxMode({ price_tax_mode: "composition" }), "composition");
eq("itemTaxModesAllowed() is strictly ===true, so the string \"true\" does NOT switch it on",
  itemTaxModesAllowed({ item_tax_modes_allowed: "true" }), false);
eq("itemTaxModesAllowed() is true for the real boolean", itemTaxModesAllowed({ item_tax_modes_allowed: true }), true);

const ON = { item_tax_modes_allowed: true, tax_rate: 0.05 };
eq("composition ⇒ every line resolves 'exempt' whatever the dish says",
  resolveTaxMode("incl", { price_tax_mode: "composition", item_tax_modes_allowed: true }), "exempt");
eq("master switch OFF ⇒ the dish's own mode is ignored entirely",
  resolveTaxMode("incl", { item_tax_modes_allowed: false, price_tax_mode: "excl" }), "excl");
eq("master switch ON ⇒ dish 'excl' is honoured", resolveTaxMode("excl", { ...ON, price_tax_mode: "incl" }), "excl");
eq("master switch ON ⇒ dish 'incl' is honoured", resolveTaxMode("incl", ON), "incl");
eq("dish 'none' ⇒ exempt", resolveTaxMode("none", ON), "exempt");
eq("dish 'mrp' + mrp_tax_treatment 'inclusive' ⇒ incl",
  resolveTaxMode("mrp", { ...ON, mrp_tax_treatment: "inclusive" }), "incl");
eq("dish 'mrp' otherwise ⇒ exempt", resolveTaxMode("mrp", { ...ON, mrp_tax_treatment: "none" }), "exempt");
eq("dish 'default' ⇒ the restaurant's own mode", resolveTaxMode("default", { ...ON, price_tax_mode: "incl" }), "incl");
eq("isMrpDish() is false while the master switch is off", isMrpDish("mrp", { item_tax_modes_allowed: false }), false);
eq("isMrpDish() is true for an MRP dish with the switch on", isMrpDish("mrp", ON), true);

const S5 = { tax_rate: 0.05 };
eq("splitBill strips a currency symbol out of a price",
  splitBill([{ price: "₹ 120.50", qty: 1, tax_mode: "excl" }], S5).taxableBase, 120.5);
eq("splitBill floors qty at 1 (a 0 qty still charges one)",
  splitBill([{ price: "100", qty: 0, tax_mode: "excl" }], S5).taxableBase, 100);
eq("splitBill's qty of \"abc\" becomes 1, never NaN",
  splitBill([{ price: "100", qty: "abc", tax_mode: "excl" }], S5).taxableBase, 100);
eq("an unparseable price contributes 0, never NaN",
  splitBill([{ price: "free", qty: 2, tax_mode: "excl" }], S5).taxableBase, 0);
eq("an 'incl' line divides by (1 + rate) and rounds to 2dp",
  splitBill([{ price: "105", qty: 1, tax_mode: "incl" }], S5).taxableBase, 100);
eq("an 'exempt' line lands in nontaxAmount and never in taxableBase",
  [splitBill([{ price: "80", qty: 1, tax_mode: "exempt" }], S5).taxableBase,
   splitBill([{ price: "80", qty: 1, tax_mode: "exempt" }], S5).nontaxAmount], [0, 80]);
{
  const s = splitBill([{ price: "80", qty: 1, tax_mode: "exempt", is_mrp: true }], S5);
  eq("an is_mrp line is counted into mrpAmount AS WELL AS its own bucket", [s.mrpAmount, s.nontaxAmount, s.hasMrp], [80, 80, true]);
}
{
  // Rounding PER LINE, matching lfh_split_items_tax: three ₹33.335 'incl' lines at 5%.
  const lines = [1, 2, 3].map(() => ({ price: "33.34", qty: 1, tax_mode: "incl" }));
  const perLine = Math.round((33.34 / 1.05) * 100) / 100;
  eq("rounding is PER LINE, matching lfh_split_items_tax, not once at the end",
    splitBill(lines, S5).taxableBase, Math.round(perLine * 3 * 100) / 100);
}
{
  const s = splitBill([{ price: "100", qty: 2, tax_mode: "excl" }, { price: "50", qty: 1, tax_mode: "exempt" }], S5);
  eq("subtotal === taxableBase + nontaxAmount", s.subtotal, Math.round((s.taxableBase + s.nontaxAmount) * 100) / 100);
  eq("rate > 0 ⇒ discountBase is the TAXABLE base", s.discountBase, 200);
  eq("splitBill([]) is all zeros and never NaN",
    (({ taxableBase, nontaxAmount, mrpAmount, subtotal, tax, total }) => [taxableBase, nontaxAmount, mrpAmount, subtotal, tax, total])(splitBill([], S5)),
    [0, 0, 0, 0, 0, 0]);
}
{
  const lines = [{ price: "100", qty: 1, tax_mode: "exempt", is_mrp: true }, { price: "200", qty: 1, tax_mode: "exempt" }];
  const s = splitBill(lines, { price_tax_mode: "composition" });
  eq("rate = 0 ⇒ discountBase is subtotal − the LOCKED MRP part only", s.discountBase, 200);
  eq("a nil-rated (non-MRP) dish is still discountable at a zero rate", splitBill(lines, { price_tax_mode: "composition" }, 200).discount, 200);
  eq("a composition bill reports composition:true", s.composition, true);
  eq("rate = 0 ⇒ total is subtotal − discount", splitBill(lines, { price_tax_mode: "composition" }, 200).total, 100);
}
{
  const lines = [{ price: "1000", qty: 1, tax_mode: "excl" }];
  const s = splitBill(lines, S5, 100);
  eq("a discount is applied BEFORE tax: taxable = base − discount", s.taxable, 900);
  eq("tax = round(taxable × rate, 2)", s.tax, 45);
  eq("total = taxable + tax + nontaxAmount", s.total, 945);
  eq("the identity subtotal − discount + tax === total holds", Math.round((s.subtotal - s.discount + s.tax) * 100) / 100, s.total);
  eq("a discount above the cap is clamped to the cap, never applied beyond it", splitBill(lines, S5, 5000).discount, 1000);
  eq("a negative discount is clamped to zero", splitBill(lines, S5, -50).discount, 0);
  eq("maxDiscount() === splitBill(lines, settings, 0).discountBase", maxDiscount(lines, S5), splitBill(lines, S5, 0).discountBase);
}
{
  // A mixed bill: taxed food + tax-inclusive drinks + a sealed MRP bottle, at an awkward rate.
  const S = { tax_rate: 0.0825 };
  const lines = [
    { price: "250", qty: 2, tax_mode: "excl" },
    { price: "108.25", qty: 1, tax_mode: "incl" },
    { price: "60", qty: 1, tax_mode: "exempt", is_mrp: true },
  ];
  const s = splitBill(lines, S, 100);
  const wantBase = 500 + Math.round((108.25 / 1.0825) * 100) / 100;
  eq("mixed excl+incl+exempt/MRP at 8.25% — taxable base", s.taxableBase, Math.round(wantBase * 100) / 100);
  eq("mixed — untaxed amount", s.nontaxAmount, 60);
  eq("mixed — locked MRP amount", s.mrpAmount, 60);
  eq("mixed — the identity still holds", Math.round((s.subtotal - s.discount + s.tax) * 100) / 100, s.total);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
head("2. lib/taxFiling.ts — one filing number, reconciled to the rupee");
// ═══════════════════════════════════════════════════════════════════════════════════════════
const { splitTax, allocateWhole, taxableValue, netSalesOf, exemptTolerance, exemptIsMaterial, taxableFor, buildFiling } = tf;
const sum = (a) => a.reduce((x, y) => x + y, 0);
const p2 = (v) => Math.round(v * 100) / 100;

eq("splitTax([]) is an empty list, not a throw", splitTax([], 100), []);
eq("splitTax halves 100 exactly", splitTax([2.5, 2.5], 100), [50, 50]);
eq("splitTax's parts sum to exactly the target, to the paise", p2(sum(splitTax([2.5, 2.5], 207887.51))), 207887.51);
eq("splitTax gives the LAST line the remainder", splitTax([2.5, 2.5], 207887.51).at(-1), 103943.75);
eq("splitTax handles a negative target and still sums exactly", p2(sum(splitTax([2.5, 2.5], -100.01))), -100.01);
eq("splitTax with three uneven rates still sums exactly", p2(sum(splitTax([9, 5, 4], 1000.07))), 1000.07);
check("allocateWhole returns integers", allocateWhole(101, [1, 1, 1]).every(Number.isInteger));
eq("allocateWhole sums to exactly Math.round(total)", sum(allocateWhole(101, [1, 1, 1])), 101);
eq("allocateWhole uses largest-remainder, so no row is short a rupee", allocateWhole(101, [1, 1, 1]), [34, 34, 33]);
eq("allocateWhole with all-zero weights puts the total on the first row rather than losing it",
  allocateWhole(500, [0, 0, 0]), [500, 0, 0]);
eq("allocateWhole handles a negative total and still sums exactly", sum(allocateWhole(-101, [1, 1])), -101);
eq("allocateWhole([]) is an empty list", allocateWhole(100, []), []);
eq("taxableValue recovers the base from tax ÷ rate", taxableValue({ tax: 50, subtotal: 1100, discount: 100 }, 5), 1000);
eq("taxableValue is capped at net sales so a rounding wobble cannot exceed what was sold",
  taxableValue({ tax: 999, subtotal: 100, discount: 0 }, 5), 100);
eq("taxableValue with no rate configured returns net sales (composition)",
  taxableValue({ tax: 0, subtotal: 500, discount: 50 }, null), 450);
eq("netSalesOf is subtotal − discount, to the paise", netSalesOf({ subtotal: 100.005, discount: 0 }), 100.01);
eq("exemptTolerance scales with bills, floor ₹100", [exemptTolerance(0), exemptTolerance(1000)], [100, 500]);
eq("rounding dust is NOT dressed up as exempt supply",
  exemptIsMaterial({ tax: 398074, subtotal: 7961596, discount: 0, paidOrders: 12000 }, 5), false);
eq("a genuine exempt portion IS reported",
  exemptIsMaterial({ tax: 5000, subtotal: 200000, discount: 0, paidOrders: 100 }, 5), true);
eq("taxableFor prints net sales when the period has no material exempt portion",
  taxableFor({ tax: 50, subtotal: 1050, discount: 0 }, 5, false), 1050);
{
  const lines = [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }];
  const rows = [{ tax: 33.34 }, { tax: 33.33 }, { tax: 33.33 }];
  const f = buildFiling(rows, lines, (r) => r.tax);
  eq("buildFiling total === Math.round(Σ raw tax) — the same figure the KPI tile shows", f.total, 100);
  eq("buildFiling every row's parts sum to that row's whole-rupee tax",
    f.rows.map((r) => p2(sum(r.parts)) === r.tax), [true, true, true]);
  eq("buildFiling rows sum to the total", sum(f.rows.map((r) => r.tax)), f.total);
  eq("buildFiling columns sum to the total", p2(sum(f.columnTotals)), f.total);
  eq("buildFiling columnTotals[j] is the sum of column j",
    f.columnTotals, lines.map((_, j) => p2(sum(f.rows.map((r) => r.parts[j] ?? 0)))));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
head("3. lib/clashCompare.ts — 'is this still the value the screen was editing from?'");
// ═══════════════════════════════════════════════════════════════════════════════════════════
eq("stableJson sorts keys at every level, so the same content compares equal",
  cc.stableJson({ b: { d: 1, c: 2 }, a: 3 }), cc.stableJson({ a: 3, b: { c: 2, d: 1 } }));
check("stableJson is depth-limited and does not hang on a deep value",
  typeof cc.stableJson(Array.from({ length: 40 }).reduce((acc) => ({ x: acc }), 1)) === "string");
eq("sameValue trims text", cc.sameValue("  mild ", "mild"), true);
eq("sameValue compares lists as SETS", cc.sameValue(["nuts", "dairy"], ["dairy", "nuts"]), true);
eq("sameValue tells two different lists apart", cc.sameValue(["nuts"], ["dairy"]), false);
eq("sameValue compares objects by CONTENT", cc.sameValue({ t1: "Patio", t2: "Bar" }, { t2: "Bar", t1: "Patio" }), true);
eq("sameValue tells two different rename maps apart", cc.sameValue({ t1: "Patio" }, { t1: "Terrace" }), false);
eq("sameValue treats null/absent and {} as the same, so an unset column invents no clash", cc.sameValue(null, {}), true);
eq("isPlainObject rejects arrays", cc.isPlainObject([1, 2]), false);
eq("isPlainObject accepts an object", cc.isPlainObject({ a: 1 }), true);

// ═══════════════════════════════════════════════════════════════════════════════════════════
head("4. lib/idempotencyRule.ts — a retry must never double-charge, a refusal must never stick");
// ═══════════════════════════════════════════════════════════════════════════════════════════
eq("a 200 that really did something is remembered", ir.didSomething(200, { ok: true, order_id: "x" }), true);
eq("any status ≥ 400 is not remembered, so the person's next try genuinely retries", ir.didSomething(400, {}), false);
eq("a 500 is not remembered either", ir.didSomething(500, null), false);
eq("a 200 carrying ok:false is NOT remembered (the guest sold-out / over-the-limit case)",
  ir.didSomething(200, { ok: false, reason: "sold_out" }), false);
eq("a 200 with a non-object body is remembered", ir.didSomething(200, "done"), true);
eq("storedIsRefusal spots an already-stored refusal so it can self-heal", ir.storedIsRefusal({ ok: false }), true);
eq("storedIsRefusal leaves a real stored result alone", ir.storedIsRefusal({ ok: true, order_id: "x" }), false);
eq("storedIsRefusal on null is false", ir.storedIsRefusal(null), false);
check("lib/idempotencyRule.ts has no imports, so this guard runs the rule that ships",
  !/^\s*import\s/m.test(read("lib/idempotencyRule.ts")));
check("lib/clashCompare.ts has no imports either, for the same reason",
  !/^\s*import\s/m.test(read("lib/clashCompare.ts")));

// ═══════════════════════════════════════════════════════════════════════════════════════════
head("5. lib/logTrail.ts — every log row says WHERE it happened");
// ═══════════════════════════════════════════════════════════════════════════════════════════
eq("placeOf never throws on an empty code", lt.placeOf("").screen, "Unknown");
eq("placeOf never throws on null", lt.placeOf(null).area, "System");
eq("an explicit entry wins over the prefix rules",
  lt.placeOf("order_accept"), { area: "Orders & bills", screen: "Kitchen tickets" });
eq("a code only the prefix rules know still gets a real area",
  lt.placeOf("order_something_new_2027").area, "Orders & bills");
eq("a code nothing knows lands in System › Other — honest, not invented",
  lt.placeOf("zzz_nobody_placed_this"), { area: "System", screen: "Other" });
eq("panelName maps 'editor' to the words a person uses", lt.panelName("editor"), "Manager panel");
eq("an unknown panel prints itself capitalised rather than vanishing", lt.panelName("weird"), "Weird");
eq("a missing panel says so", lt.panelName(null), "Unknown panel");
eq("targetOf prefers table_number", lt.targetOf({ table_number: "5" }), "Table 5");
eq("a NAMED table prints its name as it stands", lt.targetOf({ table_number: "Patio" }), "Patio");
eq("a quoted run inside detail becomes the target", lt.targetOf({ detail: 'created manager "ravi"' }), "ravi");
eq("a bill number inside detail becomes Bill #N", lt.targetOf({ detail: "settled bill #212" }), "Bill #212");
eq("order_id falls back to its first 8 characters",
  lt.targetOf({ order_id: "abcdef01-2345-6789" }), "Order abcdef01");
eq("nothing to point at says nothing rather than guessing", lt.targetOf({ detail: "did a thing" }), null);
{
  const t = lt.trailOf({ panel: "editor", action: "bill_split", table_number: "5", restaurant_name: "My Little French House" });
  eq("trailOf builds restaurant › panel › area › screen",
    t.crumbs, ["My Little French House", "Manager panel", "Orders & bills", "Settle the bill"]);
  eq("trailOf's short form is screen · target", t.short, "Settle the bill · Table 5");
  eq("a missing restaurant is dropped, not printed blank",
    lt.trailOf({ panel: "editor", action: "bill_split" }).crumbs.length, 3);
}
check("lib/logTrail.ts is client-safe — it imports nothing at all",
  !/^\s*import\s/m.test(read("lib/logTrail.ts")));

// ── THE ONE THAT KEEPS COMING BACK: a new action code with no place ────────────────────────
// T20 had to hand-add `cancel_classified` / `cancel_classify_failed` (mig 340) and six
// `print_helper_*` codes (mig 341) because they were declared in ACT_LABEL and nowhere in PLACE,
// so every one of them read "System › Other" in the Activity log's detail card — against the
// owner's standing rule (2026-08-12) that every row says where it happened. Nothing guarded it,
// so the next migration would have done it again. This is that guard.
{
  const PANEL_NAMES = new Set(["editor", "manager", "kitchen", "tablet", "owner", "admin", "guest", "db", "menu"]);
  const written = new Set();
  const { readdirSync } = await import("node:fs");
  const scan = (dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== "node_modules") scan(rel); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      const body = read(rel);
      // logAction("panel", "action", …) / log("panel", "action", …) / the panels' log("action", …)
      for (const m of body.matchAll(/\blog(?:Action)?\(\s*"([a-z0-9_]+)"\s*,\s*(?:"([a-z0-9_]+)"\s*,)?/g)) {
        if (m[2]) written.add(m[2]);
        else if (!PANEL_NAMES.has(m[1])) written.add(m[1]);
      }
      // A ternary second argument writes TWO codes and the literal pattern above sees neither.
      for (const re of [/\blog(?:Action)?\(\s*[^,]+,\s*[^,;){:]*?\?\s*"([a-z0-9_]+)"\s*:\s*"([a-z0-9_]+)"/g,
                        /\blog(?:Action)?\(\s*[^,;){:"]*?\?\s*"([a-z0-9_]+)"\s*:\s*"([a-z0-9_]+)"/g]) {
        for (const m of body.matchAll(re)) { written.add(m[1]); written.add(m[2]); }
      }
    }
  };
  scan("app"); scan("lib");
  check("the scan found the action codes at all (if this drops to nothing, the scan broke, not the app)",
    written.size > 100, written.size);
  const homeless = [...written].filter((a) => lt.placeOf(a).screen === "Other").sort();
  check(`every action code the app can WRITE resolves to a real area and screen (${written.size} codes)`,
    homeless.length === 0, homeless);

  // ── THE SAME ACT FROM THE CONSOLE HAPPENED ON A CONSOLE SCREEN ─────────────────────────
  // A code written from BOTH the Aevidine console and a restaurant panel can only have one home in
  // PLACE, so `credit_note` and `order_delete` done on the console's Bills page were filed under
  // "Orders & bills › Reopen the bill" — an area the console does not have and a screen that only
  // exists in the manager panel. lib/logTrail.ts's PANEL_PLACE fixes those two; this makes sure a
  // THIRD one cannot appear without being placed.
  const byPanel = new Map();   // code → Set(panel)
  const scan2 = (dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== "node_modules") scan2(rel); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      for (const m of read(rel).matchAll(/\blog(?:Action)?\(\s*"([a-z0-9_-]+)"\s*,\s*"([a-z0-9_]+)"/g)) {
        if (!byPanel.has(m[2])) byPanel.set(m[2], new Set());
        byPanel.get(m[2]).add(m[1]);
      }
    }
  };
  scan2("app"); scan2("lib");
  const misplaced = [];
  for (const [code, panels] of byPanel) {
    if (!panels.has("admin") || panels.size < 2) continue;      // written from the console AND a panel
    if (lt.placeOf(code, "admin").area !== "Aevidine console") misplaced.push(code);
  }
  check("a code written from BOTH the console and a panel is placed on the CONSOLE's own screen when the console did it",
    misplaced.length === 0, misplaced);
  eq("credit_note issued from the console reads Aevidine console › Bills",
    lt.placeOf("credit_note", "admin"), { area: "Aevidine console", screen: "Bills" });
  eq("…while the same code from the manager panel still reads Reopen the bill",
    lt.placeOf("credit_note", "editor"), { area: "Orders & bills", screen: "Reopen the bill" });
  eq("placeOf with no panel behaves exactly as it always did", lt.placeOf("credit_note"), lt.placeOf("credit_note", null));
  eq("trailOf passes the panel through, so the console's own row lands in the console",
    lt.trailOf({ panel: "admin", action: "credit_note" }).screen, "Bills");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
head("6. lib/paySplit.ts — paying ONE bill in parts, in one place");
// ═══════════════════════════════════════════════════════════════════════════════════════════
const { badSplitShape } = ps;
check("one part is refused", badSplitShape([{ amount: 10, method: "UPI" }]) !== null);
check("thirteen parts are refused", badSplitShape(Array.from({ length: 13 }, () => ({ amount: 1, method: "Cash" }))) !== null);
check("twelve parts are accepted", badSplitShape(Array.from({ length: 12 }, () => ({ amount: 1, method: "Cash" }))) === null);
check("a zero amount is refused", badSplitShape([{ amount: 0, method: "UPI" }, { amount: 10, method: "Cash" }]) !== null);
check("a negative amount is refused", badSplitShape([{ amount: -5, method: "UPI" }, { amount: 10, method: "Cash" }]) !== null);
check("a NaN amount is refused", badSplitShape([{ amount: "abc", method: "UPI" }, { amount: 10, method: "Cash" }]) !== null);
check("an unknown payment method is refused", badSplitShape([{ amount: 5, method: "Crypto" }, { amount: 5, method: "Cash" }]) !== null);
check("a note over 200 characters is refused",
  badSplitShape([{ amount: 5, method: "UPI", note: "x".repeat(201) }, { amount: 5, method: "Cash" }]) !== null);
check("a well-formed two-part split is accepted",
  badSplitShape([{ amount: 200, method: "UPI" }, { amount: 200, method: "Cash" }]) === null);
check("anything that is not an array is refused", badSplitShape({ a: 1 }) !== null);
check("an empty list is refused", badSplitShape([]) !== null);

// The rate ONE order was charged at has exactly ONE definition, shared with the paper.
check("lib/paySplit.ts asks billdoc.js for the rate rather than spelling it out again",
  /BILLDOC\.orderTaxRate\(/.test(read("lib/paySplit.ts")));
eq("orderTaxRate honours the stamped rate (a banquet at 18% is not asked for at 5%)",
  BILLDOC.orderTaxRate({ tax_rate: 0.18, subtotal: 100 }, 0.05), 0.18);
eq("orderTaxRate honours a stamped ZERO on an order that carries money",
  BILLDOC.orderTaxRate({ tax_rate: 0, subtotal: 100 }, 0.05), 0);
eq("orderTaxRate falls back to the settings rate when the order was never stamped",
  BILLDOC.orderTaxRate({ tax_rate: null, subtotal: 100 }, 0.05), 0.05);

// The bucketed-rate due, run against the real rule shape: two orders at two rates in one session.
{
  const src = read("lib/paySplit.ts");
  check("the due is bucketed PER RATE, so tax rounds once per rate and not once per order",
    /const buckets = new Map<number, \{ base: number; disc: number \}>/.test(src));
  check("the discount is clamped to its own base exactly as the printed bill clamps it",
    /const discountBase = anyTax \? r2\(base\) : Math\.max\(0, r2\(sub - mrp\)\)/.test(src));
  check("the due is subtotal − discount + tax — the one formula that also holds at a zero rate",
    /const due = r2\(sub - disc \+ tax\)/.test(src));
  check("the tolerance is measured against the SERVER's recomputed due, never the browser's number",
    /Math\.abs\(sum - due\) > 0\.02/.test(src));
  check("a soft-deleted order is not part of the bill", /\.is\("deleted_at", null\)/.test(src));
  check("cancelled, unaccepted and already-paid orders are excluded",
    /\.neq\("status", "cancelled"\)\.neq\("status", "received"\)\.neq\("payment_status", "paid"\)/.test(src));
  check("the order read is scoped by restaurant_id and capped", /\.eq\("restaurant_id", rid\)/.test(src) && /\.limit\(400\)/.test(src));
  check("the 400-order cap REFUSES rather than quietly collecting for a partial set", /status: 409/.test(src) && /too many orders to split/.test(src));
  check("the orders update is scoped by restaurant_id as well as by id",
    /\.in\("id", ids\)\.eq\("restaurant_id", rid\)/.test(src));
  check("reverseSplitLegs STAMPS a leg rather than deleting it (mig 285)",
    /reversed_at: new Date\(\)\.toISOString\(\)/.test(src) && !/session_payments"\)\s*\.delete\(/.test(src));
  check("reverseSplitLegs only touches legs that are not already reversed", /\.is\("reversed_at", null\)/.test(src));
  check("reverseSplitLegs scopes to the settle being undone", /\.gte\("created_at", since\)/.test(src));
  check("reverseSplitLegs THROWS when the trail cannot be corrected", /throw new Error\(`couldn't reverse the payment legs/.test(src));
  check("nothing in lib/paySplit.ts can delete an order, an invoice or a bill",
    !/from\("orders"\)[\s\S]{0,40}\.delete\(/.test(src) && !/from\("invoice/.test(src));

  // ── T24 fix 1: the trail must not claim money that was never taken ─────────────────────
  // The parts land in session_payments first and the paid stamp lands second, with no transaction
  // across the two. When the stamp failed, the legs were left standing, so the bill stayed UNPAID
  // while the money trail said the parts had been collected on it.
  check("the inserted parts are identified, so a failed paid-stamp can be undone",
    /\.insert\(legs\)\.select\("id"\)/.test(src) && /const legIds = /.test(src));
  check("a failed paid-stamp REVERSES the parts it just recorded rather than leaving them standing",
    /if \(upd\.error\) \{[\s\S]{0,900}?reversed_at: new Date\(\)\.toISOString\(\)/.test(src));
  check("…and it stamps them (mig 285) rather than deleting them",
    /\/\/ THE TRAIL MUST NOT CLAIM MONEY THAT WAS NEVER TAKEN/.test(src)
    && !/session_payments"\)\s*\n?\s*\.delete\(/.test(src));
  check("…and the person is still told the settle failed (500), not quietly told it worked",
    /return \{ ok: false, message: upd\.error\.message, status: 500 \};/.test(src));

  // ── T24 fix 2: one rounding for the check AND the row ──────────────────────────────────
  check("each part is rounded ONCE, before the ±2p gate, so what was agreed is what is recorded",
    /const parts = splits\.map\(\(s\) => \(\{ amount: r2\(Number\(s\.amount\)\)/.test(src)
    && /const sum = r2\(parts\.reduce/.test(src));
  check("the stored legs and the note both come from those same rounded parts",
    /const legs = parts\.map\(/.test(src) && /parts\.map\(\(s\) => `₹\$\{s\.amount\.toFixed\(0\)\}/.test(src));
}
// One place only: no route may re-implement the split arithmetic.
{
  const routes = ["app/api/editor/[...path]/route.ts", "app/api/tablet/[...path]/route.ts"];
  for (const r of routes) {
    const s = read(r);
    check(`${r} calls settleBillInParts instead of doing the split arithmetic itself`,
      /settleBillInParts\(/.test(s));
    check(`${r} calls reverseSplitLegs instead of touching session_payments itself`,
      /reverseSplitLegs\(/.test(s));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
head("7. lib/clash.ts + lib/idempotency.ts + lib/userAuth.ts + lib/rateLimit.ts — the rules that live in the source");
// ═══════════════════════════════════════════════════════════════════════════════════════════
{
  const s = read("lib/clash.ts");
  check("the replay threshold keeps the LIVE write path untouched", /REPLAY_MIN_AGE_MS = 20_000/.test(s));
  check("the comparison table list is an allowlist, not whatever the screen names",
    /const COMPARABLE_TABLES: Record<string, string> = \{/.test(s));
  check("a composite key may only use its own whitelisted columns", /const COMPOSITE_KEYS: Record<string, string\[\]> = \{/.test(s));
  check("field names are validated before they reach the select",
    /\/\^\[a-z_\]\[a-z0-9_\]\*\(\\\.\[a-zA-Z0-9_-\]\+\)\?\$\//.test(s));
  check("the rows whose own id IS the tenant key refuse a foreign id outright",
    /if \(TENANT_ROW_TABLES\.has\(table\) && id !== rid\) return null;/.test(s));
  check("every other comparison is scoped to this restaurant",
    /if \(!TENANT_ROW_TABLES\.has\(table\)\) q = q\.eq\("restaurant_id", rid\);/.test(s));
  check("the gate fails OPEN on any lookup problem", /} catch \{\s*\n\s*return null; \/\/ fail open/.test(s));
  check("every refusal is retryable:false — resending the same thing cannot help",
    (s.match(/retryable: false/g) || []).length >= 4 && !/retryable: true/.test(s));
  check("a money column's refusal does not repeat the figure",
    /const QUIET_COLUMNS = new Set\(\["discount", "price", "payment_status", "total"\]\)/.test(s));
  check("a switch reads on/off in the refusal, never true/false",
    /if \(typeof v === "boolean"\) return v \? "on" : "off";/.test(s));
  check("the third state of a money row reads as words, not as \"pin\"",
    /return "on, but asking for a manager PIN";/.test(s));
  check("an object's refusal says it moved instead of printing [object Object]",
    /if \(isPlainObject\(v\)\) return "something different now";/.test(s));
  check("a closed table with no closed_at is refused, because it cannot be proved who was first",
    /if \(isClosed && !closed\)/.test(s));
  check("a table is named by the name the restaurant gave it, read live from settings.table_names",
    /select\("table_names"\)/.test(s));
  check("the value comparison is imported, not copied", /from "@\/lib\/clashCompare"/.test(s));
}
{
  const s = read("lib/idempotency.ts");
  check("a request with no action id is passed straight through", /if \(!actionId\) return fn\(req, ctx\);/.test(s));
  check("a stale claim (30s) is taken over, so a crash cannot wedge an action forever", /STALE_MS = 30_000/.test(s));
  check("a concurrent duplicate is told to retry rather than answered with a wrong result",
    /"sync_in_progress"/.test(s) && /status: 409/.test(s));
  check("a completed action echoes its STORED result so a lost first reply is still trackable",
    /duplicate: true/.test(s));
  check("the stored result is per-call, never a shared module variable", /type Claim = \{ state: ClaimState; result\?: unknown \}/.test(s));
  check("a failed write RELEASES the claim so the next replay genuinely retries",
    /else await sb\.from\("action_idempotency"\)\.delete\(\)\.eq\("action_id", actionId\);/.test(s));
  check("a thrown handler releases the claim before rethrowing", /await finish\(actionId, false\);\s*\n\s*throw e;/.test(s));
  check("the response is CLONED so the caller can still read the body", /await res\.clone\(\)\.json\(\)/.test(s));
  check("the decision about whether anything happened is the shared rule, not a copy",
    /didSomething\(res\.status, body\)/.test(s) && /from "@\/lib\/idempotencyRule"/.test(s));
  check("the claims table is pruned opportunistically, with no timer touching idle data",
    /PRUNE_ODDS = 200/.test(s) && /lfh_prune_action_idempotency/.test(s));
  check("the prune can never affect a write (fire-and-forget, fully swallowed)",
    /void sb\.rpc\("lfh_prune_action_idempotency"\)/.test(s));
  check("the whole layer fails OPEN", (s.match(/fail open/g) || []).length >= 3);
}
{
  // Every panel write route is wrapped at the ROUTE export, so no branch inside can skip it.
  const routes = [
    ["app/api/editor/[...path]/route.ts", ["POST", "PATCH", "DELETE"]],
    ["app/api/kitchen/[...path]/route.ts", ["POST"]],
    ["app/api/tablet/[...path]/route.ts", ["POST"]],
    ["app/api/inventory/[...path]/route.ts", ["POST"]],
    ["app/api/panel-profile/route.ts", ["POST"]],
    ["app/api/guest/place-order/route.ts", ["POST"]],
    ["app/api/guest/call-waiter/route.ts", ["POST"]],
  ];
  for (const [file, verbs] of routes) {
    const s = read(file);
    for (const v of verbs) {
      check(`${file} — ${v} is wrapped in withIdempotency at the route export`,
        new RegExp(`export const ${v} = withIdempotency\\(`).test(s));
    }
  }
}
{
  const s = read("lib/userAuth.ts");
  check("login inputs are length-capped BEFORE the slow hash", /MAX_USERNAME_LEN/.test(s) && /MAX_PASSWORD_LEN/.test(s));
  check("a recycle-bin account is not a login", /\.is\("deleted_at", null\)/.test(s));
  check("the candidate read is capped, so one shared name cannot become an unbounded read",
    /MAX_LOGIN_CANDIDATES = \d+/.test(s)
    && /\.eq\("username", uname\)\s*\n?\s*\.is\("deleted_at", null\)\.limit\(MAX_LOGIN_CANDIDATES\)/.test(s));
  check("…and reaching that ceiling is said out loud rather than silently dropping an account",
    /matches \$\{MAX_LOGIN_CANDIDATES\}\+ accounts/.test(s));
  check("a failed candidate lookup is transient, never 'wrong password'", /transient: true, reason: "transient"/.test(s));
  check("five wrong tries lock the account for a minute", /MAX_FAILS = 5/.test(s) && /LOCK_MS = 60 \* 1000/.test(s));
  check("the password hash is salted and slow", /PBKDF2_ITERS = 120_000/.test(s));
  check("the cookie signature covers the role and the token version, so both can end a session",
    /hmac\(`\$\{u\.id\}:\$\{u\.role\}:\$\{u\.token_version\}:\$\{iat\}`\)/.test(s));
  check("a cookie past the 7-day age is refused", /TOKEN_TTL_MS = 7 \* 24 \* 60 \* 60 \* 1000/.test(s));
  check("a sustained lookup failure throws AuthDbError, so gates answer 503 and not 401",
    /throw new AuthDbError/.test(s));
  check("the staff cookie is checked BEFORE the admin fallback",
    s.indexOf("userFromCookie(req.cookies.get(USER_COOKIE)") < s.indexOf("// No satisfying staff session"));
  check("the panel entitlement and the recycle bin are re-checked on every request",
    /isPanelEnabledCached\(u\.role, u\.restaurant_id\)/.test(s) && /isRestaurantDeleted\(u\.restaurant_id\)/.test(s));
  check("a missing SESSION_SECRET is warned about once per server start", /warnedNoSessionSecret/.test(s));
  check("the presence heartbeat is throttled and fire-and-forget", /45_000/.test(s));
  check("the wall-hit describe reads are scoped, column-listed and limited",
    /\.select\("id, role, name, username, restaurant_id"\)/.test(s) && /\.limit\(5\)/.test(s));
}
{
  const s = read("lib/rateLimit.ts");
  check("rateAllowed fails OPEN on an RPC error", /if \(error\) return true; \/\/ fail-open/.test(s));
  check("an empty subject is allowed rather than counted", /if \(!subj\) return true;/.test(s));
  check("the WHO/WHERE reads happen only on the rare wall-hit path", /if \(!allowed\) \{/.test(s));
  check("the open-event read is scoped to ONE restaurant, so two restaurants' walls never mix",
    /openEventStats\(key: string, subject: string, rid\?: string \| null\)/.test(s));
  check("resetting a login counter is scoped to ONE restaurant",
    /rateResetOnSuccess\(key: RateKey, subject: string, rid\?: string \| null\)/.test(s));
  check("a wall that was hit is marked handled, never deleted", /status: "allowed"/.test(s) && !/rate_limit_events"\)\s*\.delete\(/.test(s));
  check("the guest ping confirms a real recent DB event before it fires",
    /gte\("last_at", new Date\(Date\.now\(\) - 2 \* 60 \* 1000\)/.test(s));
  check("the staff-login limit is the one silent alert; every other ping is audible",
    /silent: key === "staff_login"/.test(s));
  check("an alert can never hang the request that raised it — the alert fetch carries a timeout",
    /AbortSignal\.timeout\(/.test(read("lib/alerts.ts")));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
head("8. the two docs I own tell the truth about the code they name");
// ═══════════════════════════════════════════════════════════════════════════════════════════
{
  const c = read("docs/COMPLIANCE-GUARDRAILS.md");
  check("§3.0 still states the cancellation rule as the one everything hangs off",
    /A sale can be cancelled\. A sale can never disappear\./.test(c));
  check("§3.0.4 still says nobody at the restaurant has a button that removes a bill",
    /No one at the restaurant — the owner included — has a button that removes a bill/.test(c));
  // COMMENTS STRIPPED FIRST. This check used to grep the raw source, so it went red on the four
  // `REJECTED (owner, 2026-08-16)` comments that CLAUDE.md REQUIRES to be there — a guard failing on
  // the very note that records the decision. Only a live declaration counts.
  {
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const model = strip(read("lib/accessTree.ts")) + strip(read("lib/accessModel.ts"));
    check("…and there really is no grantable 'Delete a bill' row left in the access model (R27)",
      !/delete_bill|Delete a bill/.test(model));
  }
  check("§3 'never hardcode a tax rate' — no money path spells a rate out instead of asking lib/tax.ts",
    /never hardcode a tax rate/i.test(c));
  // §3 RETENTION, ENFORCED ON THE LIVE PURGE AND NOT ON ONE MIGRATION'S TEXT.
  // admin_purge_restaurant has been rewritten six times (128 → 309 → 321 → 342 → 345 → 346).
  // verify:admin-restaurants reads migration 342 only, so from 345 onwards the promise this doc
  // prints was not the promise being checked. Every definition is checked here instead.
  {
    const MONEY = ["orders", "order_items", "sessions", "payments", "session_payments",
                   "credit_notes", "invoice_events", "deletion_audit", "bill_chain"];
    const { readdirSync: rd } = await import("node:fs");
    const migs = rd(join(root, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql") && /FUNCTION\s+(public\.)?admin_purge_restaurant/i.test(read(`supabase/migrations/${f}`)));
    check(`every migration defining the purge was found (${migs.length})`, migs.length >= 4, migs);
    // THE ONE THAT SHIPS is the highest-numbered definition. The early ones (128, 190) DID delete
    // orders — that was the behaviour migration 309 was written to stop — and a migration already
    // applied is history that cannot be edited, so checking them proves nothing and would go red
    // forever. What must hold is that the CURRENT definition keeps every money table.
    const live = migs.sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).at(-1);
    const body = read(`supabase/migrations/${live}`).replace(/^\s*--.*$/gm, "");
    const offenders = MONEY.filter((t) => new RegExp(`delete\\s+from\\s+${t}\\b`, "i").test(body));
    check(`the purge that ships (${live}) deletes no money table — a sale can never disappear (§3.0)`,
      offenders.length === 0, offenders);
    check("…and it is a LATER definition than the ones that used to delete bills (309 closed that)",
      parseInt(live, 10) > 309, live);
    check("§3 names the live purge rather than a single migration", /rewritten six times/.test(c));
  }
  const playbook = read("docs/SAAS-EFFICIENCY-PLAYBOOK.md");
  // §3a promises to list EVERY live expire:0 call site. A fourth one that never got listed is
  // exactly the drift that makes a reference doc stop being trusted.
  const sites = [];
  const { readdirSync } = await import("node:fs");
  const walk = (dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(rel); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      // `[^)]*` never matched: every real call is revalidateTag(menuTag(rid), { expire: 0 }) and the
      // inner `)` stopped it dead, so this walker found nothing and the doc check passed vacuously.
      if (/revalidateTag\([^;\n]*expire:\s*0/.test(read(rel))) sites.push(rel);
    }
  };
  walk("app"); walk("lib");
  const unlisted = sites.filter((f) => !playbook.includes(f));
  check(`§3a lists every live revalidateTag(tag, { expire: 0 }) call site (${sites.length} found)`,
    unlisted.length === 0, unlisted);
  check("§3a's rule still holds: nothing anywhere uses revalidateTag(tag, \"max\")",
    !sites.length || !/revalidateTag\([^)]*"max"\)/.test(sites.map(read).join("\n")));
  check("the playbook no longer lists the finished owner-dashboard fix as outstanding High priority",
    /### High — BOTH RESOLVED/.test(playbook) && !/- \[ \] \*\*`lfh_owner_overview` full-scans/.test(playbook));
  check("…and it says WHICH migrations closed it, so nobody re-does the work",
    /mig 190/.test(playbook) && /mig 266/.test(playbook));
  check("the playbook's own 'not in this file yet' banner is gone, because the three lessons are in it",
    !/THREE LATER LESSONS ARE NOT IN THIS FILE YET/.test(playbook)
    && /## 0\. The three rules learned AFTER the June incident/.test(playbook));
  check("the playbook's stale line reference for the allergen loop was corrected",
    !/editor route ~505-511/.test(playbook) && /around line \*\*3440\*\*/.test(playbook));
  check("the playbook points at the security checklist rather than only saying the sweep is owed",
    /docs\/SECURITY-CHECKLIST\.md/.test(playbook));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// --db: the TypeScript rule against the SQL function, on the dev database only.
// ═══════════════════════════════════════════════════════════════════════════════════════════
if (process.argv.includes("--db")) {
  head("9. the TypeScript rule and the SQL function answer the same number (dev database)");
  const env = Object.fromEntries(
    readFileSync(join(root, ".env.local"), "utf8").split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
  );
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const DEV_REFS = ["wnsfcizclkbobwzcxqsf"];   // AV live is never a target (CLAUDE.md, two stacks)
  if (!DEV_REFS.includes(ref)) {
    console.error(`REFUSING: this block only runs against the dev/test database, not ${ref}.`);
    process.exit(2);
  }
  const sql = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(`SQL ${r.status}: ${JSON.stringify(body)}`);
    return body;
  };
  const FH = "00000000-0000-0000-0000-000000000001";   // French House — the writable one

  // The rate: read the settings row and ask both sides.
  const [set] = await sql(`select tax_rate, tax_components, price_tax_mode from settings where restaurant_id = '${FH}'`);
  const [{ rate: sqlRate }] = await sql(`select lfh_effective_tax_rate('${FH}')::float8 as rate`);
  near("French House: effectiveTaxRate(settings) === lfh_effective_tax_rate(rid)", effectiveTaxRate(set), sqlRate, 1e-9);

  // The split: the same items through both implementations, on this restaurant's real settings.
  const items = [
    { price: "250", qty: 2, tax_mode: "excl" },
    { price: "105", qty: 1, tax_mode: "incl" },
    { price: "60", qty: 1, tax_mode: "exempt", is_mrp: true },
    { price: "40", qty: 3, tax_mode: "exempt" },
  ];
  const [{ split }] = await sql(`select lfh_split_items_tax('${JSON.stringify(items).replace(/'/g, "''")}'::jsonb, '${FH}') as split`);
  const ts = splitBill(items, set);
  near("French House: taxable_base agrees with lfh_split_items_tax", ts.taxableBase, Number(split.taxable_base), 0.005);
  near("French House: nontax_amount agrees with lfh_split_items_tax", ts.nontaxAmount, Number(split.nontax_amount), 0.005);
  near("French House: mrp_amount agrees with lfh_split_items_tax", ts.mrpAmount, Number(split.mrp_amount), 0.005);
  near("French House: the rate the split used agrees too", ts.rate, Number(split.rate), 1e-9);

  // The discount cap: mirror lfh_order_discount_base's CASE against splitBill's discountBase,
  // for both the taxed and the zero-rate branch, without writing an order row.
  for (const [label, s] of [["taxed", set], ["zero-rate (composition)", { ...set, price_tax_mode: "composition" }]]) {
    const t = splitBill(items, s);
    const [{ cap }] = await sql(`
      select (case when ${Number(t.rate)} = 0
                   then greatest(${t.subtotal}::numeric - ${t.mrpAmount}::numeric, 0)
                   else ${t.taxableBase}::numeric end)::float8 as cap`);
    near(`the discount cap matches lfh_order_discount_base's CASE — ${label}`, t.discountBase, cap, 0.005);
  }

  // A mixed-rate bill: each order taxed at ITS OWN rate, rounded once per rate — the rule
  // lib/paySplit.ts and the Z-report share. Proved with numbers, no rows written.
  {
    const rows = [{ taxable_base: 1000, discount: 0, tax_rate: 0.05 }, { taxable_base: 2000, discount: 100, tax_rate: 0.18 }];
    const r2 = (n) => Math.round(n * 100) / 100;
    const buckets = new Map();
    for (const o of rows) {
      const r = BILLDOC.orderTaxRate(o, effectiveTaxRate(set));
      const b = buckets.get(r) || { base: 0, disc: 0 };
      b.base += o.taxable_base; b.disc += o.discount; buckets.set(r, b);
    }
    let taxTs = 0;
    for (const [r, b] of buckets) taxTs = r2(taxTs + r2(Math.max(0, r2(b.base - Math.min(b.disc, b.base))) * r));
    const [{ t: taxSql }] = await sql("select (round(1000 * 0.05, 2) + round(1900 * 0.18, 2))::float8 as t");
    near("a mixed-rate bill taxes each order at ITS OWN rate, rounded once per rate", taxTs, taxSql, 0.005);
  }

  // The compliance promise, read off the FUNCTION THAT IS INSTALLED rather than off a migration
  // file — which is the only version that can actually erase anything.
  {
    const [{ def }] = await sql("select pg_get_functiondef('admin_purge_restaurant(uuid)'::regprocedure) as def");
    const body = String(def).replace(/^\s*--.*$/gm, "");
    const MONEY = ["orders", "order_items", "sessions", "payments", "session_payments",
                   "credit_notes", "invoice_events", "deletion_audit", "bill_chain"];
    const offenders = MONEY.filter((t) => new RegExp(`delete\\s+from\\s+${t}\\b`, "i").test(body));
    check("the INSTALLED admin_purge_restaurant deletes no money table (COMPLIANCE-GUARDRAILS §3.0)",
      offenders.length === 0, offenders);
    check("…and the installed purge still keeps the restaurants row, marked purged_at, so bills have a parent",
      /purged_at/.test(body));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
console.log(`\n${fails.length ? "✗ FAIL" : "✓ PASS"} — ${pass} checks passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`   · ${f}`); process.exit(1); }
