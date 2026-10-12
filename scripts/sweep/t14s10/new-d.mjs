// Bank D — public/panels/billdoc.js, the one bill, the one ticket, the banquet sheet (P183401–P183520).
// It had the most rows of any T14 file (69), but almost all of them READ it. These RUN it — over
// thousands of seeded random bills — and judge the printed paper itself: does every row foot to the
// TOTAL, is the TOTAL what was charged, and is any figure ever undefined, NaN or negative.
import { sec, read, imp } from "./lib.mjs";

const B = (await imp("public/panels/billdoc.js")).default;
const F = "public/panels/billdoc.js";
const d = sec(183400);

// A seeded generator, so a failing bill can be reproduced from its index.
let seed = 14;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const SETTINGS = [
  { tax_rate: 0.05 }, { tax_rate: 0.18 }, { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }] },
  { tax_components: [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }] }, { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }, { label: "CESS", rate: 1 }] },
  { price_tax_mode: "composition", tax_rate: 0.05 }, { tax_rate: 0.05, mrp_tax_treatment: "inclusive" },
];
/** A random order the way the database stores it: subtotal, taxable base, untaxed MRP, discount, rate. */
function randOrder(rate) {
  const items = [];
  let sub = 0, mrp = 0;
  const n = 1 + Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) {
    const isMrp = rnd() < 0.12;
    const price = isMrp ? pick([10, 20, 21, 40]) : Math.round(20 + rnd() * 600);
    const qty = 1 + Math.floor(rnd() * 4);
    items.push({ title: `Dish ${i}`, qty, price, is_mrp: isMrp, tax_mode: isMrp ? "exempt" : "excl" });
    sub += price * qty; if (isMrp) mrp += price * qty;
  }
  const base = sub - mrp;
  const disc = rnd() < 0.35 ? Math.round(base * pick([0.05, 0.1, 0.15, 0.2, 0.25, 0.5]) * 100) / 100 : 0;
  return { status: "served", subtotal: sub, taxable_base: base, nontax_amount: mrp, mrp_amount: mrp, discount: disc, tax_rate: rate, items, tip: rnd() < 0.1 ? Math.round(rnd() * 200) : 0 };
}
/** Read the money rows ABOVE the TOTAL off a printed bill, and the TOTAL. */
function rowsOf(h) {
  const top = h.slice(h.indexOf('<div class="totals">'), h.indexOf('class="g"><span>TOTAL'));
  const rows = [...top.matchAll(/<div class="t(?: tx)?"><span>([^<]+)<\/span><span>([−+]?\s*)₹([\d,.]+)<\/span><\/div>/g)]
    .map((m) => ({ k: m[1], v: (m[2].includes("−") ? -1 : 1) * Number(m[3].replace(/,/g, "")) }));
  const t = h.match(/class="g"><span>TOTAL<\/span><span>₹([\d,]+)</);
  return { rows, total: t ? Number(t[1].replace(/,/g, "")) : NaN };
}
const foot = ({ rows }) => rows.filter((r) => r.k !== "Taxable value").reduce((a, r) => a + r.v, 0);

