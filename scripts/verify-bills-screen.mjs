#!/usr/bin/env node
// verify:bills-screen — the Bills record screen keeps the shape the owner chose.
//
// ── WHY (owner, 2026-08-22) ──────────────────────────────────────────────────────────────────────
// Shown three mock-ups, he picked the third: *"I liked the 3rd one, do it"* — a slim list of bills
// with the bill it points at rendered beside it. In the same breath he asked for the things the old
// screen could not do:
//
//   · *"make sure of all possible scenario like when the bill is splited in both cash and upi"* —
//     a split bill is stored as ONE paid bill whose method is the word "Split", with the parts in
//     `session_payments`. Every screen printed that bare word and the parts existed nowhere a
//     person could look, so "₹200 UPI, ₹200 cash" had no answer on the one screen that exists to
//     answer questions about a bill.
//   · *"in the view add the invoice or bill no"* — BOTH, and each saying its own truth: a bill
//     number exists from the moment the tab opens, an invoice number only once it is issued, and
//     after a reopen the old one is retired rather than reused.
//   · *"make sure serch also dynamic … even through i serch last 3 didgit of invoice"* — one box,
//     no type dropdown, matching every field.
//
// ── WHAT THIS GUARDS, AND WHY EACH ONE ──────────────────────────────────────────────────────────
// Each check is here because the thing it asserts was ADDED for him and would be invisible if it
// silently went away — a split bill would quietly read "Split" again, or the search would quietly
// go back to needing a dropdown, and nothing would look broken.
//
// It asserts SHAPE, not wording: the parts block must exist and must read `session_payments`, but
// what the sentence above it says is free to change. A guard that pins prose goes red on a reword,
// which is how a guard stops being trusted.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");
/**
 * LINE comments blanked only. A `/*…*\/` stripper silently eats these files — measured on
 * app/api/editor/[...path]/route.ts: 42 KB gone, taking the very function being checked with it,
 * so the guard reported a pass over a live fault. (T25, 2026-08-21.)
 */
const code = (t) => t.replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ");

let failed = 0;
const pass = (m) => console.log("  ok   " + m);
const fail = (m) => { console.log("  FAIL " + m); failed++; };

const panel = read("public/panels/editor/app.js");
const panelCode = code(panel);
const route = read("app/api/editor/[...path]/route.ts");
const routeCode = code(route);
const css = read("public/panels/editor/style.css");

if (!panel || !route) { console.log("  FAIL could not read the panel or the editor route"); process.exit(1); }

// ── 1. the layout he chose still exists ───────────────────────────────────────────────────────
// ⚠️ NO LEADING DOT when looking in the JS. The panel writes `class="bill-split"`; the dot only
// exists in the stylesheet. The first draft searched the JS for ".bill-split" and reported the
// layout as GONE while it was right there — the fourth time in this sweep a guard accused correct
// code, and the same lesson each time: run a new guard against the file it names before believing
// it. The CSS side is checked separately, WITH the dot, just below.
for (const [needle, what] of [
  ["bill-split", "the list-beside-the-bill layout"],
  ["bill-line", "the slim bill lines"],
  ["billReceiptHtml", "the bill pane"],
]) {
  if (new RegExp("\\b" + needle.replace(/-/g, "\\-") + "\\b").test(panelCode)) pass(`${what} is there (${needle})`);
  else fail(`${what} is gone (${needle}) — he chose this layout on 2026-08-22 from three options`);
}
if (/\.bill-split\b/.test(css)) pass("the layout has its stylesheet rules");
else fail("public/panels/editor/style.css has no .bill-split rules — the layout would render unstyled");

