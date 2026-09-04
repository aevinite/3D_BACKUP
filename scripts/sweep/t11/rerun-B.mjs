// Section B of T8.md re-run — the bill's MONEY, P03556–P03615.
import { BILLDOC as B, read, visible, totalRows, baseBill, row } from "./lib.mjs";

const S5 = { tax_rate: 0.05 };
const ord = (o) => ({ id: "o" + Math.random(), status: "served", subtotal: 100, taxable_base: 100, items: [{ title: "X", qty: 1, price: 100, tax_mode: "excl" }], ...o });
const money = (orders, s = S5) => B.billMoney(orders, s);

row("P03556", "billMoney drops a CANCELLED order from the subtotal, the tax and the TOTAL", () => {
  const m = money([ord({}), ord({ status: "cancelled", subtotal: 500, taxable_base: 500 })]);
  return m.total === 105 || `total ${m.total}`;
});
row("P03557", "billMoney drops a SOFT-DELETED order the same way", () => {
  const m = money([ord({}), ord({ deleted_at: "2026-09-01T00:00:00Z", subtotal: 500, taxable_base: 500 })]);
  return m.total === 105 || `total ${m.total}`;
});
row("P03558", "billData's printed item rows drop the SAME orders the money does", () => {
  const orders = [ord({ items: [{ title: "Live", qty: 1, price: 100, tax_mode: "excl" }] }),
    ord({ deleted_at: "2026-09-01T00:00:00Z", items: [{ title: "Tomb", qty: 1, price: 100, tax_mode: "excl" }] })];
  const d = B.billData({ settings: S5, restaurant: {}, orders, session: {}, tableDisp: "1" });
  const titles = d.lines.map((l) => l.title);
  return (titles.includes("Live") && !titles.includes("Tomb")) || `rows: ${titles.join(",")}`;
});
row("P03559", "mrpTaxInside uses that same predicate (status + deleted_at)", () => {
  const mk = (o) => ({ ...o, items: [{ is_mrp: true, tax_mode: "incl", qty: 1, price: 105 }] });
  const live = B.mrpTaxInside([mk({ status: "served" })], 0.05);
  const dead = B.mrpTaxInside([mk({ status: "served", deleted_at: "x" }), mk({ status: "cancelled" })], 0.05);
  return (live > 0 && dead === 0) || `live ${live}, dead ${dead}`;
});
row("P03560", "an all-cancelled bill is detected by 'every order cancelled', not by 'no live orders'", () => {
  const allDead = B.billData({ settings: S5, restaurant: {}, orders: [ord({ deleted_at: "x" })], session: {} });
  const allVoid = B.billData({ settings: S5, restaurant: {}, orders: [ord({ status: "cancelled" })], session: {} });
  return (allVoid.cancelled === true && allDead.cancelled === false) || `voided=${allVoid.cancelled}, tombstoned=${allDead.cancelled}`;
});
row("P03561", "an all-cancelled bill re-shows the cancelled orders as its item rows", () => {
  const d = B.billData({ settings: S5, restaurant: {}, orders: [ord({ status: "cancelled", items: [{ title: "Void dish", qty: 1, price: 100 }] })], session: {} });
  return d.lines.some((l) => l.title === "Void dish") || "the void record has no rows";
});
row("P03562", "a bill with SOME orders cancelled prints only the live ones and is NOT marked cancelled", () => {
  const d = B.billData({ settings: S5, restaurant: {}, orders: [
    ord({ items: [{ title: "Live", qty: 1, price: 100, tax_mode: "excl" }] }),
    ord({ status: "cancelled", items: [{ title: "Void", qty: 1, price: 100 }] })], session: {} });
  const t = d.lines.map((l) => l.title);
  return (d.cancelled === false && t.includes("Live") && !t.includes("Void")) || `cancelled=${d.cancelled} rows=${t.join(",")}`;
});
row("P03563", "orderTaxRate honours a positive stamped rate (mig 284)", () => B.orderTaxRate({ tax_rate: 0.18, subtotal: 100 }, 0.05) === 0.18 || "the stamped 18% was ignored");
row("P03564", "…honours a stamped ZERO from an order that carries money", () => B.orderTaxRate({ tax_rate: 0, subtotal: 100 }, 0.05) === 0 || "a stamped 0 was re-taxed at the settings rate");
row("P03565", "…falls back to the settings rate for a ₹0 line", () => B.orderTaxRate({ tax_rate: 0, subtotal: 0 }, 0.05) === 0.05 || "a ₹0 line dragged the bill's rate to nothing");
row("P03566", "…falls back for a never-stamped order", () => B.orderTaxRate({ subtotal: 100 }, 0.05) === 0.05 || "a never-stamped order did not fall back");
row("P03567", "…survives a null order", () => B.orderTaxRate(null, 0.05) === 0.05 || "it threw or answered wrongly on null");
row("P03568", "lib/paySplit.ts uses this ONE definition rather than its own copy", () => {
  const ps = read("lib/paySplit.ts");
  return /orderTaxRate/.test(ps) || "paySplit no longer calls orderTaxRate — the two rules can drift again";
});
row("P03569", "tax is charged per RATE BUCKET, each rounded once", () => {
  // three ₹33.33 orders at 5%: per-order rounding drifts, one bucket does not
  const m = money([1, 2, 3].map(() => ord({ subtotal: 33.33, taxable_base: 33.33, tax_rate: 0.05 })));
  return m.tax === 5 || `tax ${m.tax} (one bucket of 99.99 at 5% is 5)`;
});
row("P03570", "a mixed-rate bill taxes 5% food and an 18% banquet each at its own rate", () => {
  const m = money([ord({ subtotal: 1000, taxable_base: 1000, tax_rate: 0.05 }), ord({ subtotal: 1000, taxable_base: 1000, tax_rate: 0.18 })]);
  return (m.tax === 230 && m.mixedRates === true) || `tax ${m.tax}, mixedRates ${m.mixedRates}`;
});
row("P03571", "each bucket caps its own discount at its own base", () => {
  const m = money([ord({ subtotal: 100, taxable_base: 100, discount: 500, tax_rate: 0.05 }), ord({ subtotal: 1000, taxable_base: 1000, tax_rate: 0.18 })]);
  const b5 = (m.rateRows || []).find((r) => r.rate === 0.05);
  return (b5 && b5.taxable === 0 && b5.tax === 0) || `the 5% bucket is ${JSON.stringify(b5)}`;
});
row("P03572", "the headline rate is the biggest TAXED slice, not whichever order came first", () => {
  const m = money([ord({ subtotal: 10, taxable_base: 10, tax_rate: 0.05 }), ord({ subtotal: 5000, taxable_base: 5000, tax_rate: 0.18 })]);
  return m.rate === 0.18 || `headline rate ${m.rate}`;
});
row("P03573", "mixedRates is true only when more than one distinct rate is present", () => {
  const same = money([ord({ tax_rate: 0.05 }), ord({ tax_rate: 0.05 })]);
  const diff = money([ord({ tax_rate: 0.05 }), ord({ tax_rate: 0.18 })]);
  return (same.mixedRates === false && diff.mixedRates === true) || `same=${same.mixedRates} diff=${diff.mixedRates}`;
});
row("P03574", "the discount base is the TAXABLE base when the bill carries tax", () => {
  const m = money([ord({ subtotal: 142, taxable_base: 100, nontax_amount: 42, tax_rate: 0.05 })]);
  return m.discountBase === 100 || `discountBase ${m.discountBase}`;
});
row("P03575", "…and everything except the locked MRP when it does not", () => {
  const m = money([ord({ subtotal: 142, taxable_base: 100, nontax_amount: 42, tax_rate: 0, items: [{ is_mrp: true, qty: 1, price: 42, tax_mode: "exempt" }] })], { price_tax_mode: "composition" });
  return m.discountBase === Math.round((m.subtotal - m.mrpAmount) * 100) / 100 || `discountBase ${m.discountBase} vs subtotal ${m.subtotal} − mrp ${m.mrpAmount}`;
});
row("P03576", "the bill's discount is clamped to its own base", () => {
  const m = money([ord({ subtotal: 100, taxable_base: 100, discount: 5000, tax_rate: 0.05 })]);
  return (m.disc === 100 && m.total >= 0) || `disc ${m.disc}, total ${m.total}`;
});
row("P03577", "taxable is floored at 0", () => money([ord({ subtotal: 100, taxable_base: 100, discount: 5000 })]).taxable === 0 || "taxable went below zero");
row("P03578", "taxInside + taxAdded === tax, always", () => {
  const cases = [
    [ord({ tax_rate: 0.05 })],
    [ord({ tax_rate: 0.05, items: [{ qty: 1, price: 105, tax_mode: "incl" }] })],
    [ord({ tax_rate: 0.18, items: [{ qty: 3, price: 41.33, tax_mode: "incl" }] })],
    [ord({ tax_rate: 0.05, items: [{ qty: 1, price: 50, tax_mode: "incl" }, { qty: 1, price: 50, tax_mode: "excl" }] })],
  ];
  const bad = cases.map(money).filter((m) => Math.round((m.taxInside + m.taxAdded) * 100) !== Math.round(m.tax * 100));
  return bad.length === 0 || `${bad.length} of ${cases.length} did not add up`;
});
row("P03579", "on an ordinary bill taxInside is 0 and taxAdded is the whole tax", () => {
  const m = money([ord({ tax_rate: 0.05 })]);
  return (m.taxInside === 0 && m.taxAdded === m.tax) || `inside ${m.taxInside}, added ${m.taxAdded}, tax ${m.tax}`;
});
row("P03580", "grossTaxed equals taxableBase on an ordinary bill and is larger on a tax-inside one", () => {
  const plain = money([ord({ tax_rate: 0.05 })]);
  const incl = money([ord({ tax_rate: 0.05, subtotal: 100, taxable_base: 100, items: [{ qty: 1, price: 105, tax_mode: "incl" }] })]);
  return (plain.grossTaxed === plain.taxableBase && incl.grossTaxed > incl.taxableBase)
    || `plain ${plain.grossTaxed}/${plain.taxableBase}, incl ${incl.grossTaxed}/${incl.taxableBase}`;
});
row("P03581", "an exempt line contributes to neither grossTaxed nor netIncl", () => {
  const m = money([ord({ tax_rate: 0.05, items: [{ qty: 1, price: 100, tax_mode: "excl" }, { qty: 1, price: 999, tax_mode: "exempt" }] })]);
  return m.grossTaxed === 100 || `grossTaxed ${m.grossTaxed}`;
});
row("P03582", "taxComponents are carried through ONLY when their sum really is this bill's rate", () => {
  const s = { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }] };
  const match = B.billMoney([ord({ tax_rate: 0.05 })], s);
  const nomatch = B.billMoney([ord({ tax_rate: 0.18 })], s);
  return (match.taxComponents.length === 2 && nomatch.taxComponents.length === 0)
    || `match ${match.taxComponents.length}, nomatch ${nomatch.taxComponents.length}`;
});
row("P03583", "…and never on a mixed-rate bill", () => {
  const s = { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }] };
  const m = B.billMoney([ord({ tax_rate: 0.05 }), ord({ tax_rate: 0.18 })], s);
  return m.taxComponents.length === 0 || "the configured halves were carried onto a mixed bill";
});
row("P03584", "taxModel sums named components to the rate", () => {
  const tm = B.taxModel({ tax_components: [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }] });
  return (tm.rate === 0.18 && tm.pct === 18) || `rate ${tm.rate}, pct ${tm.pct}`;
});
row("P03585", "…drops a component with no label or a non-positive rate", () => {
  const tm = B.taxModel({ tax_components: [{ label: "CGST", rate: 9 }, { label: "", rate: 9 }, { label: "Zero", rate: 0 }, { label: "Neg", rate: -1 }] });
  return (tm.components.length === 1 && tm.rate === 0.09) || `${tm.components.length} components, rate ${tm.rate}`;
});
row("P03586", "…falls back to settings.tax_rate, then to 5%", () => {
  const a = B.taxModel({ tax_rate: 0.12 }), b = B.taxModel({});
  return (a.rate === 0.12 && b.rate === 0.05) || `explicit ${a.rate}, empty ${b.rate}`;
});
row("P03587", "…returns a genuine ZERO for a composition restaurant", () => {
  const tm = B.taxModel({ price_tax_mode: "composition", tax_rate: 0.05 });
  return (tm.rate === 0 && tm.composition === true && tm.components.length === 0) || JSON.stringify(tm);
});
row("P03588", "splitTax gives the LAST component the remainder, so the lines foot exactly", () => {
  const bad = [];
  for (let t = 0; t <= 200; t++) {
    const rows_ = B.splitTax(t, [{ label: "C", rate: 2.5 }, { label: "S", rate: 2.5 }]);
    if (rows_.reduce((a, c) => a + c.amt, 0) !== t) bad.push(t);
  }
  return bad.length === 0 || `${bad.length} amounts did not foot (first ${bad[0]})`;
});
row("P03589", "splitTax refuses to hand rupees to a 0% component", () => {
  const rows_ = B.splitTax(19, [{ label: "A", rate: 0 }, { label: "B", rate: 5 }]);
  return (rows_.length === 1 && rows_[0].label === "B" && rows_[0].amt === 19) || JSON.stringify(rows_);
});
row("P03590", "splitTax with no components returns no rows rather than dividing by zero", () => {
  const a = B.splitTax(19, []), b = B.splitTax(19, null);
  return (a.length === 0 && b.length === 0) || `${a.length}/${b.length}`;
});
row("P03591", "splitTax(0, comps) prints zero-amount rows, and billData never asks it to", () => {
  const rows_ = B.splitTax(0, [{ label: "C", rate: 2.5 }, { label: "S", rate: 2.5 }]);
  if (!rows_.every((r) => r.amt === 0)) return "splitTax(0) did not return zeros";
  const src = read("public/panels/billdoc.js");
  return /addWhole <= 0/.test(src) && /insideWhole <= 0/.test(src) || "billData no longer guards against asking for a zero split";
});
row("P03592", "discPct keeps one decimal and drops a trailing .0", () =>
  (B.discPct(200, 20) === "10%" && B.discPct(200, 25) === "12.5%") || `${B.discPct(200, 20)} / ${B.discPct(200, 25)}`);
