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
  // The BANQUET sheet, fingerprinted from 2026-08-04. It was the last document that still existed
  // twice — the manager printed one, the admin's "See the banquet bill" drew another, and they had
  // already parted company over the frozen tax lines and the A4/A5 paper setup. Its own markup is
  // recognisable by the amount-in-words row and the Authorised Signatory block.
  { what: "the banquet bill", mark: /class="wrd"|<div class="sign">For |<th rowspan="2">Sr<\/th>/ },
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
  // The settings form's bill preview may reach the shared document EITHER WAY: by calling it
  // directly, or by calling billPreviewHtml() — the one builder of the sample bill, which the
  // line above already proves calls BILLDOC.billDocHtml. Going through billPreviewHtml is the
  // STRONGER form, not a weaker one: since mig 270 the sample's figures depend on the price
  // modes (GST on top / inside / composition scheme, and MRP lines), and a second copy of those
  // sums on this screen is exactly how a composition restaurant got shown a bill with CGST and
  // SGST rows it may not legally print. So accept both shapes and keep rejecting a hand-rolled
  // <html> of its own, which check 2 above is what actually catches.
  ["components/admin/RestaurantSettings.tsx", /BILLDOC\.billDocHtml\(|billPreviewHtml\(/, "the settings form's bill preview"],
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
// ── THE REPRINT BANNER (mig 269, owner 2026-08-04: "duplicate in big words on top") ──────
// One flag, drawn by the shared document only: a reprinted ticket carries the big bordered
// banner ABOVE everything; a fresh ticket must never carry it (a first print branded
// "DUPLICATE" would be a lie on paper).
const kotDup = BILLDOC.kotDocHtml({ rname: "Test", kot: 7, tableLabel: "A5", lines: [], reprint: true });
if (/<div class="rp">[^<]*Reprint[^<]*Duplicate[^<]*<\/div>/i.test(kotDup)) ok("a reprinted ticket carries the REPRINT · DUPLICATE banner");
else bad("the reprint banner is gone from the shared ticket", 'kotDocHtml({ reprint: true }) must render <div class="rp">…Reprint · Duplicate…</div>');
if (kotDup.indexOf('class="rp"') < kotDup.indexOf('class="h"')) ok("the banner sits ABOVE the ticket header — 'in big words on top'");
else bad("the reprint banner is not at the top of the ticket", "the owner asked for it on top, above everything");
if (/font-size:1[6-9]px/.test(kotDup) && /\.rp\{[^}]*text-transform:uppercase/.test(kotDup)) ok("the banner is big and uppercase");
else bad("the banner is no longer big/uppercase", "the .rp rule should keep ≥16px + text-transform:uppercase");
if (!/class="rp"/.test(kot)) ok("a fresh ticket carries no duplicate banner");
else bad("a FRESH ticket now prints the DUPLICATE banner", "reprint:false/absent must render a clean ticket");
// Nobody draws the banner by hand: the flag is the only way to a duplicate ticket.
// (The markup fingerprint, not the words — panels legitimately SAY "duplicate" in toasts.)
for (const file of SURFACES) {
  if (/class="rp"/.test(read(file))) bad(`${file} draws its own duplicate banner`, "pass reprint:true to the shared document instead");
}
ok("no surface draws its own duplicate banner");

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

// ── 7. THE BILL ADDS UP (2026-08-04) ──────────────────────────────────────────────────────
// Every row was rounded to whole rupees on its own while the TOTAL was rounded from full
// precision, so a DISCOUNTED bill's rows contradicted its own total 32.7% of the time (measured:
// 7,468 of 22,806 over the discounts the modal offers). Undiscounted bills were always fine,
// which is how it survived so long. These replay the document itself and read the RENDERED rows
// back out of the HTML — asserting what a person holding the paper can add up, not what we think
// we computed. The money charged is never changed: the TOTAL is the anchor and a "Round off" row
// carries whatever the whole-rupee rows cannot express.
const readRows = (html) => {
  const num = (s) => (s ? parseInt(String(s).replace(/[^0-9]/g, ""), 10) || 0 : 0);
  const one = (re) => { const m = re.exec(html); return m ? m[1] : ""; };
  const rowOf = (label) => one(new RegExp(`<div class="t[^"]*"><span>${label}[^<]*</span><span>([^<]*)</span>`));
  const roundRaw = rowOf("Round off");
  return {
    subtotal: num(one(/<span>Subtotal<\/span><span>([^<]*)</)),
    discount: num(rowOf("Discount")),
    taxable: num(rowOf("Taxable value")),
    tax: [...html.matchAll(/<div class="t"><span>(?:CGST|SGST|CESS)[^<]*<\/span><span>([^<]*)<\/span><\/div>/g)]
      .reduce((a, m) => a + num(m[1]), 0),
    roundOff: roundRaw.includes("−") ? -num(roundRaw) : num(roundRaw),
    total: num(one(/class="g"><span>TOTAL<\/span><span>([^<]*)</)),
  };
};
const r2 = (n) => Math.round(n * 100) / 100;
const buildBill = (sub, disc, rate, comps) => {
  const taxable = Math.max(0, sub - disc), tax = r2(taxable * rate), total = r2(taxable + tax);
  return BILLDOC.billDocHtml({
    name: "T", lines: [{ title: "X", qty: 1, price: sub }],
    subtotal: sub, discount: disc, discLabel: BILLDOC.discPct(sub, disc), taxable, total,
    taxRows: BILLDOC.splitTax(Math.round(tax), comps),
  });
};
const CG = [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }];
const HOTEL = [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }];
const sweeps = [
  ["a bill with a % discount", (f) => { for (let s2 = 200; s2 <= 900; s2++) for (const p of [5, 10, 15, 20, 25, 50]) f(s2, r2(s2 * p / 100), 0.05, CG); }],
  ["a bill with no discount", (f) => { for (let s2 = 100; s2 <= 900; s2++) f(s2, 0, 0.05, CG); }],
  ["a bill in paise at 18%", (f) => { for (let c = 10000; c < 24000; c += 7) { const s2 = c / 100; f(s2, r2(s2 * 0.13), 0.18, HOTEL); } }],
];
for (const [what, sweep] of sweeps) {
  let n = 0, broke = null;
  sweep((sub, disc, rate, comps) => {
    n++;
    const r = readRows(buildBill(sub, disc, rate, comps));
    const base = disc > 0 ? r.taxable : r.subtotal;
    const identity1 = disc > 0 ? (r.subtotal - r.discount === r.taxable) : true;
    const identity2 = base + r.tax + r.roundOff === r.total;
    if ((!identity1 || !identity2) && !broke) broke = { sub, disc, ...r };
  });
  if (broke) bad(`${what} does not add up on the paper (${n} cases checked)`, `e.g. ${JSON.stringify(broke)} — the rows must reconcile to the TOTAL`);
  else ok(`${what} always adds up (${n} cases)`);
}
// The total is the ANCHOR: the fix may never move what is charged.
{
  const r = readRows(buildBill(201, 30.15, 0.05, CG));
  r.total === 179 ? ok("the amount charged is untouched (₹201 less 15% still totals ₹179)")
    : bad("the printed TOTAL has moved", `expected ₹179, got ₹${r.total} — this fix must never change money`);
}
// And the rule lives in ONE place, shared with the screen.
typeof BILLDOC.billRows === "function"
  ? ok("billRows() is exported, so the manager's screen quotes the same figures as the paper")
  : bad("billRows() is gone", "the screen would round its rows separately and contradict the bill again");