// Build 3,000 random bills once; several rows below judge different properties of the same set.
const BILLS = [];
for (let i = 0; i < 3000; i++) {
  const s = pick(SETTINGS);
  const rate = s.price_tax_mode === "composition" ? 0 : (s.tax_components ? s.tax_components.reduce((a, c) => a + c.rate, 0) / 100 : s.tax_rate);
  const orders = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => randOrder(rnd() < 0.08 ? 0.18 : rate));
  const m = B.billMoney(orders, s);
  const data = B.billData({ orders, settings: s, session: { bill_no: i, invoice_no: rnd() < 0.5 ? i : null, invoice_at: "2026-10-01T10:00:00Z" } });
  BILLS.push({ i, s, orders, m, data, html: B.billDocHtml(data) });
}
d(1, F, "on 3,000 random bills every money row above the TOTAL foots to it exactly", "subtotal − discount + tax + MRP + round-off = TOTAL, parsed off the printed paper", () => {
  const bad = BILLS.filter((b) => Math.abs(foot(rowsOf(b.html)) - rowsOf(b.html).total) > 0.001);
  return bad.length === 0 || `${bad.length} bills do not foot — first #${bad[0].i}: ${foot(rowsOf(bad[0].html))} vs ${rowsOf(bad[0].html).total}`;
});
d(2, F, "…and the printed TOTAL is the money function's total, rounded once (nothing is moved to make it foot)", "TOTAL vs Math.round(billMoney.total)", () => {
  const bad = BILLS.filter((b) => rowsOf(b.html).total !== Math.round(b.m.total));
  return bad.length === 0 || `${bad.length} — first #${bad[0].i}: paper ${rowsOf(bad[0].html).total} vs ${b0(bad[0].m.total)}`;
});
const b0 = (x) => Math.round(x);
// A bill whose orders were CHARGED tax, reprinted after the restaurant moved to the composition scheme,
// prints as a Bill of Supply and shows that tax as a "Round off" (found by this run; 0 such restaurants
// on the dev stack today — Part 4, the owner decides what an old bill looks like after a scheme change).
const schemeChanged = (b) => b.m.composition && b.m.tax > 0;
d(3, F, "…a round-off is never more than a rupee or two (a bigger one is a double count, the ₹40 fault)", "max |Round off| over every bill whose scheme did not change after it was charged", () => {
  let worst = 0; for (const b of BILLS) if (!schemeChanged(b)) for (const r of rowsOf(b.html).rows) if (r.k === "Round off") worst = Math.max(worst, Math.abs(r.v));
  const changed = BILLS.filter(schemeChanged).length;
  return worst <= 2 ? { ok: true, note: `worst ₹${worst}; ${changed} generated bills were taxed then reprinted under composition — that case is Part 4` } : `a round-off of ₹${worst}`;
});
d(4, F, "…no printed figure is negative except the Discount and a minus round-off", "every row's sign", () => {
  const bad = []; for (const b of BILLS) for (const r of rowsOf(b.html).rows) if (r.v < 0 && !/^Discount|^Round off/.test(r.k)) bad.push(`#${b.i} ${r.k} ${r.v}`);
  return bad.length === 0 || bad.slice(0, 3).join(" · ");
});
d(5, F, "…and no bill ever carries 'undefined', 'NaN', '[object Object]' or '${' anywhere", "scan every document", () => {
  const bad = BILLS.filter((b) => /undefined|NaN|\[object Object\]|\$\{/.test(b.html));
  return bad.length === 0 || `#${bad[0].i}: ${(bad[0].html.match(/.{30}(undefined|NaN|\[object Object\]|\$\{).{10}/) || [])[0]}`;
});
d(6, F, "…a composition bill never shows a tax row, a 'Taxable value' row or the words Tax Invoice", "every composition bill", () => {
  const bad = BILLS.filter((b) => b.s.price_tax_mode === "composition" && (/CGST|SGST|Taxable value|Tax Invoice/.test(b.html) || !/Bill of Supply/.test(b.html)));
  return bad.length === 0 || `#${bad[0].i}`;
});
d(7, F, "…a bill with a discount says its percentage of the row shown above it", "label vs discPct(subtotal shown, discount shown)", () => {
  const bad = [];
  for (const b of BILLS) { const r = rowsOf(b.html).rows; const dRow = r.find((x) => x.k.startsWith("Discount")); if (!dRow) continue; const sub = r[0].v; const m = dRow.k.match(/\(([\d.]+%)\)/); if (m && m[1] !== B.discPct(sub, -dRow.v) && m[1] !== b.data.discLabel) bad.push(`#${b.i} ${m[1]} vs ${B.discPct(sub, -dRow.v)}`); }
  return bad.length === 0 || bad.slice(0, 3).join(" · ");
});
d(8, F, "…the tip prints BELOW the TOTAL and PAID is TOTAL + tip, never above the line", "every tipped bill", () => {
  const bad = [];
  for (const b of BILLS) { const tip = b.data.tip; if (!tip) continue; const h = b.html; const tI = h.indexOf('class="g"><span>TOTAL'), tipI = h.indexOf("<span>Tip"); const paid = h.match(/PAID<\/span><span>₹([\d,]+)/); if (!(tipI > tI) || !paid || Number(paid[1].replace(/,/g, "")) !== Math.round(b.m.total) + tip) bad.push(`#${b.i}`); }
  return bad.length === 0 || bad.slice(0, 3).join(", ");
});
d(9, F, "…a bill with an invoice number shows it and NOT the bill number; one without shows the bill number", "Invoice vs Bill no rows", () => {
  const bad = BILLS.filter((b) => { const inv = /<span>Invoice<\/span>/.test(b.html), bn = /<span>Bill no<\/span>/.test(b.html); return b.data.invNo ? (!inv || bn) : (inv || !bn); });
  return bad.length === 0 || `#${bad[0].i}`;
});
d(10, F, "…a mixed-rate bill (18% banquet beside 5% food) names each rate's CGST/SGST on its own lines and still foots", "bills with two rates", () => {
  // (a restaurant with a third component — CESS — scales the shape, so its 18% slice is CGST 7.5 + SGST 7.5
  //  + CESS 3; judged on its own in the next row)
  const mixed = BILLS.filter((b) => b.m.mixedRates && !b.m.composition && !(b.s.tax_components && b.s.tax_components.length === 3));
  // (an 18% order holding only sealed MRP items has no 18% tax, and rightly prints no 9% line)
  const bad = mixed.filter((b) => (b.m.rateRows.some((r) => r.rate === 0.18 && Math.round(r.tax) > 0) && !/CGST 9%/.test(b.html)) || Math.abs(foot(rowsOf(b.html)) - rowsOf(b.html).total) > 0.001);
  return (mixed.length > 20 && bad.length === 0) ? { ok: true, note: `${mixed.length} mixed bills` } : `${mixed.length} mixed, ${bad.length} wrong`;
});
d(11, F, "…a restaurant with a CESS component keeps it on every MIXED bill (the dropped-third-component fault, 2026-08-11)", "3-component mixed bills", () => {
  const cess = BILLS.filter((b) => b.s.tax_components && b.s.tax_components.length === 3 && b.m.mixedRates && !b.m.composition);
  const bad = cess.filter((b) => !/CESS/.test(b.html));
  const single = BILLS.filter((b) => b.s.tax_components && b.s.tax_components.length === 3 && !b.m.mixedRates && b.m.rate > 0.06 && !/CESS/.test(b.html)).length;
  return (cess.length > 0 && bad.length === 0) ? { ok: true, note: `${cess.length} mixed bills keep CESS; but ${single} single-rate 18% bills print CGST 9 + SGST 9 with no CESS, while the same 18% food beside a 6% order prints CGST 7.5 + SGST 7.5 + CESS 3 — which is right is a tax decision, Part 4` } : `${bad.length} of ${cess.length} lost the cess`;
});

// ── the cancelled sheet ──
const cOrd = { status: "cancelled", subtotal: 250, taxable_base: 250, items: [{ title: "Dal", qty: 1, price: 250 }] };
const cHtml = B.billDocHtml(B.billData({ orders: [cOrd], settings: { tax_rate: 0.05, gstin: "24X" }, session: { invoice_no: 41, invoice_at: "2026-10-01T10:00:00Z", bill_no: 9 } }));
d(12, F, "a fully cancelled bill is titled Cancelled Bill and carries the band", "render", () => (/class="kind">Cancelled Bill</.test(cHtml) && /Cancelled — no charge/.test(cHtml)) || "not marked");
d(13, F, "…it still lists what was ordered, then 'Cancelled — not charged', and a TOTAL of ₹0", "money block", () => (/Ordered value<\/span><span>₹250/.test(cHtml) && /Cancelled — not charged<\/span><span>− ₹250/.test(cHtml) && /TOTAL<\/span><span>₹0</.test(cHtml)) || "money block wrong");
d(14, F, "…it prints no tax, discount, MRP or round-off row", "rows", () => !/CGST|SGST|Discount|Round off|MRP items/.test(cHtml) || "a money row on a sale nobody paid");
d(15, F, "…an invoice it retired is named, marked '— voided' — the number never just disappears", "Invoice row", () => /INV\/2026-27\/000041 — voided/.test(cHtml) || "voided number missing");
d(16, F, "…and it never shows a tip", "cancelled with a tip", () => !/Tip/.test(B.billDocHtml(B.billData({ orders: [{ ...cOrd, tip: 50 }], settings: {} }))) || "tip on a cancelled bill");
d(17, F, "a bill that is only PARTLY cancelled is an ordinary bill of what is left", "one cancelled + one live", () => { const h = B.billDocHtml(B.billData({ orders: [cOrd, { status: "served", subtotal: 100, taxable_base: 100, items: [{ title: "Naan", qty: 1, price: 100 }] }], settings: { tax_rate: 0.05 } })); return (!/Cancelled Bill/.test(h) && /TOTAL<\/span><span>₹105</.test(h) && !/<td class="n">Dal/.test(h)) || "partly-cancelled bill wrong"; });
d(18, F, "a soft-deleted order is off the paper — rows AND money", "one live + one tombstoned", () => { const h = B.billDocHtml(B.billData({ orders: [{ status: "served", subtotal: 200, taxable_base: 200, items: [{ title: "Live", qty: 1, price: 200 }] }, { status: "served", deleted_at: "2026-10-01", subtotal: 100, taxable_base: 100, items: [{ title: "Gone", qty: 1, price: 100 }] }], settings: { tax_rate: 0.05 } })); return (!/Gone/.test(h) && /TOTAL<\/span><span>₹210</.test(h)) || "a deleted line is billed"; });

// ── the heading, the identity, the numbers ──
d(19, F, "no GSTIN → the sheet is a 'Bill', never a Tax Invoice", "gstin empty / spaces", () => /class="kind">Bill</.test(B.billDocHtml({ gstin: "" })) && /class="kind">Bill</.test(B.billDocHtml({ gstin: "   " })) || "Tax Invoice with no GSTIN");
d(20, F, "a GSTIN → Tax Invoice, with the GSTIN printed under the address", "gstin set", () => { const h = B.billDocHtml({ gstin: "24AAAAA0000A1Z5", addr: "1 Road", phone: "999" }); return (/class="kind">Tax Invoice</.test(h) && /GSTIN 24AAAAA0000A1Z5/.test(h)) || "wrong"; });
d(21, F, "the number row is ALWAYS labelled 'Invoice', a Bill of Supply included (R49)", "composition sheet", () => /<span>Invoice<\/span>/.test(B.billDocHtml({ composition: true, invNo: "INV/2026-27/000001" })) && !/Serial no/.test(B.billDocHtml({ composition: true, invNo: "INV/2026-27/000001" })) || "label changed");
d(22, F, "the BILL never says reprint/duplicate/copy, whatever a caller passes (R37/R62)", "render with reprint:true and every wording", () => !/reprint|duplicate|\(copy\)/i.test(B.billDocHtml({ reprint: true, lines: [{ title: "x", qty: 1, price: 1 }] })) || "the word reached the bill");
d(23, F, "the bill carries no verification line even when the chain fields are supplied (R50)", "chainSeq + chainHash", () => !/Verification|abcdef01/.test(B.billDocHtml({ chainSeq: 9, chainHash: "abcdef0123456789" })) || "printed");
d(24, F, "billIdentity: a box of spaces is an empty box (no blank letterhead, no bare 'GSTIN')", "all spaces", () => { const i = B.billIdentity({ restaurant_name: " ", restaurant_address: " ", gstin: "  ", restaurant_phone: " " }, { slug: "x", name: { en: "Zed" } }); return (i.name === "Zed" && i.address === "" && i.gstin === "" && i.phone === "") || JSON.stringify(i); });
d(25, F, "billIdentity: no invented address or phone for an ordinary restaurant", "empty settings, non-flagship", () => { const i = B.billIdentity({}, { slug: "pizza-palace" }); return (i.address === "" && i.phone === "" && i.gstin === "") || JSON.stringify(i); });
d(26, F, "billIdentity: the paper's tax word defaults to GST, the screen's to Tax; a typed word wins both", "three cases", () => { const a = B.billIdentity({}, {}), b = B.billIdentity({ tax_label: "VAT" }, {}); return (a.taxLabel === "GST" && a.taxLabelScreen === "Tax" && b.taxLabel === "VAT" && b.taxLabelScreen === "VAT") || "wrong"; });
d(27, F, "billIdentity: a restaurant's own footer wins, else its cuisine sign-off, else a plain thank-you", "three cases", () => B.billIdentity({ bill_footer: "Bye" }, {}).footer === "Bye" && /Grazie/.test(B.billIdentity({}, { slug: "pizza-palace" }).footer) && /Thank you/.test(B.billIdentity({}, { slug: "x" }).footer) || "wrong");
d(28, F, "billIdentity: the invoice prefix defaults to INV", "empty", () => B.billIdentity({}, {}).prefix === "INV" || B.billIdentity({}, {}).prefix);
const FY = [["2026-03-31T18:29:00Z", "2025-26"], ["2026-03-31T18:31:00Z", "2026-27"], ["2027-01-15T10:00:00Z", "2026-27"], ["2026-04-01T00:00:00+05:30", "2026-27"], ["bad", null]];
let fn = 29;
for (const [at, want] of FY) { const n0 = fn++; d(n0, F, `financialYear(${at}) is India's — ${want || "today's, never a crash"}`, "run it", () => { const got = B.financialYear(at); return want ? got === want || got : /^\d{4}-\d{2}$/.test(got) || got; }); }
// fn = 34
d(34, F, "invFmt pads to six digits and keeps a seventh when the series grows past it", "1 / 1234567", () => B.invFmt(1, "2026-05-01", "X") === "X/2026-27/000001" && B.invFmt(1234567, "2026-05-01", "X") === "X/2026-27/1234567" || "wrong");
d(35, F, "invFmt prints nothing for a bill with no invoice number", "null", () => B.invFmt(null) === "" || "printed");
d(36, F, "the bill's date is India's clock whatever the device — dd/mm/yyyy", "an invoice at 2026-10-11T20:00Z (01:30 IST on the 12th)", () => /12\/10\/2026/.test(B.billData({ orders: [], session: { invoice_at: "2026-10-11T20:00:00Z" } }).dateStr) || B.billData({ orders: [], session: { invoice_at: "2026-10-11T20:00:00Z" } }).dateStr);
d(37, F, "…and a reprint keeps the bill's own date, never today's", "invoice_at last June", () => /15\/06\/2025/.test(B.billData({ orders: [], session: { invoice_at: "2025-06-15T08:00:00Z" } }).dateStr) || "today stamped on an old bill");
const PH = [["9825012345", "98250 12345"], ["919825012345", "98250 12345"], ["09825012345", "98250 12345"], ["0919825012345", "98250 12345"], ["00919825012345", "98250 12345"], ["4471234567", "44712 34567"], ["123456789012345", "123456789012345"]];
let pn = 38;
for (const [raw, want] of PH) { const n0 = pn++; d(n0, F, `the customer's number ${raw} prints as "${want}"`, "billData custPhone", () => { const got = B.billData({ orders: [{ status: "served", bill_cust_name: "A", bill_cust_phone: raw }], settings: {} }).custPhone; return got === want || got; }); }
// pn = 45
d(45, F, "a parcel prints 'Parcel' where the table goes, and no table row", "parcel:true", () => { const h = B.billDocHtml({ parcel: true, tableDisp: "T5" }); return (/<span>Parcel<\/span>/.test(h) && !/<span>Table<\/span>/.test(h)) || "wrong header"; });
d(46, F, "every identity field is printed as text — markup in a restaurant's name is not obeyed", "name/addr/footer with <b>", () => { const h = B.billDocHtml({ name: "<b>N</b>", addr: "<i>A</i>", footer: "<u>F</u>", tableDisp: "<s>T</s>", cust: "<em>C</em>", lines: [{ title: "<img>", qty: 1, price: 1 }] }); return !/<b>N|<i>A|<u>F|<s>T|<em>C|<img>/.test(h) || "raw markup on the bill"; });
d(47, F, "a logo URL is attribute-escaped", "a quote in the URL", () => !/src="https:\/\/x"onerror/.test(B.billDocHtml({ logo: 'https://x"onerror="y' })) || "attribute broken out");
d(48, F, "a discount under 50 paise prints no row at all (the 'Discount − ₹0' fault)", "₹200 bill, ₹0.40 off", () => { const h = B.billDocHtml(B.billData({ orders: [{ status: "served", subtotal: 200, taxable_base: 200, discount: 0.4, items: [{ title: "x", qty: 1, price: 200 }] }], settings: { tax_rate: 0.05 } })); return !/Discount/.test(h) || "a zero discount row"; });
d(49, F, "a discount bigger than the bill is clamped, and its percentage re-worded to what was really taken", "subtotal 100, discount 150", () => { const h = B.billDocHtml({ subtotal: 100, discount: 150, total: 0 }); return (/Discount \(100%\)<\/span><span>− ₹100/.test(h) && !/150%/.test(h)) || (h.match(/Discount[^<]*<\/span><span>[^<]*/) || [])[0]; });
d(50, F, "an all-MRP bill is just a bill — no 'Food subtotal ₹0'", "nontax == subtotal", () => !/Food subtotal/.test(B.billDocHtml({ subtotal: 42, nontax: 42, total: 42 })) || "zero food row");
d(51, F, "an MRP pile bigger than the bill is dropped, never a negative food row", "nontax 400 > subtotal 100", () => !/₹-/.test(B.billDocHtml({ subtotal: 100, nontax: 400, total: 100 })) || "negative money");
d(52, F, "a rate with no value prints no '%' — never 'CGST undefined%'", "taxRows rate missing", () => !/undefined%|NaN%/.test(B.billDocHtml({ taxRows: [{ label: "CGST", amt: 5 }, { label: "SGST", rate: NaN, amt: 5 }] })) || "raw rate printed");
d(53, F, "a 95-paise tax is printed in paise on both halves (0.50 + 0.45), never ₹1 + ₹0", "splitTax(0.95 … ) via a ₹19 bill", () => { const h = B.billDocHtml(B.billData({ orders: [{ status: "served", subtotal: 19, taxable_base: 19, items: [{ title: "Chai", qty: 1, price: 19 }] }], settings: { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }] } })); return (!/₹0<\/span>/.test(h.slice(0, h.indexOf("TOTAL"))) && /CGST 2\.5%<\/span><span>₹0\.\d\d/.test(h)) || (h.match(/CGST[^]{0,80}/) || [])[0]; });
// splitTax properties
d(54, F, "splitTax always hands out exactly the tax it was given (10,000 random cases)", "sum of rows == input", () => {
  for (let i = 0; i < 10000; i++) { const t = Math.floor(rnd() * 5000); const comps = pick([[{ label: "C", rate: 2.5 }, { label: "S", rate: 2.5 }], [{ label: "C", rate: 9 }, { label: "S", rate: 9 }, { label: "X", rate: 1 }], [{ label: "G", rate: 5 }]]); const rows = B.splitTax(t, comps); const sum = B.moneyRound(rows.reduce((a, r) => a + r.amt, 0)); if (Math.abs(sum - t) > 0.001) return `splitTax(${t}) summed to ${sum}`; }
  return true;
});
d(55, F, "splitTax never gives rupees to a 0% component", "a 0% line among others", () => B.splitTax(19, [{ label: "A", rate: 0 }, { label: "B", rate: 5 }]).every((r) => r.rate > 0) || "a 0% line carried money");
d(56, F, "splitTax with no components hands out nothing (no phantom line)", "[]", () => B.splitTax(19, []).length === 0 || "a line from nothing");
// moneyRound / orderTaxRate / combineBillLines / mrpTaxInside
d(57, F, "moneyRound agrees with Postgres on the half-paisa cases (0.035 → 0.04, 1.005 → 1.01, −0.035 → −0.04, 0 → 0)", "four cases", () => B.moneyRound(0.7 * 0.05) === 0.04 && B.moneyRound(1.005) === 1.01 && B.moneyRound(-0.035) === -0.04 && Object.is(B.moneyRound(-0.001), 0) || "drifted");
d(58, F, "orderTaxRate: a positive stamped rate wins over the settings", "{tax_rate:.18} with settings .05", () => B.orderTaxRate({ tax_rate: 0.18 }, 0.05) === 0.18 || "no");
d(59, F, "orderTaxRate: a stamped ZERO on an order that carries money is a real 0%", "{tax_rate:0, subtotal:100}", () => B.orderTaxRate({ tax_rate: 0, subtotal: 100 }, 0.05) === 0 || "re-taxed a 0% bill");
d(60, F, "orderTaxRate: a ₹0 line cannot drag the bill's rate to nothing", "{tax_rate:0, subtotal:0}", () => B.orderTaxRate({ tax_rate: 0, subtotal: 0 }, 0.05) === 0.05 || "dragged to 0");
d(61, F, "combineBillLines merges the same dish across KOTs into one line", "two Dal@100", () => { const r = B.combineBillLines([{ title: "Dal", price: 100, qty: 1 }, { title: "Dal", price: 100, qty: 2 }]); return (r.length === 1 && r[0].qty === 3) || JSON.stringify(r); });
d(62, F, "…but never merges two dishes that differ in price, add-on, removal or note", "four near-twins", () => B.combineBillLines([{ title: "S", price: 50 }, { title: "S", price: 150 }, { title: "S", price: 50, options: [{ label: "x" }] }, { title: "S", price: 50, note: "less oil" }, { title: "S", price: 50, removed: ["onion"] }]).length === 5 || "merged");
d(63, F, "combineBillLines: 'Special 1'@50 and 'Special'@150 stay apart (the separator is real)", "edge", () => B.combineBillLines([{ title: "Special 1", price: 50 }, { title: "Special", price: 150 }]).length === 2 || "merged");
d(64, F, "mrpTaxInside counts only inclusive MRP lines on live orders", "mix", () => { const v = B.mrpTaxInside([{ status: "served", items: [{ is_mrp: true, tax_mode: "incl", price: 21, qty: 2 }, { is_mrp: true, tax_mode: "exempt", price: 20, qty: 1 }] }, { status: "cancelled", items: [{ is_mrp: true, tax_mode: "incl", price: 21, qty: 9 }] }], 0.05); return v === 2 || v; });
d(65, F, "taxModel: a composition restaurant's rate IS zero (not 5% hidden)", "composition", () => B.taxModel({ price_tax_mode: "composition", tax_rate: 0.05 }).rate === 0 || "taxed");
d(66, F, "taxModel: named components sum to the rate; blank labels and 0% lines are dropped", "components", () => { const t = B.taxModel({ tax_components: [{ label: "CGST", rate: 2.5 }, { label: "", rate: 9 }, { label: "X", rate: 0 }, { label: "SGST", rate: 2.5 }] }); return (t.pct === 5 && t.components.length === 2) || JSON.stringify(t); });
d(67, F, "taxModel: nothing configured falls back to 5%", "{}", () => B.taxModel({}).pct === 5 || B.taxModel({}).pct);
d(68, F, "tipPct and discPct share one rounding: whole numbers clean, else one decimal", "10%, 12.5%", () => B.tipPct(200, 20) === "10%" && B.discPct(200, 25) === "12.5%" || "drifted");
d(69, F, "TIP_MAX is the server's ceiling (₹1,00,000)", "constant", () => B.TIP_MAX === 100000 || B.TIP_MAX);

