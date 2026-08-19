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
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");

// A migration's NUMBER is not an identifier: parallel branches get RENUMBERED on merge (18 numbers
// are already duplicated on main), and a guard that hard-codes a filename breaks for everyone the
// moment someone else's migration lands first — which is exactly what happened to
// verify-owner-reports.mjs (fixed in c9eff489). So find the migration by its CONTENT.
const migrationSrcWith = (needle) => {
  try {
    const dir = join(ROOT, "supabase/migrations");
    return readdirSync(dir).filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .filter((sql) => sql.includes(needle)).join("\n");
  } catch { return ""; }
};

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
const MIG_SRC = migrationSrcWith("lfh_assign_aggregator_numbers");
const mig = MIG_SRC;
if (!mig) bad("no migration defines lfh_assign_aggregator_numbers", "parcel and delivery bills would go out unnumbered again");
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

// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE T7 SWEEP'S FINDINGS, EACH AS A CHECK (2026-08-05)
// ═══════════════════════════════════════════════════════════════════════════════════════════
// Every failure below actually shipped, and NONE of them could have been caught by the checks
// above — they all drove billDocHtml() with hand-built rows, so they proved the document could
// print a shape that nothing ever asked it for. These go through billData(), the way the panels
// do, which is the only surface that can catch a shape never being reached.
console.log("\n── the bill a person is actually handed (T7 sweep) ──");
{
  const money = (s2) => String(s2).replace(/[₹,\s]/g, "");
  const n = (s2) => { const t = money(s2); const neg = /^[\u2212-]/.test(t); return (neg ? -1 : 1) * (Number(t.replace(/^[\u2212-]/, "")) || 0); };
  const read2 = (d) => {
    const body = BILLDOC.billDocHtml(d).split("</style>")[1] || "";
    const items = [...body.matchAll(/<td class="r">([\d,]+)<\/td><\/tr>/g)].map((x) => n(x[1])).reduce((a, b) => a + b, 0);
    const above = body.split('class="g"')[0];
    const rows = [...above.matchAll(/<div class="t[^"]*"><span>([^<]*)<\/span><span>([^<]*)<\/span><\/div>/g)].map((m) => [m[1].trim(), n(m[2])]);
    const below = (body.split('class="g"')[1] || "");
    const total = n((body.match(/TOTAL<\/span><span>([^<]*)</) || [])[1]);
    let sum = 0;
    for (const [l, v] of rows) { if (/^Subtotal$|^Food subtotal$/.test(l)) sum = v; else if (/^Taxable value$/.test(l)) { /* a restatement, not a term */ } else sum += v; }
    const taxRows = rows.filter(([l]) => !/^Subtotal$|^Food subtotal$|^Discount|^Taxable value$|^MRP items$|^Round off$/.test(l));
    return { items, rows, taxRows, below, total, foots: Math.abs(sum - total) < 0.001, chain: sum };
  };
  const S5 = { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }] };
  const order = (items, extra) => ({ status: "served", items, ...extra });

  // 1. GST INSIDE THE PRICE — the item column and the Subtotal must be the same number.
  //    They were ₹1,340 and ₹1,276: billData never set the flag that picks the right layout, so a
  //    guest adding up their own bill got a different answer from the row beneath it.
  {
    const inclS = { price_tax_mode: "incl", ...S5 };
    const lines = [{ title: "A", qty: 1, price: 700, tax_mode: "incl" }, { title: "B", qty: 1, price: 640, tax_mode: "incl" }];
    const net = Math.round((700 / 1.05) * 100) / 100 + Math.round((640 / 1.05) * 100) / 100;
    for (const disc of [0, 200]) {
      const os = [order(lines, { subtotal: net, taxable_base: net, nontax_amount: 0, discount: disc, tax_rate: 0.05 })];
      const r = read2(BILLDOC.billData({ settings: inclS, restaurant: { slug: "x" }, orders: os, tableDisp: "5", session: {} }));
      const sub = (r.rows.find(([l]) => /^Subtotal$/.test(l)) || [])[1];
      sub === r.items
        ? ok(`tax-inside bill (discount ${disc}): the Subtotal equals the item column (${r.items})`)
        : bad(`tax-inside bill (discount ${disc}): Subtotal ${sub} but the items add to ${r.items}`,
          "a guest checking the column gets a different number from the row under it — set taxIncluded/inclRows in billData()");
      r.foots ? ok(`  …and it still foots to the TOTAL (${r.total})`) : bad(`tax-inside bill does not foot: rows ${r.chain} vs TOTAL ${r.total}`);
      /Price includes/.test(r.below)
        ? ok("  …with the tax reported UNDER the total, not added to it")
        : bad("a tax-inside bill does not say the price includes its tax", "the tax must be reported below the total, never added");
    }
  }

  // 2. TWO RATES ON ONE BILL — each order taxed at the rate it was charged (mig 284).
  //    `find(r > 0)` used to pick one rate for the whole bill, so 5% food beside an 18% banquet
  //    was re-taxed at 18%.
  {
    const os = [order([{ title: "Food", qty: 1, price: 1000, tax_mode: "excl" }], { subtotal: 1000, taxable_base: 1000, nontax_amount: 0, discount: 0, tax_rate: 0.05 }),
      order([{ title: "Banquet", qty: 1, price: 1000, tax_mode: "excl" }], { subtotal: 1000, taxable_base: 1000, nontax_amount: 0, discount: 0, tax_rate: 0.18 })];
    const m = BILLDOC.billMoney(os, S5);
    m.tax === 230
      ? ok("a bill carrying 5% and 18% orders is taxed 50 + 180 = 230, each at its own rate")
      : bad(`a mixed-rate bill was taxed ${m.tax}, not 230`, "one rate for the whole bill re-prices every other order — mig 284 exists to stop that");
    const r = read2(BILLDOC.billData({ settings: S5, restaurant: { slug: "x" }, orders: os, tableDisp: "5", session: {} }));
    r.taxRows.length >= 2
      ? ok("  …and the paper names each rate on its own line")
      : bad("a mixed-rate bill prints one percentage", "the right rupees under a rate nobody was charged");
    r.foots ? ok("  …and it foots") : bad(`mixed-rate bill does not foot: ${r.chain} vs ${r.total}`);
  }

  // 3. A SOFT-DELETED ORDER IS NOT ON THE BILL. It stayed in the subtotal and the tax while
  //    lib/billLedger.ts dropped it, so the paper and the admin ledger described different bills.
  {
    const os = [order([{ title: "A", qty: 1, price: 500, tax_mode: "excl" }], { subtotal: 500, taxable_base: 500, nontax_amount: 0, discount: 0, tax_rate: 0.05, deleted_at: "2026-01-01" }),
      order([{ title: "B", qty: 1, price: 100, tax_mode: "excl" }], { subtotal: 100, taxable_base: 100, nontax_amount: 0, discount: 0, tax_rate: 0.05 })];
    BILLDOC.billMoney(os, S5).total === 105
      ? ok("a soft-deleted order is not charged on the bill")
      : bad(`a soft-deleted order is still billed (total ${BILLDOC.billMoney(os, S5).total}, expected 105)`,
        "the paper charges for a line every ledger says is not there");
    // …AND IT IS NOT PRINTED EITHER. The check above only ever asked billMoney, so it passed for
    // months while billData still listed the tombstoned dish in the ITEM ROWS: the paper showed
    // A(500) + B(100) over a Subtotal of 100 and a TOTAL of 105 — rows that contradict their own
    // total on a document headed "Tax Invoice", which is the exact fault class billRows() exists to
    // prevent (T7 sweep, 2026-08-06). The rows and the money must drop the SAME orders.
    {
      const d = BILLDOC.billData({ settings: S5, restaurant: { slug: "x" }, orders: os, tableDisp: "5", session: {} });
      const titles = (d.lines || []).map((l) => l.title);
      const rowSum = (d.lines || []).reduce((a, l) => a + (parseFloat(l.price) || 0) * Math.max(1, parseInt(l.qty, 10) || 1), 0);
      !titles.includes("A") && titles.includes("B") && rowSum === 100
        ? ok("  …and it is not PRINTED either — the item rows add up to the subtotal")
        : bad(`a soft-deleted order still prints: rows ${JSON.stringify(titles)} summing to ${rowSum}, subtotal ${d.subtotal}`,
          "a guest is handed a bill listing a dish they are not charged for, and it cannot be added up");
    }
  }

  // 4. A REPRINT KEEPS THE BILL'S OWN DATE. It was always `new Date()`, so a reprint stamped today
  //    beside an invoice number whose financial year said otherwise.
  {
    const d = BILLDOC.billData({ settings: S5, restaurant: { slug: "x" },
      orders: [order([{ title: "A", qty: 1, price: 100, tax_mode: "excl" }], { subtotal: 100, taxable_base: 100, nontax_amount: 0, discount: 0, tax_rate: 0.05 })],
      tableDisp: "5", session: { bill_no: 7, invoice_no: 41, invoice_at: "2025-06-10T10:00:00Z" } });
    /2025/.test(d.dateStr) && /2025-26/.test(d.invNo)
      ? ok("a reprinted invoice keeps its own date, matching its invoice number's year")
      : bad(`a reprint stamps ${d.dateStr} on invoice ${d.invNo}`, "the date and the number's financial year must agree on a tax invoice");
  }

  // 5. THE COMPOSITION BILL still prints no tax line and still applies its discount.
  {
    const os = [order([{ title: "A", qty: 2, price: 400, tax_mode: "exempt" }], { subtotal: 800, taxable_base: 0, nontax_amount: 800, discount: 150, tax_rate: 0 })];
    const r = read2(BILLDOC.billData({ settings: { price_tax_mode: "composition" }, restaurant: { slug: "x" }, orders: os, tableDisp: "5", session: {} }));
    const noTax = r.taxRows.length === 0 && !/Price includes/.test(r.below);
    noTax && r.total === 650 && r.foots
      ? ok("a composition bill shows no tax line, applies its discount, and foots (650)")
      : bad(`a composition bill is wrong: total ${r.total}, tax rows ${JSON.stringify(r.taxRows)}`,
        "a composition restaurant may show a diner no GST at all, and its discount must still come off");
  }

  // 6. THE BANQUET SHEET must not print per-line tax columns that contradict its own TOTAL row.
  //    With an empty frozen tax_lines it fell back to LIVE component rates while every amount was
  //    split out of the bill's STORED tax, so one sheet stated three different numbers.
  {
    const html = BILLDOC.banquetDocHtml({
      bill: { bill_no: "B1", issued_at: "2026-08-05", subtotal: 250000, discount: 10000, tax: 12000, total: 252000 },
      lines: [{ title: "Set menu", qty: 500, price: 500 }],
      settings: { banquet_paper_size: "a5", banquet_tax_components: [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }] },
      restaurant: { slug: "x" }, autoPrint: false,
    });
    const cells = [...html.matchAll(/<td class="c">([\d.]+)%<\/td><td class="r">([\d,.]+)<\/td>/g)].map((m) => n(m[2]));
    const totRow = (html.match(/<tr class="tot">([\s\S]*?)<\/tr>/) || [])[1] || "";
    const totals = [...totRow.matchAll(/class="r">([\d,.]+)</g)].map((m) => n(m[1])).slice(1);
    const same = cells.length === totals.length && cells.every((c, i) => Math.abs(c - totals[i]) < 0.02);
    same
      ? ok("a banquet sheet's per-line tax columns add up to its own TOTAL row")
      : bad(`a banquet sheet contradicts itself: lines ${JSON.stringify(cells)} vs TOTAL row ${JSON.stringify(totals)}`,
        "use the components only when their sum IS the rate this bill was charged (billMoney's compsMatch guard)");
  }

  // 7. THE BANQUET SHEET can be dismissed, and a PREVIEW does not fire the print dialog by itself.
  {
    const bq = (extra) => BILLDOC.banquetDocHtml({ bill: { bill_no: "B1", subtotal: 100, total: 100 }, lines: [], settings: {}, restaurant: {}, ...extra });
    const real = bq({}); const prev = bq({ autoPrint: false, note: "a sample" });
    /class="bar"/.test(real) && /Escape/.test(real)
      ? ok("the banquet sheet carries a Close button and answers Esc")
      : bad("the banquet sheet cannot be closed", "it auto-printed with no toolbar, no ✕ and no Esc — only the browser could dismiss it");
    /setTimeout\(printAgain/.test(real) && !/setTimeout\(printAgain/.test(prev)
      ? ok("  …a real banquet print fires the dialog, a PREVIEW does not")
      : bad("the banquet preview fires a print dialog at the admin", "a preview shows the sheet; only a real print opens the dialog");
  }

  // 8. THE KITCHEN TICKET obeys the ONE-INK rule — the same thermal head as the bill.
  {
    const k = BILLDOC.kotDocHtml({ rname: "R", kot: 1, lines: [{ qty: 1, title: "X", options: ["extra cheese"], removed: ["onion"] }] });
    const css = (k.split("<style>")[1] || "").split("</style>")[0].replace(/\/\*[\s\S]*?\*\//g, "");
    const greys = [...new Set(css.match(/#[0-9a-fA-F]{3,6}/g) || [])].filter((c) => !/^#0{3,6}$/i.test(c) && !/^#f{3,6}$/i.test(c));
    !greys.length && !/font-style:\s*italic/.test(css)
      ? ok("the kitchen ticket prints in one ink, no italics (a thermal head has no grey)")
      : bad(`the kitchen ticket still uses ${greys.join(" ")}${/font-style:\s*italic/.test(css) ? " and italics" : ""}`,
        "grey is faked with sparse dots at 203dpi — the option/removal lines are the ones a cook must read");
  }

  // 9. AMOUNT IN WORDS names the same amount as the figure printed beside it — AND names a currency.
  //    This check used to assert bqWords(1234) === "One Thousand Two Hundred Thirty-Four Only",
  //    which pinned a defect: the box is captioned "Invoice Total (In Words)" and on the common
  //    whole-rupee case it named a number with no currency at all, while the paise case said
  //    "Rupees". It also said "One Rupees and One Paise". Fixed + re-pinned 2026-08-11 (T7 F2).
  {
    const w = {
      paise: BILLDOC.bqWords(1234.56),
      whole: BILLDOC.bqWords(1234),
      one: BILLDOC.bqWords(1),
      onePaisa: BILLDOC.bqWords(1.01),
      zero: BILLDOC.bqWords(0),
      neg: BILLDOC.bqWords(-1234.56),
    };
    const okWords =
      /Fifty-Six Paise Only$/.test(w.paise) && /Rupees and/.test(w.paise)
      && w.whole === "One Thousand Two Hundred Thirty-Four Rupees Only"
      && w.one === "One Rupee Only"                       // singular, not "One Rupees"
      && w.onePaisa === "One Rupee and One Paisa Only"     // singular both halves
      && w.zero === "Zero Rupees Only"
      && /^Minus /.test(w.neg);                            // a negative says so
    okWords
      ? ok("the banquet amount-in-words states its paise, names the currency, and gets the singular right")
      : bad(`bqWords: whole="${w.whole}" one="${w.one}" onePaisa="${w.onePaisa}" neg="${w.neg}"`,
        "on a tax invoice the words are the controlling figure — they must name the same amount AND the currency");
  }

  // 9b. A MIXED-RATE BILL KEEPS THE RESTAURANT'S OWN TAX COMPONENTS (T7 F1, 2026-08-11).
  //     It used to print one flat "GST 18%" / "GST 5%" line per rate, dropping the central/state
  //     split every other bill from the same printer shows. The first fix scaled the CGST/SGST
  //     HALVES, which silently lost a third component — a restaurant on CGST+SGST+CESS printed
  //     "CGST 9% / SGST 9%" on its 18% slice and no cess at all. The shape now comes from the
  //     restaurant's configured components, and each rate's rows still foot to that rate's tax.
  {
    const ord = (o) => Object.assign({ status: "served", payment_status: "pending", items: [] }, o);
    const food = (r) => ord({ subtotal: 1000, taxable_base: 1000, tax_rate: r, items: [{ title: "F", qty: 1, price: 1000, tax_mode: "excl" }] });
    const banq = () => ord({ subtotal: 2000, taxable_base: 2000, tax_rate: 0.18, items: [{ title: "B", qty: 1, price: 2000, tax_mode: "excl" }] });
    const S3 = { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }, { label: "CESS", rate: 1 }] };
    const os = [food(0.06), banq()];
    const d = BILLDOC.billData({ settings: S3, restaurant: {}, orders: os, session: {} });
    const money = BILLDOC.billMoney(os, S3);
    const labels = d.taxRows.map((r) => r.label);
    const sum = d.taxRows.reduce((a, r) => a + r.amt, 0);
    const keptCess = labels.filter((l) => l === "CESS").length === 2;   // one per rate bucket
    const noFlatGst = !labels.includes("GST");
    const foots = sum === Math.round(money.tax);
    keptCess && noFlatGst && foots
      ? ok("a mixed-rate bill splits EACH rate by the restaurant's own components (a cess survives) and still foots")
      : bad(`mixed rows = ${d.taxRows.map((r) => `${r.label} ${r.rate}% ${r.amt}`).join(" | ")} (sum ${sum}, tax ${money.tax})`,
        "a tax invoice states WHICH taxes were charged — dropping a component on a two-rate bill understates the split");
  }

  // 10. THE BANQUET TAX COLUMNS FOOT — on a MULTI-LINE bill, exactly.
  //     Check 6 above builds a one-line sheet with a ±0.02 tolerance, so per-line rounding can
  //     never diverge there and it could not see T7 finding F10: every cell was rounded on its own
  //     while the TOTAL row printed the bill's stored tax, so CGST 9,703.13 + 646.88 = 10,350.01
  //     sat under a TOTAL of 10,350.00 — on 47.8% of realistic bills. Two lines and an EXACT
  //     comparison is what catches it (added 2026-08-11).
  {
    const cases = [
      { lines: [{ title: "Deluxe veg thali", qty: 250, price: 450 }, { title: "Live chaat counter", qty: 1, price: 7500 }], subtotal: 120000, discount: 5000, tax: 20700, total: 135700 },
      { lines: [{ title: "A", qty: 100, price: 300 }, { title: "B", qty: 1, price: 5000 }], subtotal: 35000, discount: 0, tax: 6300, total: 41300 },
      { lines: [{ title: "A", qty: 7, price: 111 }, { title: "B", qty: 3, price: 99 }, { title: "C", qty: 1, price: 1 }], subtotal: 1075, discount: 137, tax: 168.84, total: 1244 },
    ];
    const num = (s) => Number(String(s).replace(/[^0-9.\-]/g, "")) || 0;
    let offenders = [];
    for (const c of cases) {
      const html = BILLDOC.banquetDocHtml({
        bill: { bill_no: "B1", issued_at: "2026-08-05", subtotal: c.subtotal, discount: c.discount, tax: c.tax, total: c.total },
        lines: c.lines,
        settings: { banquet_paper_size: "a5", banquet_tax_components: [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }] },
        restaurant: { slug: "x" }, autoPrint: false,
      });
      // Every body row's tax cells, and the TOTAL row's, straight off the rendered table.
      const body = [...html.matchAll(/<tr><td class="c">\d+<\/td>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
      const cellsOf = (row) => [...row.matchAll(/<td class="c">[\d.]+%<\/td><td class="r">([\d,.]+)<\/td>/g)].map((m) => num(m[1]));
      const perCol = body.map(cellsOf).filter((a) => a.length);
      const totRow = (html.match(/<tr class="tot">([\s\S]*?)<\/tr>/) || [])[1] || "";
      const totals = [...totRow.matchAll(/class="r">([\d,.]+)</g)].map((m) => num(m[1])).slice(1);
      for (let col = 0; col < totals.length; col++) {
        const summed = Math.round(perCol.reduce((a, r) => a + (r[col] ?? 0), 0) * 100) / 100;
        if (summed !== totals[col]) offenders.push(`${c.lines.length} lines, col ${col + 1}: ${summed} vs TOTAL ${totals[col]}`);
      }
    }
    offenders.length === 0
      ? ok("a MULTI-LINE banquet sheet's tax columns add up to its TOTAL row exactly, to the paisa")
      : bad(offenders.join(" · "), "the in-table TOTAL row is the PROOF the columns add up — a paisa out is a paisa too many");
  }
}

// ── THE THERMAL DOCUMENTS DECLARE NO PAGE SIZE (owner, 2026-08-19, with a photo of the failure) ────
// The bill used to measure itself and inject `@page{size:80mm <content height>mm}`. On a real thermal
// queue whose media is a SHORT receipt page (70x65mm) that instruction forces the driver to fit a
// 134mm page onto 65mm — it scales to about half size and rotates the job. That is precisely what he
// photographed: "the bill came out landscape instead of portrait and very small". The KOT, which
// declares nothing, was perfect on the same printer at the same moment.
//
// So neither thermal document may declare a page SIZE. `@page{margin:0}` is required and stays (it is
// what removes the browser's own header/footer). The A4/A5 banquet sheet is a different document on a
// tray printer and legitimately sets a size — it is not checked here.
{
  const doc = read(DOC);
  const thermal = doc.slice(0, doc.indexOf("A5/A4 sheet print recipe") > 0 ? doc.indexOf("A5/A4 sheet print recipe") : doc.length);
  // CODE ONLY. The note in billdoc.js that EXPLAINS this failure quotes the bad pattern, and the first
  // version of this check failed on that note — a guard that trips on its own explanation teaches
  // people to delete explanations. Comments are stripped before the test; the real CSS lives inside
  // quoted strings, so it survives.
  const codeOnly = thermal
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const injects = /@page\{\s*size\s*:/.test(codeOnly.replace(/\\n/g, "\n"));
  injects
    ? bad("the thermal bill/KOT declares an @page SIZE again — a page bigger or squarer than the roll makes the driver scale and ROTATE the job (measured: 80x134mm onto 70x65mm = 0.49x, sideways). Only @page{margin:0} belongs here; paper feed is the queue's job (FeedWhere/FeedDist).")
    : ok("neither thermal document declares an @page size — the queue's own receipt page paginates them");
  /@page\{margin:0\}/.test(thermal.replace(/\\n/g, "\n"))
    ? ok("…and @page{margin:0} is still there, so no browser header/footer reaches the paper")
    : bad("@page{margin:0} has gone from the thermal document — the browser's own header, footer and page numbers will print on the roll");
}

console.log(fails
  ? `\n${fails} check(s) FAILED — the bill or the ticket has more than one description again.`
  : "\nAll checks passed — one bill, one ticket, one file, one numbering series, and it adds up.");
process.exit(fails ? 1 : 0);