/LFH_BILLDOC\.billRows\(/.test(read("public/panels/editor/app.js"))
  ? ok("the manager panel renders its money rows from billRows()")
  : bad("the manager panel rounds its own money rows again", "screen and paper drifted apart the last time this happened");

// ── 8. NO INVENTED IDENTITY ON A TAX INVOICE ──────────────────────────────────────────────
// A restaurant that had not filled its Billing card printed a hardcoded placeholder address and
// a fake phone number on real bills, beside a real bill number.
{
  const bi = BILLDOC.billIdentity({}, { slug: "some-client", name: { en: "Some Client" } });
  !bi.gstin && !bi.address && !bi.phone
    ? ok("an unconfigured restaurant prints no GSTIN, no address and no phone (rather than a fake one)")
    : bad("a bill can still print an invented address/phone/GSTIN",
      `got address="${bi.address}" phone="${bi.phone}" gstin="${bi.gstin}" — an empty value prints no line, which is the honest thing`);
}

// ── 9. ONE ASSEMBLER, AND THE WAITER CAN PRINT (2026-08-04) ───────────────────────────────
// The waiter panel could do every step of issuing a tax invoice EXCEPT produce it: take the money,
// split it, capture the customer, mint a numbered invoice — and then no way to print, because the
// assembly of a bill's DATA lived inside the manager panel's printBill(). A table settled entirely
// from the handheld left the guest with nothing on paper. The obvious shortcut was a second
// assembler on the tablet, which is the fault this whole file exists to prevent.
for (const fn of ["billMoney", "billData", "taxModel", "combineBillLines", "banquetDocHtml"]) {
  if (typeof BILLDOC[fn] === "function") ok(`${DOC} exports ${fn}()`);
  else bad(`${DOC} does not export ${fn}()`, "both panels assemble their bills through these");
}
{
  const ed = read("public/panels/editor/app.js");
  const tb = read("public/panels/tablet/app.js");
  /LFH_BILLDOC\.billData\(/.test(ed)
    ? ok("the manager panel assembles its bill through the shared billData()")
    : bad("the manager panel assembles its own bill data again", "that is what locked the waiter panel out of printing");
  /LFH_BILLDOC\.billData\(/.test(tb)
    ? ok("the WAITER panel can print a bill, through the same assembler")
    : bad("the waiter panel cannot print a bill", "it can mint a numbered invoice but not produce it — the gap this closed");
  /printTableBill/.test(tb) && /id="printBillBtn"/.test(tb)
    ? ok("and the button is actually on the waiter's bill screen")
    : bad("the waiter panel has no Print bill button", "the function without the button is no use to anyone");
  // the money math must exist ONCE — the panels are doors onto it
  /function billMath\(orders\) \{ return LFH_BILLDOC\.billMoney/.test(ed)
    ? ok("the manager's billMath() is a one-line door onto the shared money rule")
    : bad("the manager panel computes bill money itself again", "two money rules is how the screen and the paper drifted");
  /LFH_BILLDOC\.banquetDocHtml\(/.test(ed)
    ? ok("the manager prints the shared banquet document")
    : bad("the manager draws its own banquet bill again");
  /BILLDOC\.banquetDocHtml\(/.test(read("components/admin/RestaurantSettings.tsx"))
    ? ok("the admin's banquet preview renders the REAL document")
    : bad("the admin's banquet preview draws its own sheet again", "an admin would approve a layout no printer produces");
}

console.log(fails
  ? `\n${fails} check(s) FAILED — the bill or the ticket has more than one description again.`
  : "\nAll checks passed — one bill, one ticket, one file, one numbering series, and it adds up.");
process.exit(fails ? 1 : 0);