// ── the kitchen ticket ──
const K = (o) => B.kotDocHtml({ kot: 7, tableLabel: "T5", when: "09:31 PM", rname: "Kitchen", ...o });
d(70, F, "the ticket carries no price — a KOT is for the kitchen", "lines with prices", () => !/₹|\b360\b/.test(K({ lines: [{ qty: 2, title: "Paneer", price: 360 }] })) || "a price on the ticket");
d(71, F, "a manual reprint is branded *** Reprint · Duplicate *** at the very top", "reprint:true", () => { const h = K({ reprint: true, lines: [{ qty: 1, title: "x" }] }); return (/\*\*\* Reprint · Duplicate \*\*\*/.test(h) && h.indexOf("Reprint · Duplicate") < h.indexOf('class="h"')) || "not on top"; });
d(72, F, "a first print is not", "reprint:false", () => !/Duplicate/.test(K({ lines: [{ qty: 1, title: "x" }] })) || "branded");
d(73, F, "the allergy warning prints above the food and above a shared note", "allergies + shared note", () => { const h = K({ allergies: ["peanuts"], lines: [{ qty: 1, title: "A", note: "no salt" }, { qty: 1, title: "B", note: "no salt" }] }); const a = h.indexOf("⚠ AVOID"), n = h.indexOf('class="on"'), f = h.indexOf('class="kl"'); return (a > 0 && a < n && n < f) || "order wrong"; });
d(74, F, "a note every line shares prints ONCE, above the dishes — not under each", "two lines, same note", () => { const h = K({ lines: [{ qty: 1, title: "A", note: "no salt" }, { qty: 1, title: "B", note: "no salt" }] }); return (h.match(/no salt/g) || []).length === 1 || "printed repeatedly"; });
d(75, F, "…a note on only one line prints under that line", "different notes", () => { const h = K({ lines: [{ qty: 1, title: "A", note: "no salt" }, { qty: 1, title: "B" }] }); return /A<br><small>&raquo; no salt/.test(h) || "note lost"; });
d(76, F, "removals print as '— no onion, garlic'", "removed", () => /— no onion, garlic/.test(K({ lines: [{ qty: 1, title: "A", removed: ["onion", "garlic"] }] })) || "missing");
d(77, F, "a quantity that is not a number prints as 1, never '[object Object]×'", "qty {} / 'x' / -2", () => !/object|NaN|-2×/.test(K({ lines: [{ qty: {}, title: "A" }, { qty: "x", title: "B" }, { qty: -2, title: "C" }] })) || "raw quantity");
d(78, F, "a ticket with no number prints 'KOT #—', never #undefined / #NaN", "kot undefined / NaN / {}", () => [undefined, NaN, {}, ""].every((k) => /KOT #—</.test(B.kotDocHtml({ kot: k }))) || "raw number");
d(79, F, "a ticket with no lines says '(no items)'", "lines []", () => /\(no items\)/.test(K({ lines: [] })) || "blank");
d(80, F, "every field on the ticket is printed as text", "markup in title/table/restaurant/note", () => !/<b>|<i>x/.test(B.kotDocHtml({ rname: "<b>R", tableLabel: "<b>T", lines: [{ qty: 1, title: "<b>D", note: "<i>x" }], allergies: ["<b>a"] })) || "markup obeyed");
d(81, F, "the ticket body is 280px — built for 66/80mm and left that way (R26)", "width:280px", () => /body\{font-family:ui-monospace,monospace;width:280px/.test(K({})) || "the ticket width changed");
d(82, F, "the ticket declares no @page SIZE (the queue's own short page paginates it)", "@page", () => /@page\{margin:0\}/.test(K({})) && !/@page\{size/.test(K({})) || "a page size is declared");
d(83, F, "the ticket has no toolbar or script unless it is a preview (a note)", "with and without note", () => !/<script|class="bar"/.test(K({})) && /class="bar"/.test(K({ note: "sample" })) || "chrome on a real ticket");
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
d(84, F, "an old ticket's month is always three letters — SEP, never SEPT — in every month", "kotWhen on the 15th of each month of 2025", () => { const bad = MONTHS.filter((m, i) => !new RegExp(`^15 ${m} `).test(B.kotWhen(`2025-${String(i + 1).padStart(2, "0")}-15T10:00:00+05:30`))); return bad.length === 0 || `wrong: ${bad.join(",")}`; });
d(85, F, "a ticket from today shows only the clock, in India's time", "now", () => /^\d\d:\d\d (AM|PM)$/.test(B.kotWhen(new Date())) || B.kotWhen(new Date()));
d(86, F, "'today' turns at 05:00 IST: a ticket from 04:00 today is YESTERDAY once it is past 05:00", "business day", () => {
  const now = new Date(); const ist = new Date(now.getTime() + 330 * 60000);
  if (ist.getUTCHours() < 6) return { skip: "run after 06:00 IST" };
  const y = ist.getUTCFullYear(), m = String(ist.getUTCMonth() + 1).padStart(2, "0"), dd = String(ist.getUTCDate()).padStart(2, "0");
  return /^YESTERDAY /.test(B.kotWhen(`${y}-${m}-${dd}T04:00:00+05:30`)) || B.kotWhen(`${y}-${m}-${dd}T04:00:00+05:30`);
});
d(87, F, "kotLineHtml survives a null option and an option object without a label", "options [null, {}, 'Extra']", () => /\(Extra\)/.test(B.kotLineHtml({ qty: 1, title: "A", options: [null, {}, "Extra"] })) || "dropped or threw");

// ── the banquet sheet ──
const BQ_SET = { banquet_tax_components: [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }] };
const bqLines = (n) => Array.from({ length: n }, (_, i) => ({ title: `Item ${i}`, qty: 1 + (i % 5), price: 100 + i * 37 }));
d(88, F, "on 500 random banquet sheets each tax column foots to its TOTAL row and no cell is negative", "frozen tax_lines absent, random discounts", () => {
  for (let i = 0; i < 500; i++) {
    const lines = bqLines(1 + Math.floor(rnd() * 8));
    const sub = lines.reduce((a, l) => a + l.qty * l.price, 0);
    const disc = rnd() < 0.5 ? Math.round(sub * rnd() * 0.3) : 0;
    const tax = B.moneyRound((sub - disc) * 0.18);
    const h = B.banquetDocHtml({ bill: { subtotal: sub, discount: disc, tax, total: B.moneyRound(sub - disc + tax) }, lines, settings: BQ_SET });
    if (/>-[\d]/.test(h)) return `sheet #${i} prints a negative cell`;
    const tot = h.match(/<tr class="tot">([\s\S]*?)<\/tr>/)[1];
    const totals = [...tot.matchAll(/class="r">([\d,.]+)</g)].map((m) => Number(m[1].replace(/,/g, "")));
    const rowsHtml = h.slice(h.indexOf("<tbody>"), h.indexOf('<tr class="tot">'));
    const cells = [...rowsHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<td class="r">([\d,.]+)<\/td>/g)].map((m) => Number(m[1].replace(/,/g, ""))));
    for (let col = 1; col < totals.length + 1; col++) {   // col 0 = rate, then taxable, then per-component amounts
      const sum = B.moneyRound(cells.reduce((a, r) => a + (r[col] || 0), 0));
      if (Math.abs(sum - totals[col - 1]) > 0.011) return `sheet #${i} column ${col}: ${sum} vs ${totals[col - 1]}`;
    }
  }
  return true;
});
d(89, F, "the amount in words names the same amount as the figure, with Rupee/Rupees and Paisa/Paise", "five amounts", () => B.bqWords(1) === "One Rupee Only" && B.bqWords(2) === "Two Rupees Only" && B.bqWords(1.01) === "One Rupee and One Paisa Only" && B.bqWords(0) === "Zero Rupees Only" && /^Minus Five Rupees Only$/.test(B.bqWords(-5)) || [1, 2, 1.01, 0, -5].map(B.bqWords).join(" | "));
d(90, F, "…and uses the Indian grouping: Crore, Lakh, Thousand", "1,23,45,678.50", () => B.bqWords(12345678.5) === "One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight Rupees and Fifty Paise Only" || B.bqWords(12345678.5));
d(91, F, "a garbled advance date prints no date — never 'Invalid Date' — and keeps the money", "advance date 'soon'", () => { const h = B.banquetDocHtml({ bill: { advances: [{ amt: 500, mode: "upi", date: "soon" }], subtotal: 100, tax: 5, total: 105 }, lines: [] }); return (!/Invalid Date/.test(h) && /UPI PAY — 500\/-/.test(h)) || (h.match(/UPI[^<]*/) || [])[0]; });
d(92, F, "a banquet booked on a renamed table prints the table's name", "table_number 5, table_names {5:'Terrace'}", () => /Terrace/.test(B.banquetDocHtml({ bill: { table_number: 5, subtotal: 1, tax: 0, total: 1 }, lines: [], settings: { table_names: { 5: "Terrace" } } })) || "bare number");
d(93, F, "A4 is declared A4 and A5 A5 — the sheet's own page size (the tray really holds it)", "banquet_paper_size", () => /@page\{size:210mm 297mm/.test(B.banquetDocHtml({ bill: {}, lines: [], settings: { banquet_paper_size: "a4" } })) && /@page\{size:148mm 210mm/.test(B.banquetDocHtml({ bill: {}, lines: [], settings: {} })) || "size wrong");
d(94, F, "'Prepared by' prints only when the restaurant turned that field on", "banquet_fields with/without 'by'", () => /Prepared by Ravi/.test(B.banquetDocHtml({ bill: { prepared_by: "Ravi" }, lines: [], settings: { banquet_fields: ["by"] } })) && !/Prepared by/.test(B.banquetDocHtml({ bill: { prepared_by: "Ravi" }, lines: [], settings: {} })) || "wrong");
d(95, F, "a received amount stamps PAID IN FULL or BALANCE DUE with the right figure", "received = total / less", () => /PAID IN FULL/.test(B.banquetDocHtml({ bill: { subtotal: 100, tax: 5, total: 105, received: 105 }, lines: [] })) && /BALANCE DUE 5\.00/.test(B.banquetDocHtml({ bill: { subtotal: 100, tax: 5, total: 105, received: 100 }, lines: [] })) || "stamp wrong");
d(96, F, "the banquet toolbar's preview never fires the print dialog by itself", "autoPrint:false", () => !/setTimeout\(printAgain/.test(B.banquetDocHtml({ bill: {}, lines: [], autoPrint: false })) && /setTimeout\(printAgain, 350\)/.test(B.banquetDocHtml({ bill: {}, lines: [] })) || "wrong");
d(97, F, "every banquet field is printed as text", "markup in customer, hall, remark", () => !/<b>X/.test(B.banquetDocHtml({ bill: { cust_name: "<b>X", hall: "<b>X", remark: "<b>X", func: "<b>X" }, lines: [{ title: "<b>X", qty: 1, price: 1 }] })) || "markup obeyed");

// ── the thermal recipe — the two traps (58/80mm) ──
const BH = B.billDocHtml({});
d(98, F, "the bill prints a 66mm column centred, at print time", "@media print body width:66mm", () => /@media print\{body\{margin:0 auto !important;padding:2mm 0 !important;width:66mm !important/.test(BH) || "recipe changed");
d(99, F, "the bill declares NO @page size (the sideways-at-half-size fault, 2026-08-19)", "@page", () => /@page\{margin:0\}/.test(BH) && !/@page\{size/.test(BH) || "a size is declared");
d(100, F, "the bill is a FRAGMENT — no <html>, <head> or <body> (lib/printDocs places its band by that)", "tags", () => (BH.startsWith("<!doctype html><title>") && !/<body|<html|<head/.test(BH)) || "the shape changed — testBand/withPaper rely on it");
d(101, F, "the preview is the print: the screen column is the same 66mm, zoomed only for display", "@media screen width:72mm + zoom; print zoom:1", () => /@media print\{body\{zoom:1 !important\}\}/.test(BH) && /width:66mm;margin:0 auto;padding:2mm 0/.test(BH) || "screen and print differ");
d(102, F, "a long bill prints its item header once and never splits a row across pages", "thead row-group + break-inside", () => /thead\{display:table-row-group\}/.test(BH) && /tr,\.t,\.g,\.kv,h2,\.sub\{break-inside:avoid/.test(BH) || "pagination rules lost");
d(103, F, "one ink: nothing grey on the paper (a thermal head has no grey)", "every colour in the print CSS (comments stripped) is #000", () => { const css = BH.slice(BH.indexOf("<style>"), BH.indexOf(".bar{")).replace(/\/\*[\s\S]*?\*\//g, ""); const cols = [...css.matchAll(/#[0-9a-f]{3,6}\b/gi)].map((m) => m[0].toLowerCase()).filter((c) => !["#000", "#fff", "#e9e9ec"].includes(c)); return cols.length === 0 || `colours: ${cols.join(",")}`; });
d(104, F, "the bill window's zoom key remembers per screen shape, under the app's prefix", "zKey", () => /lfh_bill_zoom/.test(B.billDocHtml({})) || "key changed");
d(105, F, "Print and Close never close the bill on afterprint (Cancel looks the same to the page)", "onafterprint only focuses", () => /onafterprint = function\(\)\{ try\{ var b = document\.querySelector\("\.bar \.x"\); if \(b\) b\.focus\(\);/.test(BH) && !/onafterprint[^\n]*close\(\)/.test(BH) || "afterprint closes the window");
d(106, F, "Esc closes a bill window opened on its own", "keydown Escape → closeBill", () => /e\.key === "Escape"\) closeBill\(\)/.test(BH) || "no Esc");
d(107, F, "the file stores nothing on the device except the zoom choice, and makes no request", "localStorage / fetch scan of the source", () => { const s = read(F); return !/fetch\(|XMLHttpRequest/.test(s) && (s.match(/localStorage\.(get|set)Item\([^)]*\)/g) || []).every((x) => /zKey|ZKEY_OLD/.test(x)) || "unexpected storage or request"; });
d(108, F, "it loads in all three worlds: module.exports, globalThis, and a plain window", "export lines", () => /module\.exports = API/.test(read(F)) && /globalThis\.LFH_BILLDOC = API/.test(read(F)) || "a world dropped");

