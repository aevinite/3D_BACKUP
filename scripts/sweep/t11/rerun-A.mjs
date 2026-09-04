// Section A of T8.md re-run for real — the BILL document (billDocHtml, billRows), P03501–P03555.
import { BILLDOC as B, read, visible, totalRows, baseBill, row } from "./lib.mjs";

const H = (o) => B.billDocHtml(baseBill(o));
const foots = (d) => {
  const R = B.billRows(d);
  const base = R.disc > 0 ? R.taxable : R.subtotal;
  const sum = base + (R.inclusive ? 0 : R.tax) + R.nontax + R.roundOff;
  return sum === R.total ? true : `rows add to ${sum}, TOTAL says ${R.total}`;
};

row("P03501", "billDocHtml escapes every caller string it interpolates", () => {
  const evil = '<script>x</script> & "q"';
  const h = B.billDocHtml(baseBill({
    name: evil, addr: evil, phone: evil, gstin: evil, footer: evil, tableDisp: evil, dateStr: evil,
    cust: evil, custPhone: evil, discLabel: evil, discount: 50, mrpLabel: evil, mrpNote: evil,
    nontax: 100, note: evil, invNo: evil,
    lines: [{ title: evil, qty: 1, price: 100, options: [{ label: evil, price: 10 }] }],
  }));
  const body = h.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script>\n[\s\S]*?<\/script>/g, "");
  if (/<script>x<\/script>/.test(body)) return "the raw <script> tag reached the document";
  return /&lt;script&gt;/.test(body) || "the escaped form is not there either";
});
row("P03502", "the <title> is escaped too", () => {
  const t = /<title>([\s\S]*?)<\/title>/.exec(B.billDocHtml(baseBill({ name: 'Bob & "Co" <b>' })));
  if (!t) return "no <title>";
  return (/&amp;/.test(t[1]) && /&lt;/.test(t[1]) && !/<b>/.test(t[1])) || `title reads ${t[1]}`;
});
row("P03503", "esc() covers all five of & < > \" '", () => {
  const h = B.billDocHtml(baseBill({ name: `&<>"'` }));
  const t = /<h2>([\s\S]*?)<\/h2>/.exec(h)[1];
  const want = ["&amp;", "&lt;", "&gt;", "&quot;", "&#39;"];
  const miss = want.filter((w) => !t.includes(w));
  return miss.length === 0 || `missing ${miss.join(" ")} — got ${t}`;
});
row("P03504", "the logo src is escaped and fails soft", () => {
  const h = H({ logo: 'x" onload="bad()' });
  return (/class="logo"/.test(h) && /onerror=/.test(h) && !/onload="bad\(\)/.test(h)) || "the logo branch is not escaped or has no onerror";
});
row("P03505", "an absent logo prints no <img> at all", () => !/class="logo"/.test(H({})) || 'class="logo" rendered with no logo');
row("P03506", "inr() prints whole rupees with Indian grouping and never a decimal", () =>
  B.inr(107880.4) === "₹1,07,880" || `inr(107880.4) = ${B.inr(107880.4)}`);
row("P03507", "inr() of a non-number is ₹0, never ₹NaN", () => {
  const bad = ["x", undefined, null, NaN, {}].map((v) => B.inr(v)).filter((s) => s !== "₹0");
  return bad.length === 0 || `got ${bad.join(" ")}`;
});
row("P03508", "the qty/rate/amt column formatter never emits NaN", () => {
  const h = H({ lines: [{ title: "X", qty: "abc", price: "zzz" }] });
  return !/NaN/.test(h) || "NaN reached the paper";
});
row("P03509", "an item row's base unit is the unit price MINUS its priced add-ons", () => {
  const h = H({ lines: [{ title: "X", qty: 2, price: 120, options: [{ label: "Cheese", price: 20 }] }] });
  const v = visible(h);
  // base 100 × 2 = 200, add-on 20 × 2 = 40 → 240 total for the line
  return (v.includes("100") && v.includes("200") && v.includes("40")) || `rows read ${v.slice(0, 24).join("/")}`;
});
row("P03510", "add-on sub-lines only render for options that carry a price", () => {
  const h = H({ lines: [{ title: "X", qty: 1, price: 100, options: [{ label: "Free note", price: 0 }] }] });
  return !/Free note/.test(h) || "a free option printed a money sub-line";
});
row("P03511", "a zero-priced option is dropped rather than printed as + Extra ₹0", () => {
  const h = H({ lines: [{ title: "X", qty: 1, price: 100, options: [{ label: "Extra", price: 0 }, { label: "Paid", price: 5 }] }] });
  return (!/Extra/.test(h) && /Paid/.test(h)) || "the zero option is on the paper, or the paid one is not";
});
row("P03512", "the money columns are sized from THIS bill's widest figure", () => {
  const wide = /<col style="width:calc\((\d+)ch/g;
  const a = [...H({ lines: [{ title: "X", qty: 1, price: 9 }] }).matchAll(wide)].map((m) => m[1]).join(",");
  const b = [...H({ lines: [{ title: "X", qty: 1, price: 1070880 }] }).matchAll(wide)].map((m) => m[1]).join(",");
  return a !== b || `both bills declared the same widths (${a})`;
});
row("P03513", "the Qty/Rate/Amt columns are never narrower than their own headings", () => {
  const cols = [...H({ lines: [{ title: "X", qty: 1, price: 1 }] }).matchAll(/<col style="width:calc\((\d+)ch/g)].map((m) => +m[1]);
  return (cols.length === 3 && cols[0] >= 3 && cols[1] >= 4 && cols[2] >= 3) || `widths ${cols.join(",")}`;
});
row("P03514", "a long dish name cannot push the money columns off the roll", () => {
  const h = H({ lines: [{ title: "A".repeat(60), qty: 1, price: 100 }] });
  return (/table-layout:fixed/.test(h) && /word-break:break-word/.test(h)) || "the fixed layout or the word-break is gone";
});
row("P03515", "an MRP line wears its MRP stamp beside the dish name", () => {
  const h = H({ lines: [{ title: "Water", qty: 1, price: 20, is_mrp: true }] });
  return /Water<span class="mrpt">MRP<\/span>/.test(h) || "the stamp is not next to the name";
});
row("P03516", "a non-MRP line carries no stamp", () => !/mrpt/.test(H({}).replace(/<style[\s\S]*?<\/style>/, "")) || "a stamp rendered on an ordinary line");
row("P03517", "billRows clamps a discount larger than the row it comes off", () => {
  const R = B.billRows({ subtotal: 100, discount: 150, total: 100 });
  return (R.discount === 100 && R.taxable === 0) || `discount ${R.discount}, taxable ${R.taxable}`;
});
row("P03518", "the printed discount percentage agrees with the rupees beside it when the clamp bites", () => {
  const v = visible(H({ subtotal: 100, discount: 150, discLabel: "150%", total: 100, taxRows: [], lines: [{ title: "X", qty: 1, price: 100 }] }));
  const i = v.findIndex((x) => /^Discount/.test(x));
  if (i < 0) return "no Discount row";
  return !/150%/.test(v[i]) || `the row still reads ${v[i]}`;
});
row("P03519", "an ordinary discount keeps the caller's own label verbatim", () => {
  const v = visible(H({ subtotal: 400, discount: 40, discLabel: "10%", total: 380 }));
  return v.some((x) => x === "Discount (10%)") || `rows: ${v.filter((x) => /Discount/.test(x)).join("/") || "none"}`;
});
row("P03520", "Taxable value is a restatement (subtotal − discount), never a caller figure", () => {
  const R = B.billRows({ subtotal: 400, discount: 40, taxable: 999999, total: 378 });
  return R.taxable === 360 || `taxable ${R.taxable}`;
});
row("P03521", "the Taxable value row is suppressed on a tax-inside bill", () =>
  !visible(H({ discount: 40, taxIncluded: true })).includes("Taxable value") || "it printed on a tax-inside bill");
row("P03522", "the Taxable value row is suppressed on a composition Bill of Supply", () =>
  !visible(H({ discount: 40, composition: true, taxRows: [] })).includes("Taxable value") || "it printed on a Bill of Supply");
row("P03523", "the Taxable value row is suppressed when explicit inclRows are supplied", () =>
  !visible(H({ discount: 40, inclRows: [{ label: "CGST", rate: 2.5, amt: 5 }] })).includes("Taxable value") || "it printed beside inclRows");
row("P03524", "with no discount there is no Discount row and no restatement", () => {
  const v = visible(H({ discount: 0 }));
  return (!v.some((x) => /^Discount/.test(x)) && !v.includes("Taxable value")) || "a discount row printed with no discount";
});
row("P03525", "a Round off row appears only when the whole-rupee rows cannot reach the TOTAL", () => {
  const none = visible(H({ subtotal: 400, total: 420 }));
  const some = visible(H({ subtotal: 400, total: 423 }));
  return (!none.includes("Round off") && some.includes("Round off")) || "the round-off row is on the wrong bill";
});
row("P03526", "the Round off row shows its sign and an absolute amount, never −₹-2", () => {
  const v = visible(H({ subtotal: 400, total: 418 }));
  const i = v.indexOf("Round off");
  return (i >= 0 && /^− ₹2$/.test(v[i + 1])) || `the row reads ${v[i + 1]}`;
});
const feet = [
  ["P03527", "a discounted 5% bill", { subtotal: 400, discount: 40, total: 378, taxRows: [{ label: "C", rate: 2.5, amt: 9 }, { label: "S", rate: 2.5, amt: 9 }] }],
  ["P03528", "an undiscounted bill", { subtotal: 400, discount: 0, total: 420, taxRows: [{ label: "C", rate: 2.5, amt: 10 }, { label: "S", rate: 2.5, amt: 10 }] }],
  ["P03529", "a paise-level 18% bill", { subtotal: 201, discount: 0, total: 237, taxRows: [{ label: "C", rate: 9, amt: 18 }, { label: "S", rate: 9, amt: 18 }] }],
  ["P03530", "a bill carrying EXEMPT MRP lines", { subtotal: 442, nontax: 42, discount: 0, total: 462, taxRows: [{ label: "C", rate: 2.5, amt: 10 }, { label: "S", rate: 2.5, amt: 10 }] }],
  ["P03531", "an MRP bill WITH a discount", { subtotal: 442, nontax: 42, discount: 40, total: 422, taxRows: [{ label: "C", rate: 2.5, amt: 9 }, { label: "S", rate: 2.5, amt: 9 }] }],
  ["P03532", "a tax-inside bill, discounted", { subtotal: 400, discount: 40, total: 360, taxIncluded: true, taxRows: [{ label: "C", rate: 2.5, amt: 9 }, { label: "S", rate: 2.5, amt: 9 }] }],
  ["P03533", "a composition bill with a discount", { subtotal: 880, discount: 50, total: 830, taxRows: [] }],
  ["P03534", "a mixed-rate bill (5% food beside an 18% banquet)", { subtotal: 1400, discount: 0, total: 1526, taxRows: [{ label: "CGST", rate: 2.5, amt: 10 }, { label: "SGST", rate: 2.5, amt: 10 }, { label: "CGST", rate: 9, amt: 53 }, { label: "SGST", rate: 9, amt: 53 }] }],
];
for (const [id, what, d] of feet) row(id, `the rows above the TOTAL foot to it — ${what}`, () => foots(d));
row("P03535", "the TOTAL is passed straight through — no fix may move what is charged", () => {
  const odd = [{ subtotal: 400, discount: 40, total: 378.6 }, { subtotal: 0, discount: 0, total: 0 }, { subtotal: 1, discount: 150, total: 1 }];
  const bad = odd.filter((d) => B.billRows(d).total !== Math.round(d.total));
  return bad.length === 0 || `${bad.length} case(s) moved the total`;
});
row("P03536", "the first money row is named Food subtotal only when there really are untaxed lines", () => {
  const withMrp = visible(H({ subtotal: 442, nontax: 42, total: 462 }));
  const without = visible(H({ subtotal: 400, nontax: 0, total: 420 }));
  return (withMrp.includes("Food subtotal") && without.includes("Subtotal") && !without.includes("Food subtotal"))
    || "the label is on the wrong bill";
});
row("P03537", "the MRP row is added AFTER the tax rows", () => {
  const v = visible(H({ subtotal: 442, nontax: 42, total: 462 }));
  return (v.indexOf("MRP items") > v.indexOf("CGST 2.5%")) || "the MRP row is above the tax";
});
row("P03538", "tax rows are suppressed entirely on a tax-inclusive bill", () => {
  const v = visible(H({ taxIncluded: true, total: 400, subtotal: 400 }));
  const above = v.slice(0, v.indexOf("TOTAL"));
  return !above.some((x) => /^CGST/.test(x)) || "an added tax row printed above the TOTAL on a tax-inside bill";
});
row("P03539", "Price includes renders under the TOTAL when inclRows is non-empty", () => {
  const v = visible(H({ inclRows: [{ label: "CGST", rate: 2.5, amt: 5 }] }));
  return (v.includes("Price includes") && v.indexOf("Price includes") > v.indexOf("TOTAL")) || "it is missing or above the TOTAL";
});
row("P03540", "a bill can carry BOTH added tax and inside tax and still foot", () =>
  foots({ subtotal: 400, discount: 0, total: 410, taxRows: [{ label: "C", rate: 2.5, amt: 10 }], inclRows: [{ label: "C", rate: 2.5, amt: 5 }] }));
row("P03541", "taxRows: [] prints no tax line at all", () => {
  // Read the MONEY BLOCK, not the whole sheet: the letterhead carries a "GSTIN …" line, and a
  // /GST/ over the whole document matches that. (My first version of this check did exactly that
  // and reported a fault in code that was correct — the detector being wrong, which is the thing
  // this ledger's own notes warn about three times.)
  const labels = totalRows(H({ taxRows: [], subtotal: 400, total: 400 })).map((r) => r[0]);
  return !labels.some((l) => /GST|Tax\b/.test(l)) || `money rows: ${labels.join(" / ")}`;
});
row("P03542", "the composition declaration prints on a Bill of Supply", () =>
  /Composition taxable person/.test(H({ composition: true, taxRows: [] })) || "the declaration is missing");
row("P03543", "…and never on a cancelled sheet", () =>
  !/Composition taxable person/.test(H({ composition: true, cancelled: true, taxRows: [] })) || "it printed on a cancelled sheet");
row("P03544", "the document is headed Bill of Supply for a composition restaurant, in the title AND the kind row", () => {
  const h = H({ composition: true, taxRows: [] });
  return (/<title>Bill of Supply/.test(h) && /<div class="kind">Bill of Supply</.test(h)) || "one of the two still says Tax Invoice";
});
row("P03545", "a cancelled bill is headed Cancelled Bill, never Tax Invoice", () => {
  const h = H({ cancelled: true });
  return (/<title>Cancelled Bill/.test(h) && !/Tax Invoice/.test(h)) || "the cancelled sheet still calls itself a Tax Invoice";
});
row("P03546", "a cancelled bill carries the Cancelled — no charge band above the kind row", () => {
  const h = H({ cancelled: true });
  return (/class="vband">Cancelled — no charge</.test(h) && h.indexOf("vband") < h.indexOf('class="kind"')) || "the band is missing or below the kind row";
});
row("P03547", "a cancelled bill still LISTS what was ordered", () =>
  /Dal Makhani/.test(H({ cancelled: true })) || "the item rows vanished from the void record");
row("P03548", "a cancelled bill's money block is Ordered value / Cancelled — not charged / TOTAL ₹0, and nothing else", () => {
  const rows_ = totalRows(H({ cancelled: true, discount: 40, nontax: 42, subtotal: 442, total: 462 }));
  const labels = rows_.map((r) => r[0]);
  const want = ["Ordered value", "Cancelled — not charged"];
  const extra = labels.filter((l) => !want.includes(l));
  return (want.every((w) => labels.includes(w)) && extra.length === 0) || `rows: ${labels.join(" / ")}`;
});
row("P03549", "the Ordered value is added from the SAME item rows printed above it", () => {
  const v = visible(H({ cancelled: true, lines: [{ title: "A", qty: 2, price: 200 }, { title: "B", qty: 1, price: 50 }] }));
  const i = v.indexOf("Ordered value");
  return (i >= 0 && v[i + 1] === "₹450") || `Ordered value reads ${v[i + 1]}`;
});
row("P03550", "a cancelled bill keeps its customer block", () => {
  const h = H({ cancelled: true, cust: "Asha", custPhone: "9825012345" });
  return (/Asha/.test(h) && /Customer/.test(h)) || "the customer block was dropped from the void record";
});
row("P03551", "a cancelled PARCEL bill still says Parcel and shows no Table row", () => {
  const v = visible(H({ cancelled: true, parcel: true }));
  return (v.includes("Parcel") && !v.includes("Table")) || `rows: ${v.slice(0, 14).join("/")}`;
});
row("P03552", "the customer block hides each of its two lines independently", () => {
  const onlyName = visible(H({ cust: "Asha", custPhone: "" }));
  const onlyPhone = visible(H({ cust: "", custPhone: "9825012345" }));
  return (onlyName.includes("Customer") && !onlyName.includes("Mobile")
    && onlyPhone.includes("Mobile") && !onlyPhone.includes("Customer")) || "the two lines are not independent";
});
row("P03553", "a Bill no of 0 still prints its row (0 is a number, not missing)", () => {
  const v = visible(H({ invNo: "", billNo: 0 }));
  return (v.includes("Bill no") && v.includes("#0")) || "a bill numbered 0 lost its row";
});
row("P03554", "an absent Invoice number prints no Invoice row rather than an empty one", () => {
  const v = visible(H({ invNo: "", billNo: 7 }));
  return !v.includes("Invoice") || "an empty Invoice row printed";
});
row("P03555", "a parcel bill prints Parcel with nothing where a table number would go", () => {
  const h = H({ parcel: true, tableDisp: "5" });
  return (/<span>Parcel<\/span><b><\/b>/.test(h) && !/<span>Table<\/span>/.test(h)) || "the parcel header is wrong";
});