// ── 2. ONE search box, and it searches every field ───────────────────────────────────────────
if (/\bdata-bill-stype\b/.test(panelCode)) {
  fail("the bills TYPE DROPDOWN is back (data-bill-stype) — one box searches every field now, so a person never has to say which field they meant first");
} else pass("no type dropdown — one box");
if (/\b(?:function|const)\s+billMatches\b/.test(panelCode)) pass("billMatches() is the one search rule");
else fail("billMatches() is gone — the universal bills search");
// The last-digits behaviour: the invoice number must be compared in a PADDED form, which is what
// makes "42", "042" and "000042" all find invoice 42 and "042" also find 1042.
if (/padStart\(\s*6\s*,\s*["']0["']\s*\)/.test(panelCode)) pass("an invoice number is matched in its padded form, so the last digits find it");
else fail("the invoice number is no longer padded before matching — 'search the last 3 digits of invoice' stops working");
// A state word must be matched WHOLE, or "paid" matches every "unpaid" bill (measured: 81 of 81).
if (/\bBILL_STATE_TERMS\b/.test(panelCode)) pass("state words are matched whole, so `paid` and `unpaid` stay two questions");
else fail("BILL_STATE_TERMS is gone — `paid` will match every `unpaid` bill again (it matched 81 of 81 before this)");

// ── 3. a SPLIT bill shows its parts ──────────────────────────────────────────────────────────
// A READ of the table, not a MENTION of it. `/session_payments/` passed while the read had been
// deleted, because a nearby comment still named it — and because it also matches
// "session_paymentsX". Every pattern in this guard now requires a real boundary or a real call
// shape, which is the fifth time this sweep that a prefix match made a guard blind.
// SPECIFIC TO THE BILLS PATH. The route reads `session_payments` in THREE places (the khata
// summary and the split WRITE predate this work), so "does the route mention the table" cannot
// tell whether the BILLS read survived — it stayed green with that read deleted. The test is the
// assignment that carries the parts onto the bill, which only this feature does.
if (/\bo\.pay_parts\s*=/.test(routeCode)) pass("the bills read attaches the split parts to each bill (o.pay_parts)");
else fail("the bills read no longer attaches o.pay_parts — a split bill would print the bare word 'Split' again with the parts nowhere to be seen");
if (/\bpay_parts\b/.test(routeCode) && /\bpay_parts\b/.test(panelCode)) pass("the parts are carried to the panel and read there (pay_parts)");
else fail("`pay_parts` is missing on one side — the split breakdown cannot render");
if (/\bbr-parts\b/.test(panelCode) && /\.br-parts\b/.test(css)) pass("the parts block renders and is styled");
else fail("the split-parts block or its styles are gone (.br-parts)");
// A pay-later LEG (mig 352) is a tab, not money taken — it must not be summed as collected.
if (/"Pay later"/.test(panelCode) && /\bbr-part-tab\b/.test(panelCode)) pass("a pay-later leg of a split is shown as owed, not as money taken (mig 352)");
else fail("the pay-later leg of a split is no longer told apart from collected money");

// ── 4. BOTH numbers, each able to say it has none ────────────────────────────────────────────
if (/Bill no\./.test(panel) && /Invoice no\./.test(panel)) pass("the pane shows Bill no. AND Invoice no.");
else fail("the pane no longer shows both numbers — he asked for them on 2026-08-22");
if (/not issued yet/.test(panel)) pass("a bill with no invoice yet says so, rather than printing a dash");
else fail("'not issued yet' is gone — an unissued invoice would read the same as a missing one");

// ── 5. no dead controls ──────────────────────────────────────────────────────────────────────
// The actions offered must depend on the bill's state, or a settled bill shows "Mark paid".
const acts = panelCode.slice(panelCode.indexOf("function billReceiptActions"));
const actsBody = acts.slice(0, acts.indexOf("\n}"));
if (/st === "cancelled"/.test(actsBody) && /st === "settled"/.test(actsBody)) {
  pass("the pane's buttons branch on the bill's state — no 'Mark paid' on a settled bill");
} else fail("billReceiptActions() no longer branches on state — it would offer actions the bill cannot take");

// ── 6. the money is not re-derived here ──────────────────────────────────────────────────────
// The one-number rule: this screen displays, it does not calculate. It must use the SHARED stack.
// …and specific to THIS pane. `mrpTotalsRows` is called from three screens, so a bare mention
// proves nothing about the one being guarded — it stayed green with the call in billReceiptHtml
// changed. Look inside the function.
const rcp = panelCode.slice(panelCode.indexOf("function billReceiptHtml"));
const rcpBody = rcp.slice(0, rcp.indexOf("\n}"));
if (/\bmrpTotalsRows\s*\(/.test(rcpBody)) pass("the bill pane's totals come from the shared stack, not from arithmetic of its own");
else fail("billReceiptHtml() no longer uses the shared totals stack — a discount, an MRP line or a composition-scheme restaurant would be re-derived here and could disagree with the printed bill");

// ── 7. the dish lines a receipt shows are the ones its total counts (sweep #10 T6, 2026-10-12) ──
// billMath() leaves a cancelled ticket out of the money, so the pane must leave its dishes out of
// the lines: the owner's 2026-07-03 screenshot was "Litchi Cooler ₹229 … Total ₹0", fixed in the
// bill modal then, and brought back by this pane on 2026-08-22 (it drew ordItemsHtml(g) over every
// ticket, cancelled ones included). DRIVEN, not grepped: the real functions are lifted out of the
// panel and run against a cancelled bill and a part-cancelled one.
{
  const lift = (name) => {
    let i = panel.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
    if (i >= 0) { i += 1; let d = 0, j = panel.indexOf("{", i); for (; j < panel.length; j++) { if (panel[j] === "{") d++; else if (panel[j] === "}" && --d === 0) break; } return panel.slice(i, j + 1); }
    const k = panel.search(new RegExp(`\\nconst ${name} = `));
    if (k < 0) return "";
    // To the end of THIS statement: its ";" may be followed by a trailing comment on the same line.
    const end = panel.slice(k + 1).search(/;[ \t]*(\/\/[^\n]*)?\n/);
    return panel.slice(k + 1, k + 1 + end + 1);
  };
  const names = ["esc", "INR_RATE", "inr", "mrpPill", "dishNoTag", "ordItemsHtml", "billLiveLinesHtml"];
  const parts = names.map(lift);
  if (parts.some((p) => !p)) fail(`could not lift ${names.filter((_, i) => !parts[i]).join(", ")} out of the panel — re-derive this check`);
  else {
    const run = new Function("state", parts.join("\n") + "\nreturn billLiveLinesHtml;");
    const lines = run({ data: { items: [] } });
    const o = (title, status) => ({ status, items: [{ title, qty: 1, price: 229 }] });
    const allCancelled = lines([o("Litchi Cooler", "cancelled")]);
    const mixed = lines([o("Litchi Cooler", "cancelled"), o("Masala Chai", "served")]);
    if (!/Litchi Cooler/.test(allCancelled) && /cancelled/i.test(allCancelled)) pass("a cancelled bill's pane lists no priced dish — it says it was cancelled");
    else fail("a cancelled bill's pane lists its dishes with prices over a ₹0 total — the 2026-07-03 screen is back");
    if (!/Litchi Cooler/.test(mixed) && /Masala Chai/.test(mixed)) pass("a part-cancelled bill lists only the tickets its total counts");
    else fail("a part-cancelled bill lists a cancelled ticket's dishes — the lines no longer add up to the subtotal under them");
  }
  const pane = panelCode.slice(panelCode.indexOf("function billReceiptHtml"));
  const paneBody = pane.slice(0, pane.indexOf("\n}"));
  if (/br-items[^\n]*billLiveLinesHtml\(g\)/.test(paneBody)) pass("the bill pane draws its lines through billLiveLinesHtml()");
  else fail("billReceiptHtml() no longer draws its lines through billLiveLinesHtml() — a cancelled ticket's priced dishes can reach the pane");
}

// ── 8. a FAILED read of the record is not shown as a slow one (sweep #10 T6, 2026-10-12) ──────────
// The skeleton ("Still reading — a long day takes a moment.") is drawn while state.billsRec has never
// landed. A failed read left it null for ever, so with no signal the screen promised progress that
// was not happening, over bills the device already held. The catch must remember the failure, the
// skeleton must step aside for it, and the view must say in words what it is showing instead.
{
  const lb = panelCode.slice(panelCode.indexOf("async function loadBillsRecord("));
  const lbBody = lb.slice(0, lb.indexOf("\n}"));
  /catch \(e\) \{[\s\S]*state\.billsRecErr = \{/.test(lbBody)
    ? pass("a failed bills read is remembered (state.billsRecErr), not swallowed")
    : fail("loadBillsRecord() swallows a failed read — Previous bills would show 'still reading' for ever");
  /if \(!state\.billsRec && state\.billsRecErr && Date\.now\(\) - state\.billsRecErr\.at </.test(lbBody)
    ? pass("…and retried on a gentle clock, not on every repaint")
    : fail("a failed bills read is retried on every repaint — a poll by another name");
  const pv = panelCode.slice(panelCode.indexOf("function ordersPreviousHtml("));
  const pvBody = pv.slice(0, pv.indexOf("\nfunction "));
  /if \(!state\.billsRec && !state\.billsRecErr\) \{/.test(pvBody)
    ? pass("the 'still reading' skeleton steps aside once the read has failed")
    : fail("the skeleton is drawn whenever the record is missing — including after the read FAILED");
  /const partial = !state\.billsRec && state\.billsRecErr/.test(pvBody) && /these are the bills this device already has/.test(pv.slice(0, pvBody.length + 2000) + panel)
    ? pass("…and the view says in words that it is showing what the device holds")
    : fail("after a failed read the record view says nothing about showing only what the device holds");
}

console.log(failed
  ? `\n✗ verify:bills-screen — ${failed} check${failed === 1 ? "" : "s"} failed.`
  : "\n✓ verify:bills-screen — the layout, the one-box search, the split parts and both numbers are all in place");
process.exit(failed ? 1 : 0);