row("P03593", "discPct returns '' when there is nothing to say", () => {
  const empties = [B.discPct(0, 10), B.discPct(200, 0), B.discPct(200, -5), B.discPct(1000000, 0.4)];
  return empties.every((v) => v === "") || `got ${JSON.stringify(empties)}`;
});
row("P03594", "discPct is the ONE definition — the paper, the manager screen and the tablet all call it", () => {
  const miss = ["public/panels/editor/app.js", "public/panels/tablet/app.js"].filter((f) => !/discPct/.test(read(f)));
  return miss.length === 0 || `${miss.join(", ")} no longer calls discPct`;
});
row("P03595", "combineBillLines groups by everything a guest can see differ", () => {
  const out = B.combineBillLines([
    { title: "Special", price: 50, qty: 1 }, { title: "Special", price: 50, qty: 2 },
    { title: "Special", price: 150, qty: 1 },
    { title: "Special", price: 50, qty: 1, note: "spicy" },
    { title: "Special", price: 50, qty: 1, options: [{ label: "Cheese", price: 10 }] },
    { title: "Special", price: 50, qty: 1, removed: ["onion"] },
  ]);
  const three = out.find((o) => o.qty === 3 && o.price === 50 && !o.note && !o.options && !o.removed);
  // !! — the runner takes only a literal true for a pass, so a truthy OBJECT is a failure
  // reported as "[object Object]". (My first version did exactly that and the grouping was correct.)
  return !!(out.length === 5 && three) || `${out.length} groups: ${out.map((o) => o.qty + "×" + o.price).join(",")}`;
});
row("P03596", "…and its separator is a visible escape, not a raw invisible byte", () => {
  const src = read("public/panels/billdoc.js");
  return /var SEP = "\\u0001"/.test(src) || "the separator is no longer a written escape";
});
row("P03597", "…and a qty of 0 or garbage becomes 1, never 0 or NaN", () => {
  const out = B.combineBillLines([{ title: "A", price: 1, qty: 0 }, { title: "B", price: 1, qty: "x" }, { title: "C", price: 1 }]);
  return out.every((o) => o.qty === 1) || `qtys ${out.map((o) => o.qty).join(",")}`;
});
row("P03598", "mrpTaxInside only counts lines that are BOTH is_mrp and tax_mode incl", () => {
  const mk = (i) => [{ status: "served", items: [i] }];
  const yes = B.mrpTaxInside(mk({ is_mrp: true, tax_mode: "incl", qty: 1, price: 105 }), 0.05);
  const no1 = B.mrpTaxInside(mk({ is_mrp: true, tax_mode: "exempt", qty: 1, price: 105 }), 0.05);
  const no2 = B.mrpTaxInside(mk({ is_mrp: false, tax_mode: "incl", qty: 1, price: 105 }), 0.05);
  return (yes > 0 && no1 === 0 && no2 === 0) || `${yes} / ${no1} / ${no2}`;
});
row("P03599", "mrpPart returns 0 on a composition restaurant", () =>
  (B.mrpPart({ composition: true, nontax: 880 }) === 0 && B.mrpPart({ composition: false, nontax: 42 }) === 42) || "mrpPart is wrong");
