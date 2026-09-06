// ⬛ NEW — T11 of sweep #8 · BANK G · P65375–P65540 · ROUND 3
// THE THERMAL BILL, RENDERED, ACROSS EVERY SHAPE A REAL BILL COMES IN.
//
// WHY THIS BANK EXISTS, AND WHY IT IS NOT A RESAMPLE OF ROUND 1. Round 1's bank E replayed the
// MONEY IDENTITIES over real bill shapes — it asked whether the arithmetic adds up. It never
// looked at the piece of paper. Round 2's re-runs rendered documents, but one or two shapes each,
// chosen by whatever the inherited row happened to be about. Neither asked the question this bank
// asks: take every shape a bill in this product can actually be, print it, and check the eight
// things that must be true of ANY printed bill — whatever is on it.
//
// THE SHAPE OF THE CHECK. Twenty bill shapes × eight invariants = one hundred and sixty ids, and
// the pairing is the point: a failure names the exact bill AND the exact promise it broke
// ("composition scheme · the ink column is 66mm"), instead of "the bill is wrong somewhere". This
// document's own history is a list of promises that held on every bill anyone thought to try and
// failed on a whole class nobody did.
//
// EACH SHAPE IS RENDERED ONCE. Eight ids share one browser render, cached by shape key — a hundred
// and sixty separate Chromium renders would take twenty minutes to say what twenty say in three.
import { BILLDOC as B, row, skipRow } from "./lib.mjs";
import { BASE, canDrive, renderDoc, seenText, inkWidth, bodyWidth, ROLL_PX } from "./browser.mjs";

const S = (o = {}) => ({ tax_rate: 0.05, ...o });
const line = (title, qty, price, extra = {}) => ({ title, qty, price, ...extra });
const ordOf = (items, o = {}) => ({
  id: "o1", status: "served",
  subtotal: items.reduce((a, i) => a + i.qty * i.price, 0),
  taxable_base: items.reduce((a, i) => a + i.qty * i.price, 0),
  tax_rate: 0.05, items, ...o,
});
const build = (orders, settings, session = {}, extra = {}) => ({
  ...B.billData({ settings, restaurant: { id: "r-g", slug: "g" }, orders,
    money: B.billMoney(orders, settings), session, tableDisp: "7" }),
  noBar: true, ...extra,
});

// ── THE TWENTY SHAPES ────────────────────────────────────────────────────────────────────────
// Each is a bill this product really produces. The name is what a person would call it.
const SHAPES = [
  ["the ordinary bill", () => build([ordOf([line("Dal Makhani", 2, 240), line("Naan", 4, 60)])], S(), { bill_no: 101 })],
  ["one item, one rupee", () => build([ordOf([line("Papad", 1, 1)])], S(), { bill_no: 102 })],
  ["a sixty-line bill", () => build([ordOf(Array.from({ length: 60 }, (_, i) => line(`Dish number ${i + 1}`, 1 + (i % 3), 80 + i)))], S(), { bill_no: 103 })],
  ["prices already include GST", () => build([ordOf([line("Thali", 2, 315, { tax_mode: "incl" })])], S(), { bill_no: 104 })],
  ["an MRP bottle, never taxed", () => build([ordOf([line("Bisleri 1L", 2, 20, { tax_mode: "exempt", is_mrp: true }), line("Dal", 1, 240)])], S(), { bill_no: 105 })],
  ["a composition-scheme restaurant, no tax line at all", () => build([ordOf([line("Dal", 2, 240)], { tax_rate: 0 })], S({ tax_rate: 0, composition: true }), { bill_no: 106 })],
  ["two tax rates on one bill", () => build([ordOf([line("Dal", 1, 200)], { id: "a", tax_rate: 0.05 }), ordOf([line("Beer", 2, 250)], { id: "b", tax_rate: 0.18 })], S(), { bill_no: 107 })],
  ["a percentage discount", () => build([ordOf([line("Dal", 2, 240)])], S({ discount: 48 }), { bill_no: 108 })],
  ["a discount under fifty paise", () => build([ordOf([line("Chai", 1, 9)])], S({ discount: 0.45 }), { bill_no: 109 })],
  ["a discount bigger than the food", () => build([ordOf([line("Chai", 1, 20)])], S({ discount: 500 }), { bill_no: 110 })],
  ["a tip on top", () => build([ordOf([line("Dal", 2, 240)])], S(), { bill_no: 111 }, { tip: 200 })],
  ["a parcel — no table number", () => build([ordOf([line("Biryani", 1, 320)])], S(), { bill_no: 112 }, { parcel: true, tableDisp: "" })],
  ["an issued invoice — the invoice number replaces the bill number", () => build([ordOf([line("Dal", 2, 240)])], S({ gstin: "24ABCDE1234F1Z5" }), { bill_no: 113, invoice_no: "INV-0042" }, { invNo: "INV-0042" })],
  ["a cancelled sale, its number retired", () => build([ordOf([line("Dal", 2, 240)])], S(), { bill_no: 114 }, { cancelled: true })],
  ["a named guest with a phone number", () => build([ordOf([line("Dal", 2, 240)])], S(), { bill_no: 115 }, { cust: "Meera Raghavan", custPhone: "9876543210" })],
  ["a dish name in Hindi", () => build([ordOf([line("दाल मखनी", 2, 240), line("रोटी", 4, 30)])], S(), { bill_no: 116 })],
  ["a dish with three priced add-ons", () => build([ordOf([line("Pizza", 1, 520, { options: [{ label: "Extra cheese", price: 80 }, { label: "Olives", price: 40 }, { label: "Thin crust", price: 0 }] })])], S(), { bill_no: 117 })],
  ["a bill in the lakhs", () => build([ordOf([line("Banquet package", 1, 107880), line("Service", 1, 25000)])], S(), { bill_no: 118 })],
  ["a bill that rounds off", () => build([ordOf([line("Dal", 3, 111.11)])], S(), { bill_no: 119 })],
  ["a bill with a null in the line list", () => build([{ ...ordOf([line("Dal", 2, 240)]), items: [line("Dal", 2, 240), null, line("Naan", 2, 60)] }], S(), { bill_no: 120 })],
];

