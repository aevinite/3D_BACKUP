// verify-print-format.mjs — the bill and the kitchen ticket exist in ONE place.
//
//   npm run verify:print-format
//
// WHY (owner, 2026-08-02). He printed a KOT from the manager panel, looked at the KOT in the
// admin's Access → "Format of…" preview, and they were different documents. They were: this
// product had SIX templates for two pieces of paper — the manager's printBill(), the kitchen
// board's printKot(), the manager's kotTicketHtml(), lib/billPreview.ts, and two more inside
// components/admin/RestaurantSettings.tsx. An admin could set a bill up, approve the preview,
// and a guest would be handed something else. His instruction was "both should be sync".
//
// Sync is not a state you reach, it is a state you keep, and hand-keeping two copies of a
// stylesheet in step is exactly the job nobody does. So there is now ONE description of each
// document — public/panels/billdoc.js — and this check fails the moment a second one appears.
//
// It is static: no database, no login, no browser, no dev server. Runs in well under a second.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m, detail) => { fails++; console.log(`  FAIL ${m}`); if (detail) console.log(`         ${detail}`); };

const DOC = "public/panels/billdoc.js";
const BILLDOC = require(join(ROOT, DOC));

// ── 1. the one file exists and exports both documents ────────────────────────────────────
for (const fn of ["billDocHtml", "kotDocHtml", "kotLineHtml", "billIdentity", "splitTax"]) {
  if (typeof BILLDOC[fn] === "function") ok(`${DOC} exports ${fn}()`);
  else bad(`${DOC} does not export ${fn}()`, "every printer and every preview calls through these");
}