row("P03600", "billData prefers the pair captured at invoice time over the guest's own name", () => {
  const d = B.billData({ settings: S5, restaurant: {}, session: {}, orders: [ord({ bill_cust_name: "Invoice Asha", customer_name: "Guest Asha" })] });
  return d.cust === "Invoice Asha" || `cust ${d.cust}`;
});
row("P03601", "bill_customer_print:false saves the pair but prints neither line", () => {
  const d = B.billData({ settings: { ...S5, bill_customer_print: false }, restaurant: {}, session: {},
    orders: [ord({ bill_cust_name: "Asha", bill_cust_phone: "9825012345" })] });
  return (d.cust === "" && d.custPhone === "") || `cust "${d.cust}" phone "${d.custPhone}"`;
});
const phone = (raw) => B.billData({ settings: S5, restaurant: {}, session: {}, orders: [ord({ bill_cust_phone: raw })] }).custPhone;
row("P03602", "a 10-digit printed phone is grouped 5+5", () => phone("9825012345") === "98250 12345" || `got ${phone("9825012345")}`);
row("P03603", "a 12-digit number beginning 91 is peeled to the national number, then grouped", () => phone("+91 98250 12345") === "98250 12345" || `got ${phone("+91 98250 12345")}`);
row("P03604", "an 11-digit number beginning 0 is peeled the same way", () => phone("098250 12345") === "98250 12345" || `got ${phone("098250 12345")}`);
row("P03605", "anything else prints whole rather than being wrongly chopped", () => phone("12345") === "12345" || `got ${phone("12345")}`);
row("P03606", "the bill's date comes from an explicit now, then invoice_at, then closed_at, then really now", () => {
  const at = (a) => B.billData({ settings: S5, restaurant: {}, orders: [ord({})], ...a }).dateStr;
  const explicit = at({ now: "2026-01-02T06:00:00Z", session: { invoice_at: "2026-06-03T06:00:00Z", closed_at: "2026-07-04T06:00:00Z" } });
  const inv = at({ session: { invoice_at: "2026-06-03T06:00:00Z", closed_at: "2026-07-04T06:00:00Z" } });
  const closed = at({ session: { closed_at: "2026-07-04T06:00:00Z" } });
  return (/02\/01\/2026/.test(explicit) && /03\/06\/2026/.test(inv) && /04\/07\/2026/.test(closed))
    || `${explicit} | ${inv} | ${closed}`;
});
row("P03607", "a reprint of last June's invoice stamps June, not today", () => {
  const d = B.billData({ settings: S5, restaurant: {}, orders: [ord({})], session: { invoice_at: "2025-06-15T06:00:00Z", invoice_no: 41 } });
  return /15\/06\/2025/.test(d.dateStr) || `dateStr ${d.dateStr}`;
});
row("P03608", "an invalid stored timestamp falls back to now rather than printing Invalid Date", () => {
  const d = B.billData({ settings: S5, restaurant: {}, orders: [ord({})], session: { invoice_at: "not-a-date" } });
  return !/Invalid/.test(d.dateStr) || `dateStr ${d.dateStr}`;
});
row("P03609", "the bill's date is pinned to en-IN + Asia/Kolkata", () => {
  const src = read("public/panels/billdoc.js");
  const line = /dateStr: now\.toLocaleDateString\(([^)]*)\)/.exec(src);
  return (line && /en-IN/.test(line[1]) && /Asia\/Kolkata/.test(line[1])) || "the date row is no longer pinned";
});
row("P03610", "the bill's TIME is pinned the same way", () => {
  const src = read("public/panels/billdoc.js");
  const i = src.indexOf("dateStr: now.toLocaleDateString");
  const seg = src.slice(i, i + 420);
  return (/toLocaleTimeString\("en-IN"/.test(seg) && /Asia\/Kolkata/.test(seg.slice(seg.indexOf("toLocaleTimeString")))) || "the time is no longer pinned";
});
row("P03611", "billData sets autoPrint true unless the caller says otherwise", () => {
  const on = B.billData({ settings: S5, restaurant: {}, orders: [ord({})], session: {} }).autoPrint;
  const off = B.billData({ settings: S5, restaurant: {}, orders: [ord({})], session: {}, autoPrint: false }).autoPrint;
  return (on === true && off === false) || `${on} / ${off}`;
});
row("P03612", "the mixed-rate tax split uses the restaurant's OWN component shape, so a cess survives", () => {
  const s = { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }, { label: "CESS", rate: 1 }] };
  const orders = [ord({ subtotal: 1000, taxable_base: 1000, tax_rate: 0.06 }), ord({ subtotal: 1000, taxable_base: 1000, tax_rate: 0.18 })];
  const d = B.billData({ settings: s, restaurant: {}, orders, money: B.billMoney(orders, s), session: {} });
  const labels = d.taxRows.map((r) => r.label);
  return labels.includes("CESS") || `tax rows: ${labels.join(",")}`;
});
row("P03613", "…and each rate's rows still foot to that rate's tax", () => {
  const s = { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }, { label: "CESS", rate: 1 }] };
  const orders = [ord({ subtotal: 1000, taxable_base: 1000, tax_rate: 0.06 }), ord({ subtotal: 1000, taxable_base: 1000, tax_rate: 0.18 })];
  const m = B.billMoney(orders, s);
  const d = B.billData({ settings: s, restaurant: {}, orders, money: m, session: {} });
  const printed = d.taxRows.reduce((a, r) => a + r.amt, 0);
  return printed === Math.round(m.taxAdded) || `printed ${printed}, taxAdded ${Math.round(m.taxAdded)}`;
});
row("P03614", "a restaurant with NO components configured falls back to CGST/SGST halves on both branches", () => {
  const single = B.billData({ settings: S5, restaurant: {}, orders: [ord({ tax_rate: 0.05 })], session: {} }).taxRows.map((r) => r.label);
  const orders = [ord({ subtotal: 1000, taxable_base: 1000, tax_rate: 0.05 }), ord({ subtotal: 1000, taxable_base: 1000, tax_rate: 0.18 })];
  const mixed = B.billData({ settings: S5, restaurant: {}, orders, money: B.billMoney(orders, S5), session: {} }).taxRows.map((r) => r.label);
  return (single.join() === "CGST,SGST" && mixed.every((l) => l === "CGST" || l === "SGST"))
    || `single ${single.join()}, mixed ${mixed.join()}`;
});
row("P03615", "the mrpNote claims tax is inside the MRP price ONLY when the restaurant treats MRP as inclusive", () => {
  const orders = [ord({ nontax_amount: 105, subtotal: 205, taxable_base: 100, items: [{ title: "W", is_mrp: true, tax_mode: "incl", qty: 1, price: 105 }, { title: "D", qty: 1, price: 100, tax_mode: "excl" }] })];
  const on = B.billData({ settings: { ...S5, mrp_tax_treatment: "inclusive" }, restaurant: {}, orders, session: {} }).mrpNote;
  const off = B.billData({ settings: { ...S5, mrp_tax_treatment: "none" }, restaurant: {}, orders, session: {} }).mrpNote;
  return (/include/.test(on) && off === "") || `on "${on}" / off "${off}"`;
});
