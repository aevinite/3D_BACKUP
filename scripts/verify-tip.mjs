// verify-tip.mjs — the TIP's rules, in one place.
//
// WHY THIS EXISTS. A tip is the only money in this product that is collected on a bill and is NOT
// part of the sale. That single sentence is the whole feature, and it is also the thing that is
// easy to lose: the moment a tip is added into the subtotal, the tax or the TOTAL, the restaurant
// is reporting an untaxed sale — which is a compliance problem, not a display bug. Migration 154
// says it in as many words ("it must not enter subtotal/tax/discount/total") and this keeps it true.
//
// It also guards the half the owner asked for on 2026-08-28: the tip is entered the way a discount
// is — three linked boxes, one of which is the TOTAL the customer handed over — on BOTH panels that
// take money. The waiter tablet had no tip control at all until that day, so every tip a waiter
// collected was invisible to the tips report while the manager's screen could record one.
//
//   node scripts/verify-tip.mjs
//
// Static + behavioural: it runs billdoc's own tip maths, so a wrong answer fails here rather than
// on a customer's paper.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };
const BILLDOC = require(join(ROOT, "public/panels/billdoc.js"));

let pass = 0; const fails = [];
const ok = (m) => { pass++; console.log(`  ok   ${m}`); };
const bad = (m, why) => { fails.push(m); console.log(` FAIL  ${m}${why ? `\n         ${why}` : ""}`); };
const check = (cond, m, why) => (cond ? ok(m) : bad(m, why));

const editor = read("public/panels/editor/app.js");
const tablet = read("public/panels/tablet/app.js");
const billdoc = read("public/panels/billdoc.js");
const dts = read("public/panels/billdoc.d.ts");
const editorApi = read("app/api/editor/[...path]/route.ts");
const tabletApi = read("app/api/tablet/[...path]/route.ts");
const mig154 = read("supabase/migrations/154_order_tip.sql");

console.log("\nA TIP IS NOT PART OF THE SALE\n");

// ── 1 · the money rule, the one that matters legally ──────────────────────────────────────────
check(/must not enter subtotal\/tax\/\s*\n?--\s*discount\/total|not.*enter.*subtotal/i.test(mig154) || /tip/i.test(mig154),
  "migration 154 still states the rule the whole feature rests on",
  "if that migration is gone, the column's contract is gone with it");

// The tip must never appear in the functions that build the bill's own money.
{
  const billMoney = billdoc.slice(billdoc.indexOf("function billMoney"), billdoc.indexOf("function billData"));
  const billRows = billdoc.slice(billdoc.indexOf("function billRows"), billdoc.indexOf("function billRows") + 4000);
  check(!/\btip\b/i.test(billMoney), "billMoney() — which computes the sale — does not know what a tip is",
    "a tip inside the bill math is an untaxed sale on a tax invoice");
  check(!/\btip\b/i.test(billRows), "billRows() — the rows that must foot to the TOTAL — does not know what a tip is",
    "every row above TOTAL has to add up to it; a tip is not one of them");
}

// On paper, the tip must come AFTER the TOTAL line, never before it.
{
  const at = (s) => billdoc.indexOf(s);
  const totalRow = billdoc.lastIndexOf('<div class="g"><span>TOTAL</span>');
  const tipRow = at('<span>Tip');
  check(tipRow > totalRow && totalRow > 0,
    "the printed tip sits BELOW the TOTAL row, not among the rows that foot to it",
    "above the line it reads as a bigger sale on which no tax was charged");
  check(/<span>PAID<\/span>/.test(billdoc),
    "…and the cash actually handed over is stated as its own PAID line",
    "the customer should be able to see the figure they recognise");
}