// ── 2. NOBODY ELSE draws either document ──────────────────────────────────────────────────
// Fingerprints, not whole templates: a copy is recognisable by the markup it must contain.
// Each is checked against every file that could plausibly print, minus the one that should.
const SURFACES = [
  "public/panels/editor/app.js",
  "public/panels/kitchen/app.js",
  "public/panels/tablet/app.js",
  "lib/billPreview.ts",
  "components/admin/RestaurantSettings.tsx",
  "app/api/admin/restaurants/bill-preview/route.ts",
];
// Deliberately narrow: `.kl` alone appears in the manager's performance report (a KPI label),
// and the STRING "KITCHEN TICKET" is legitimate as data passed to the shared document. What
// only a second copy of the ticket can have is its own stylesheet and its own header markup.
const COPIES = [
  { what: "the kitchen ticket", mark: /\.kl \.q\{|<div class="h">\$\{esc\(|>KITCHEN TICKET<\/h2>|<div class="h">.*KITCHEN TICKET/ },
  { what: "the bill", mark: /<div class="kind">Tax Invoice<\/div>|<th class="r">Amt<\/th>|\.totals\{margin-top/ },
];
for (const file of SURFACES) {
  const src = read(file);
  if (!src) { bad(`${file} is missing`, "the list of print surfaces is out of date — fix this file's list"); continue; }
  const found = COPIES.filter((c) => c.mark.test(src)).map((c) => c.what);
  if (found.length) {
    bad(`${file} draws ${found.join(" and ")} itself`,
      `move the markup into ${DOC} and call LFH_BILLDOC — a second copy is how the preview and the printer drift apart`);
  } else ok(`${file} draws neither document itself`);
}

// ── 3. every printer and preview actually goes through the shared file ────────────────────
const USERS = [
  ["public/panels/editor/app.js", /LFH_BILLDOC\.billDocHtml\(/, "the manager panel's bill"],
  ["public/panels/editor/app.js", /LFH_BILLDOC\.kotDocHtml\(/, "the manager panel's kitchen ticket"],
  ["public/panels/kitchen/app.js", /LFH_BILLDOC\.kotDocHtml\(/, "the kitchen board's ticket"],
  ["lib/billPreview.ts", /BILLDOC\.billDocHtml\(/, "the Access bill preview"],
  ["lib/billPreview.ts", /BILLDOC\.kotDocHtml\(/, "the Access KOT preview"],
  ["components/admin/RestaurantSettings.tsx", /BILLDOC\.billDocHtml\(/, "the settings form's bill preview"],
  ["components/admin/RestaurantSettings.tsx", /BILLDOC\.kotDocHtml\(/, "the settings form's KOT preview"],
];
for (const [file, mark, label] of USERS) {
  if (mark.test(read(file))) ok(`${label} renders the shared document`);
  else bad(`${label} no longer renders the shared document`, `${file} should call the ${String(mark)} entry point`);
}

// ── 4. the panels can actually LOAD it (a missing script tag = a blank print) ──────────────
for (const panel of ["editor", "kitchen"]) {
  const html = read(`public/panels/${panel}/index.html`);
  const tag = /<script src="\/panels\/billdoc\.js(\?v=[^"]*)?"><\/script>/.exec(html);
  if (!tag) { bad(`the ${panel} panel does not load /panels/billdoc.js`, "printing would throw LFH_BILLDOC is not defined"); continue; }
  // Load order matters: app.js calls it, so it has to be there first. Compare the SCRIPT TAGS,
  // not any mention of "app.js" — both files talk about it in their comments.
  const appTag = /<script src="[^"]*app\.js[^"]*"><\/script>/.exec(html);
  if (!appTag) { bad(`the ${panel} panel has no app.js script tag`, "the panel would not run at all"); continue; }
  if (html.indexOf(tag[0]) < html.indexOf(appTag[0])) ok(`the ${panel} panel loads billdoc.js before app.js`);
  else bad(`the ${panel} panel loads billdoc.js AFTER app.js`, "move the tag above app.js");
}

// ── 5. the documents still carry the rules that make paper come out right ─────────────────
// Each of these was a real fault: a two-page ticket, a sideways print, a 20cm blank lead-in,
// a repeated table header mid-bill, a toolbar printed onto the roll.
const bill = BILLDOC.billDocHtml({
  name: "Test", lines: [{ title: "A dish", qty: 2, price: 120, options: [{ label: "Add-on", price: 20 }] }],
  subtotal: 240, discount: 20, discLabel: "8.3%", taxable: 220, total: 231,
  taxRows: BILLDOC.splitTax(11, [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }]),
  tableDisp: "A5", dateStr: "2/8/2026 18:04", autoPrint: true,
});
const kot = BILLDOC.kotDocHtml({
  rname: "Test", kot: 7, tableLabel: "A5", when: "18:04",
  lines: [{ qty: 2, title: "A dish", note: "no ice" }], allergies: ["nuts"],
});
const RULES = [
  [bill, "@page{margin:0}", "the bill kills the browser's own header/footer"],
  [bill, "thead{display:table-row-group}", "the bill prints its item header once, not on every page"],
  [bill, "@media print{.bar{display:none !important}}", "the bill's toolbar never reaches the paper"],
  [bill, 'class="g"', "the bill has its TOTAL rule"],
  [kot, "@page{margin:0}", "the ticket stays on ONE piece of paper"],
  [kot, "break-inside:avoid", "a ticket line is never split across pages"],
];
for (const [doc, needle, label] of RULES) {
  if (doc.includes(needle)) ok(label);
  else bad(`${label} — the rule is gone`, `expected to find: ${needle}`);
}
// A KOT IS FOR THE KITCHEN, NOT A BILL: it must never carry money.
if (!/₹|Subtotal|TOTAL/.test(kot)) ok("the kitchen ticket carries no prices");
else bad("the kitchen ticket now shows money", "a KOT is for the kitchen — prices belong on the bill only");
// A real print prints itself; a preview waits to be looked at.
if (bill.includes("setTimeout(printAgain, 300)")) ok("a real bill opens the print dialog by itself");
else bad("a real bill no longer prints itself", "autoPrint should schedule printAgain()");
const preview = BILLDOC.billDocHtml({ name: "Test", lines: [], note: "a sample" });
if (preview.includes("setTimeout(measure, 300)") && !preview.includes("setTimeout(printAgain, 300)")) {
  ok("a preview measures the page but does not print by itself");
} else bad("a preview fires the print dialog on its own", "only autoPrint should do that");
// The window closes on its own ✕ only — never on afterprint (Print and Cancel are the same event).
if (/onafterprint = function\(\)\{[^}]*focus/.test(bill) && !/onafterprint[^\n]*close\(\)/.test(bill)) {
  ok("the bill window is never closed by the afterprint event");
} else bad("the bill window closes itself on afterprint", "pressing Cancel would throw the bill away (PR #716)");

// ── 6. ONE NUMBERING SERIES (mig 261, owner 2026-08-02) ───────────────────────────────────
// "Make sure it is continuing — parcel or any kind of Zomato, Swiggy, everywhere it will
// continue the invoice number and the bill number, to keep the track." A parcel receipt used to
// print with a blank Invoice line and no Bill no at all, because printParcelReceipt() hardcoded
// both to null and aggregator_orders had no such columns.
const MIG = "supabase/migrations/261_parcel_platform_bill_numbers.sql";
const mig = read(MIG);
if (!mig) bad(`${MIG} is missing`, "parcel and delivery bills would go out unnumbered again");
else {
  /lfh_next_counter\(v_rid, 'bill'\)/.test(mig) && /lfh_next_seq\(v_rid, 'invoice'\)/.test(mig)
    ? ok("parcel/delivery numbers come from the SAME two counters dine-in uses")
    : bad("the numbering no longer draws on the shared counters", "a private counter = three parallel series, not one");
  /BEFORE INSERT ON public\.aggregator_orders/.test(mig)
    ? ok("every insert path is numbered (a trigger, not a caller)")
    : bad("the numbers are not stamped by an insert trigger", "a new insert path would silently go unnumbered");
  /IF NEW\.invoice_no IS NULL THEN/.test(mig)
    ? ok("an order that already has an invoice number is never renumbered")
    : bad("the trigger can overwrite an existing invoice number", "an issued invoice number must never change");
}
const panel = read("public/panels/editor/app.js");
/bill_no: o\.bill_no != null \? o\.bill_no : null/.test(panel) && /invoice_no: o\.invoice_no != null/.test(panel)
  ? ok("the parcel receipt prints the numbers off the order row")
  : bad("printParcelReceipt no longer passes the bill/invoice numbers", "the paper would print blank where a table bill shows them");
/bill_no,invoice_no,invoice_at/.test(read("app/api/editor/[...path]/route.ts"))
  ? ok("the parcel board sends those numbers to the panel")
  : bad("the platform board query dropped bill_no/invoice_no", "the panel cannot print what it was not sent");
// And the parcel line itself: his rule is the ONLY difference from a table bill.
const parcelBill = BILLDOC.billDocHtml({ name: "Test", lines: [], parcel: true, tableDisp: "T5", dateStr: "x" });
/<div class="kv"><span>Parcel<\/span><b><\/b><\/div>/.test(parcelBill) && !/<span>Table<\/span>/.test(parcelBill)
  ? ok('a parcel bill says "Parcel" with no number, and has no Table row')
  : bad("the parcel bill's top line is wrong", 'it must read "Parcel" with nothing where the table number goes');

console.log(fails
  ? `\n${fails} check(s) FAILED — the bill or the ticket has more than one description again.`
  : "\nAll checks passed — one bill, one ticket, one file, one numbering series.");
process.exit(fails ? 1 : 0);