// ── THE EIGHT PROMISES ANY PRINTED BILL MAKES ────────────────────────────────────────────────
const cache = new Map();
async function shot(i) {
  if (cache.has(i)) return cache.get(i);
  const data = SHAPES[i][1]();
  const html = B.billDocHtml(data);
  const r = await renderDoc("bill", data, { media: "print", settle: 250 });
  const out = { data, html, text: (await seenText(r.page)).join("\n"),
    ink: await inkWidth(r.page), body: await bodyWidth(r.page), errs: r.errs };
  await r.close();
  cache.set(i, out);
  return out;
}

const PROMISES = [
  ["it draws at all — a real document, not a blank window", (s) => (s.text.replace(/\s+/g, "").length > 40) || `only ${s.text.replace(/\s+/g, "").length} characters of ink`],
  ["it throws nothing while drawing", (s) => s.errs.length === 0 || s.errs[0]],
  ["it never prints a value that failed to resolve", (s) => {
    const bad = ["undefined", "NaN", "[object Object]", "Invalid Date", "null"].filter((w) => new RegExp(`\\b${w.replace(/[[\]]/g, "\\$&")}\\b`).test(s.text));
    return bad.length === 0 || `it prints: ${bad.join(", ")}`;
  }],
  ["its ink column is the 66mm one, on an 80mm roll", (s) => Math.abs(s.ink - ROLL_PX) <= 2 || `${s.ink}px, not ${ROLL_PX}px`],
  ["nothing on it runs wider than that column", (s) => s.body <= ROLL_PX + 2 || `the widest thing on it is ${s.body}px`],
  ["it declares no paper size, so CUPS cannot rotate it", (s) => !/@page[^}]*\bsize\s*:/.test(s.html) || "it declares an @page size"],
  ["the money on it adds up to the total it prints", (s) => {
    // NOT a regex hunt for the word TOTAL — /TOTAL/i matches inside "Sub Total", so the first
    // version of this promise read the subtotal off every one of the twenty bills and reported
    // the tax as a discrepancy. The figure the document itself formatted is the thing to look
    // for: if inr(total) is not on the paper, the total is not on the paper.
    // A CANCELLED SALE'S TOTAL IS ZERO, ON PURPOSE (billdoc.js, the `d.cancelled` branch): it
    // prints the ordered value, then takes it straight back off, then a TOTAL of ₹0 — "no
    // discount, tax, MRP or round-off row: none of them describe a bill nobody paid". So the
    // figure this promise looks for is the one the PAPER owes, not the one the data carries.
    const want = s.data.cancelled ? 0 : (Number(s.data.total) || 0);
    const shown = B.inr(want);
    const bare = shown.replace(/[^\d.,]/g, "");
    if (!s.text.includes(bare)) return `the paper never shows ₹${bare}`;
    if (s.data.cancelled && !/Ordered value/i.test(s.text)) return "a cancelled sale prints ₹0 without saying what was ordered";
    return true;
  }],
  ["every rupee figure on it is grouped the Indian way", (s) => {
    const bad = [...s.text.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g)]
      .map((m) => m[0]).filter((n) => !/^\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d+)?$/.test(n) && !/^\d{1,3},\d{3}(?:\.\d+)?$/.test(n));
    return bad.length === 0 || `grouped the American way: ${[...new Set(bad)].join(", ")}`;
  }],
];

let id = 65375;
for (let i = 0; i < SHAPES.length; i++) {
  for (const [promise, judge] of PROMISES) {
    const tag = `P${id++}`;
    const what = `bill · ${SHAPES[i][0]} — ${promise}`;
    if (!canDrive) skipRow(tag, what, `needs playwright and a server at ${BASE}`);
    else row(tag, what, async () => judge(await shot(i)));
  }
}