// ── 2 · the maths, run rather than read ───────────────────────────────────────────────────────
{
  const t = BILLDOC.tipFromPaid;
  check(t(3000, 3200) === 200, "bill 3000, they hand over 3200 → a 200 tip (the owner's own example)");
  check(t(3000, 3000) === 0, "handing over exactly the bill is not a tip");
  check(t(3000, 2900) === 0, "handing over LESS than the bill is a part payment, not a negative tip",
    "a negative tip would quietly reduce the day's tip total");
  check(t(0, 500) === 500, "a tip on a zero bill is still a tip (an on-the-house table can be tipped)");
  check(t(100.5, 200.25) === 99.75, "paise survive the subtraction");
  check(BILLDOC.tipPct(3000, 300) === "10%", "a round percentage reads clean");
  check(BILLDOC.tipPct(3000, 225) === "7.5%", "anything else keeps one decimal");
  check(BILLDOC.tipPct(3000, 0) === "" && BILLDOC.tipPct(0, 100) === "", "nothing to say → nothing said");
  check(typeof BILLDOC.TIP_MAX === "number" && BILLDOC.TIP_MAX > 0, "the panels can see the server's own ceiling");
}

// The printed document, rendered.
{
  const rowsOf = (h) => h.split("\n").filter((l) => /TOTAL|PAID|>Tip/.test(l))
    .map((l) => l.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
  const base = { name: "T", subtotal: 3000, discount: 0, total: 3000, taxIncluded: false };
  const none = rowsOf(BILLDOC.billDocHtml({ ...base, tip: 0 }));
  const tipped = rowsOf(BILLDOC.billDocHtml({ ...base, tip: 200 }));
  const cancelled = rowsOf(BILLDOC.billDocHtml({ ...base, tip: 200, cancelled: true }));
  check(!none.some((r) => /Tip|PAID/.test(r)), "no tip → the bill prints exactly as it always did");
  check(tipped.some((r) => /^TOTAL ₹3,000$/.test(r)), "with a tip, the TOTAL is still what was CHARGED",
    "the taxed figure may not move because someone left extra");
  check(tipped.some((r) => /Tip \(6\.7%\) \+ ₹200/.test(r)), "…the tip is stated with the percentage it works out to");
  check(tipped.some((r) => /PAID ₹3,200/.test(r)), "…and PAID is the cash that actually changed hands");
  check(!cancelled.some((r) => /Tip|PAID/.test(r)), "a CANCELLED bill prints no tip",
    "it charges nothing and says so; a tip line there is money on a sale that never happened");
}

console.log("\nENTERED LIKE A DISCOUNT, ON BOTH PANELS THAT TAKE MONEY\n");

// ── 3 · the three linked boxes, on both panels ────────────────────────────────────────────────
for (const [name, src, ids] of [
  ["the manager panel", editor, ["payTipPct", "payTipInput", "payPaidInput"]],
  ["the waiter tablet", tablet, ["pay-tip-pct", "pay-tip-amt", "pay-tip-paid"]],
]) {
  const missing = ids.filter((i) => !src.includes(i));
  check(missing.length === 0, `${name} has all three tip boxes — percent, amount, and the total they paid`,
    missing.length ? `missing: ${missing.join(", ")} — the third one is the one he asked for ("they gave me 3200")` : "");
  check(/typing !== "paid"|typing !== "pct"/.test(src) || /paintTip/.test(src),
    `${name} refreshes the other boxes without clobbering the one being typed in`,
    "rewriting the box under the caret is how a half-typed number turns into a wrong one");
  check(/raw === "" \|\| !\(p >= 0\)/.test(src),
    `${name} treats a blank "they paid" box as "about to type", never as ₹0`,
    "deleting three characters must not silently wipe a tip that was already entered");
}

// ── 4 · the tablet can actually record one ────────────────────────────────────────────────────
check(/a === "orders" && c === "tip"/.test(tabletApi),
  "the waiter tablet's server has a tip route at all",
  "without it the panel your waiters take money on cannot record a tip — every floor tip is invisible");
check(/tabletPerm\("tablet_mark_paid"[\s\S]{0,400}?orders.*tip|c === "tip"[\s\S]{0,300}?tablet_mark_paid/.test(tabletApi),
  "…gated on tablet_mark_paid, because taking a tip happens at a settle and nowhere else");
for (const [name, api] of [["the manager", editorApi], ["the tablet", tabletApi]]) {
  // 2000, not 900: both blocks open with a long note explaining WHY a tip is not part of the sale,
  // and a window that stops inside the comment reports the write it never reached as missing.
  const block = api.slice(api.indexOf('c === "tip"'), api.indexOf('c === "tip"') + 2000);
  check(/100000/.test(block), `${name} API caps a single tip, so a mis-typed 500000 cannot land in the day-close figure`);
  check(/update\(\{ tip: amt \}\)/.test(block), `${name} API writes the tip and nothing else`,
    "a tip write that touches another column is a tip write that can change a bill");
}

// ── 5 · a tip is somebody's money — losing it is never silent ─────────────────────────────────
for (const [name, src] of [["the manager panel", editor], ["the waiter tablet", tablet]]) {
  // COMMENTS ARE NOT CODE. The first version of this scanned the raw text either side of the call
  // and found two "empty catches" — both of them inside the comment that explains why there is no
  // empty catch. A guard that reads its own prose as evidence is a guard that invents a failure.
  // So: strip comments, then look only AFTER the call, at the catch actually attached to it.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  // Either quoting style: the manager writes "…/tip" and the tablet a `…/tip` template literal.
  // Looking for one form only made this pass on a file it had never actually read.
  const at = (code.match(/\/tip["`]/) || { index: -1 }).index;
  const near = at < 0 ? "" : code.slice(at, at + 500);
  check(at >= 0 && !/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(near),
    `${name} does not swallow a failed tip write`,
    "the bill settles, the screen looks finished, and the money is nowhere — it said 'tip is non-critical'");
  check(/tip was not recorded/.test(src), `…${name} says so in words a person can act on`);
}

// ── 6 · one tip per bill, asked once ──────────────────────────────────────────────────────────
// ONE TIP PER BILL, HOWEVER THE BILL CLOSES (owner, 2026-08-28, option A: a tip on every part is
// how you double it). The tablet's in-sheet split was replaced by the shared split SCREEN on
// 2026-08-28, so the shape this asserted is gone — the rule is not. What has to be true now is
// that every way out of the payment sheet records the tip exactly once, including the door to the
// split screen, where it would otherwise be lost the moment the sheet closes.
{
  const flow = tablet.slice(tablet.indexOf("async function payBillWithMethod"),
    tablet.indexOf("async function captureCustomer"));
  const calls = (flow.match(/recordTip\(/g) || []).length;
  const exits = ["special === \"split\"", "special === \"onhouse\"", "special === \"khata\""]
    .filter((e) => new RegExp(e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(flow));
  const missed = exits.filter((e) => {
    const at = flow.search(new RegExp(e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    return !/recordTip\(/.test(flow.slice(at, at + 320));
  });
  check(calls >= 3 && missed.length === 0,
    "every way out of the payment sheet records the tip once — including the door to the split screen",
    `recordTip called ${calls}x across ${exits.length} special exits${missed.length ? "; NOT on: " + missed.join(", ") : ""}`);
  check(!/tip per part|splitLegs[\s\S]{0,120}tip/.test(flow),
    "…and never once per part",
    "a tip on every part of a split is how you double it");
}
check(/resolve\(\{ special: b\.dataset\.special, tip \}\)/.test(tablet),
  "a bill settled on the house or put on a tab still carries its tip",
  "the BILL being free does not make the cash handed over for the staff disappear");

// ── 7 · the types name it ─────────────────────────────────────────────────────────────────────
check(/\btip\?: number;/.test(dts), "BillDocData declares the tip, so a TypeScript caller can render one");
check(/export function tipFromPaid|export function tipPct/.test(dts), "the shared tip maths is reachable by name");

console.log(`\n${fails.length ? "❌" : "✅"} tip: ${pass} passed, ${fails.length} failed\n`);
process.exit(fails.length ? 1 : 0);
