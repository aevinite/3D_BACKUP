// ⬛ NEW — T11 of sweep #8 · BANK E · P64961–P65120
// THE MONEY IDENTITIES, REPLAYED OVER REAL BILL SHAPES — one id per shape, so a failure names the
// exact bill that broke rather than "the money is wrong somewhere".
//
// WHY THIS SHAPE OF CHECK. This document's own history is a list of identities that held on every
// bill anyone thought to try and failed on a whole class nobody did: "4,508 of 13,806 discounted
// bills printed rows that contradicted their own TOTAL — 32.7%", "47.8% of sheets printed at least
// one tax column that did not add up". Both were found by REPLAYING, not by reasoning. So the
// replay is now permanent, and each shape is a row somebody can re-run by name.
import { BILLDOC as B, row, visible, totalRows } from "./lib.mjs";

let n = 64961;
const id = () => "P" + n++;
const r2 = (x) => Math.round(x * 100) / 100;

// ── the shapes ──────────────────────────────────────────────────────────────────────────────
// Built from the things that really vary on a bill in this product: the rate a restaurant is on,
// how the discount was given, whether prices contain their tax, whether there are sealed goods,
// and how many rate buckets share the session.
const RATES = [0, 0.05, 0.12, 0.18];
const DISCS = [0, 5, 10, 15, 20, 25, 50];          // the modal's own percentages
const SUBS = [9, 19, 201, 380, 442, 880, 1340, 107880];
const ord = (o) => ({ id: "o" + Math.random().toString(36).slice(2), status: "served", ...o });

/** Every identity a printed bill has to satisfy, checked at once. Returns "" when all hold. */
function identities(orders, settings) {
  const m = B.billMoney(orders, settings);
  const d = B.billData({ settings, restaurant: { slug: "x" }, orders, money: m, session: { bill_no: 1 }, tableDisp: "1" });
  const R = B.billRows(d);
  const bad = [];

  // 1 · the rows a person reads add up to the TOTAL they are printed above
  const base = R.disc > 0 ? R.taxable : R.subtotal;
  const foot = base + (R.inclusive ? 0 : R.tax) + R.nontax + R.roundOff;
  if (foot !== R.total) bad.push(`rows add to ${foot}, TOTAL says ${R.total}`);

  // 2 · nothing in a labelled money box is negative
  for (const [label, amt] of totalRows(B.billDocHtml({ ...d, noBar: true, autoPrint: false }))) {
    if (/^-|₹-/.test(amt.replace(/^− /, ""))) bad.push(`"${label}" prints ${amt}`);
  }
  if (R.subtotal < 0) bad.push(`subtotal ${R.subtotal}`);
  if (R.taxable < 0) bad.push(`taxable ${R.taxable}`);
  if (R.nontax < 0) bad.push(`nontax ${R.nontax}`);

  // 3 · the round-off is a rounding, not a claw-back ("at most a rupee or two", this file's words)
  if (Math.abs(R.roundOff) > 2) bad.push(`round off ${R.roundOff}`);

  // 4 · the TOTAL is the caller's, untouched
  if (R.total !== Math.round(m.total)) bad.push(`TOTAL moved: ${R.total} vs ${Math.round(m.total)}`);

  // 5 · the tax printed on top adds up to the tax that was charged on top
  const printed = (d.taxRows || []).reduce((a, x) => a + x.amt, 0);
  if (printed !== Math.round(m.taxAdded)) bad.push(`tax rows add to ${printed}, taxAdded is ${Math.round(m.taxAdded)}`);

  // 6 · inside tax + added tax is the whole tax, to the paisa
  if (Math.round((m.taxInside + m.taxAdded) * 100) !== Math.round(m.tax * 100))
    bad.push(`inside ${m.taxInside} + added ${m.taxAdded} ≠ tax ${m.tax}`);

  // 7 · no rate is named that nobody was charged
  const charged = new Set((m.rateRows || []).map((x) => Math.round(x.rate * 10000) / 100));
  if (!m.mixedRates && m.rate > 0) charged.add(Math.round(m.rate * 10000) / 100);
  const namedSum = r2((d.taxRows || []).reduce((a, x) => a + (Number(x.rate) || 0), 0));
  if (namedSum > 0 && charged.size === 1 && Math.abs(namedSum - [...charged][0]) > 0.02)
    bad.push(`rows name ${namedSum}% while ${[...charged][0]}% was charged`);

  // 8 · A ZERO NEVER APPEARS IN A BOX WHOSE WHOLE JOB IS TO EXPLAIN A SPLIT.
  // That is what the standing rule actually covers, and getting its SCOPE right cost me six false
  // failures. The owner's two rulings are both about a box that says nothing: "Food subtotal ₹0"
  // over "MRP items ₹42" (item 15, 2026-08-28) and a Discount row deducting nothing (item 1 of this
  // run). They are NOT about:
  //   · Subtotal / TOTAL — ₹0 is the honest rendering of a bill with nothing on it;
  //   · Taxable value — ₹0 is correct after a 100% discount, which a comped table really is;
  //   · a TAX COMPONENT — see the block at the end of this file. On a bill whose whole tax rounds
  //     to ₹1 the split cannot give both halves a whole rupee, and every alternative breaks a
  //     stronger rule. That one is REPORTED for his decision rather than asserted either way.
  const SPLIT_BOXES = /^(Discount|Food subtotal|MRP items)/;
  for (const [label, amt] of totalRows(B.billDocHtml({ ...d, noBar: true, autoPrint: false }))) {
    if (/^(− )?₹0$/.test(amt) && SPLIT_BOXES.test(label)) bad.push(`"${label}" prints ${amt}`);
  }

  // 9 · nothing machine-shaped reached the paper
  const html = B.billDocHtml({ ...d, noBar: true, autoPrint: false });
  for (const junk of ["NaN", "undefined", "[object Object]", "Infinity", "${"]) if (html.includes(junk)) bad.push(`the paper contains "${junk}"`);

  return bad.join(" · ");
}

// ── 1 · plain bills: every rate × every discount (28) ───────────────────────────────────────
for (const rate of RATES) {
  for (const pct of DISCS) {
    const sub = 880;
    row(id(), `a ₹${sub} bill at ${Math.round(rate * 10000) / 100}% with ${pct}% off`, () => {
      const s = rate === 0 ? { price_tax_mode: "composition" } : { tax_rate: rate };
      const orders = [ord({ subtotal: sub, taxable_base: sub, discount: r2(sub * pct / 100), tax_rate: rate,
        items: [{ title: "Dish", qty: 1, price: sub, tax_mode: "excl" }] })];
      return identities(orders, s) || true;
    });
  }
}
// ── 2 · the small bills, where rounding bites (32) ──────────────────────────────────────────
for (const sub of SUBS) {
  for (const pct of [0, 5, 15, 50]) {
    row(id(), `a ₹${sub} bill at 5% with ${pct}% off (the rounding boundary)`, () => {
      const orders = [ord({ subtotal: sub, taxable_base: sub, discount: r2(sub * pct / 100), tax_rate: 0.05,
        items: [{ title: "Chai", qty: 1, price: sub, tax_mode: "excl" }] })];
      return identities(orders, { tax_rate: 0.05 }) || true;
    });
  }
}
// ── 3 · sealed goods beside food, discounted and not (24) ───────────────────────────────────
for (const mrp of [21, 42, 105, 400]) {
  for (const pct of [0, 10, 50]) {
    for (const treat of ["none", "inclusive"]) {
      row(id(), `₹400 of food beside ₹${mrp} of sealed goods (${treat}), ${pct}% off`, () => {
        const s = { tax_rate: 0.05, mrp_tax_treatment: treat };
        const orders = [ord({ subtotal: 400 + mrp, taxable_base: 400, nontax_amount: mrp,
          discount: r2(400 * pct / 100), tax_rate: 0.05,
          items: [{ title: "Dal", qty: 1, price: 400, tax_mode: "excl" },
            { title: "Water", qty: 1, price: mrp, is_mrp: true, tax_mode: treat === "inclusive" ? "incl" : "exempt" }] })];
        return identities(orders, s) || true;
      });
    }
  }
}
// ── 4 · prices that already contain their tax (16) ──────────────────────────────────────────
for (const gross of [105, 210, 1340, 41.33]) {
  for (const pct of [0, 10, 25, 50]) {
    row(id(), `tax-inside prices totalling ₹${gross}, ${pct}% off`, () => {
      const s = { tax_rate: 0.05, price_tax_mode: "incl" };
      const net = r2(gross / 1.05);
      const orders = [ord({ subtotal: net, taxable_base: net, discount: r2(net * pct / 100), tax_rate: 0.05,
        items: [{ title: "Combo", qty: 1, price: gross, tax_mode: "incl" }] })];
      return identities(orders, s) || true;
    });
  }
}
// ── 5 · several rates in one session — a banquet beside dine-in food (24) ───────────────────
for (const a of [0.05, 0.12]) {
  for (const b of [0.18, 0.28]) {
    for (const pct of [0, 10, 50]) {
      for (const comps of [null, [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }, { label: "CESS", rate: 1 }]]) {
        row(id(), `${Math.round(a * 100)}% food beside ${Math.round(b * 100)}% banquet, ${pct}% off${comps ? ", with a cess" : ""}`, () => {
          const s = comps ? { tax_components: comps } : { tax_rate: a };
          const orders = [
            ord({ subtotal: 1000, taxable_base: 1000, discount: r2(1000 * pct / 100), tax_rate: a, items: [{ title: "Food", qty: 1, price: 1000, tax_mode: "excl" }] }),
            ord({ subtotal: 5000, taxable_base: 5000, discount: 0, tax_rate: b, items: [{ title: "Hall", qty: 1, price: 5000, tax_mode: "excl" }] }),
          ];
          return identities(orders, s) || true;
        });
      }
    }
  }
}
// ── 6 · the bill's own edges (12) ───────────────────────────────────────────────────────────
const edges = [
  ["an empty bill", [], { tax_rate: 0.05 }],
  ["a bill of one ₹0 line", [ord({ subtotal: 0, taxable_base: 0, items: [{ title: "Free", qty: 1, price: 0, tax_mode: "excl" }] })], { tax_rate: 0.05 }],
  ["a bill whose only line is sealed goods", [ord({ subtotal: 42, taxable_base: 0, nontax_amount: 42, items: [{ title: "Water", qty: 1, price: 42, is_mrp: true, tax_mode: "exempt" }] })], { tax_rate: 0.05 }],
  ["a discount bigger than the bill", [ord({ subtotal: 100, taxable_base: 100, discount: 5000, tax_rate: 0.05, items: [{ title: "X", qty: 1, price: 100, tax_mode: "excl" }] })], { tax_rate: 0.05 }],
  ["a NEGATIVE discount", [ord({ subtotal: 100, taxable_base: 100, discount: -50, tax_rate: 0.05, items: [{ title: "X", qty: 1, price: 100, tax_mode: "excl" }] })], { tax_rate: 0.05 }],
  ["a sub-rupee discount (this run's item 1)", [ord({ subtotal: 200, taxable_base: 200, discount: 0.4, tax_rate: 0.05, items: [{ title: "X", qty: 1, price: 200, tax_mode: "excl" }] })], { tax_rate: 0.05 }],
  ["one live order beside a cancelled one", [ord({ subtotal: 100, taxable_base: 100, tax_rate: 0.05, items: [{ title: "Live", qty: 1, price: 100, tax_mode: "excl" }] }), ord({ status: "cancelled", subtotal: 500, taxable_base: 500, items: [{ title: "Void", qty: 1, price: 500 }] })], { tax_rate: 0.05 }],
  ["one live order beside a tombstoned one", [ord({ subtotal: 100, taxable_base: 100, tax_rate: 0.05, items: [{ title: "Live", qty: 1, price: 100, tax_mode: "excl" }] }), ord({ deleted_at: "x", subtotal: 500, taxable_base: 500, items: [{ title: "Gone", qty: 1, price: 500 }] })], { tax_rate: 0.05 }],
  ["a line with a null in the items array", [ord({ subtotal: 100, taxable_base: 100, tax_rate: 0.05, items: [null, { title: "X", qty: 1, price: 100, tax_mode: "excl" }] })], { tax_rate: 0.05 }],
  ["a ₹1,07,880 line (the widest money column)", [ord({ subtotal: 107880, taxable_base: 107880, tax_rate: 0.18, items: [{ title: "Wedding", qty: 1, price: 107880, tax_mode: "excl" }] })], { tax_rate: 0.18 }],
  ["a 40-line bill", [ord({ subtotal: 4000, taxable_base: 4000, tax_rate: 0.05, items: Array.from({ length: 40 }, (_, i) => ({ title: `Dish ${i + 1}`, qty: 1, price: 100, tax_mode: "excl" })) })], { tax_rate: 0.05 }],
  ["a composition restaurant with a discount", [ord({ subtotal: 880, taxable_base: 880, discount: 50, tax_rate: 0, items: [{ title: "Thali", qty: 1, price: 880, tax_mode: "excl" }] })], { price_tax_mode: "composition" }],
];
for (const [what, orders, s] of edges) row(id(), `the bill's edges — ${what}`, () => identities(orders, s) || true);

// ── 7 · the tip sits below the TOTAL and changes nothing above it (12) ──────────────────────
for (const tip of [0, 1, 200, 3200, 100000, 999999]) {
  row(id(), `a tip of ₹${tip} does not move a single row above the TOTAL`, () => {
    const s = { tax_rate: 0.05 };
    const base = [ord({ subtotal: 1000, taxable_base: 1000, tax_rate: 0.05, items: [{ title: "X", qty: 1, price: 1000, tax_mode: "excl" }] })];
    const withTip = [{ ...base[0], tip }];
    const a = totalRows(B.billDocHtml({ ...B.billData({ settings: s, restaurant: {}, orders: base, session: {} }), noBar: true, autoPrint: false }));
    const b = totalRows(B.billDocHtml({ ...B.billData({ settings: s, restaurant: {}, orders: withTip, session: {} }), noBar: true, autoPrint: false }));
    const aa = JSON.stringify(a), bb = JSON.stringify(b);
    return aa === bb || `the rows above the TOTAL changed:\n        without ${aa}\n        with    ${bb}`;
  });
  row(id(), `…and a tip of ₹${tip} is stated after it, never inside the sale`, () => {
    const s = { tax_rate: 0.05 };
    const orders = [ord({ subtotal: 1000, taxable_base: 1000, tax_rate: 0.05, tip, items: [{ title: "X", qty: 1, price: 1000, tax_mode: "excl" }] })];
    const d = B.billData({ settings: s, restaurant: {}, orders, session: {} });
    const v = visible(B.billDocHtml({ ...d, noBar: true, autoPrint: false }));
    if (tip <= 0) return !v.some((x) => /^Tip/.test(x)) || "a zero tip printed a row";
    const iTip = v.findIndex((x) => /^Tip/.test(x)), iTotal = v.indexOf("TOTAL"), iPaid = v.indexOf("PAID");
    return (iTip > iTotal && iPaid > iTip) || `TOTAL@${iTotal} Tip@${iTip} PAID@${iPaid}`;
  });
}
// ── 8 · a cancelled sale prints as one, at every shape (6) ──────────────────────────────────
for (const [what, orders] of [
  ["one cancelled order", [ord({ status: "cancelled", subtotal: 250, items: [{ title: "Dish", qty: 1, price: 250 }] })]],
  ["several cancelled orders", [ord({ status: "cancelled", subtotal: 250, items: [{ title: "A", qty: 1, price: 250 }] }), ord({ status: "cancelled", subtotal: 100, items: [{ title: "B", qty: 2, price: 50 }] })]],
  ["a cancelled bill that had an invoice", [ord({ status: "cancelled", subtotal: 250, items: [{ title: "Dish", qty: 1, price: 250 }] })]],
]) {
  row(id(), `a cancelled sale — ${what} — charges nothing and says so`, () => {
    const d = B.billData({ settings: { tax_rate: 0.05 }, restaurant: {}, orders, session: { bill_no: 5, invoice_no: 41, invoice_at: "2026-04-01T12:00:00Z" } });
    const html = B.billDocHtml({ ...d, noBar: true, autoPrint: false });
    const v = visible(html);
    const bad = [];
    if (!v.includes("Cancelled — no charge")) bad.push("no band");
    if (!/<title>Cancelled Bill/.test(html)) bad.push("still headed Tax Invoice");
    if (!v.includes("₹0")) bad.push("the TOTAL is not ₹0");
    const labels = totalRows(html).map((x) => x[0]);
    if (labels.some((l) => /GST|Discount|MRP|Round/.test(l))) bad.push(`it still prints ${labels.join("/")}`);
    return bad.join(" · ") || true;
  });
  row(id(), `…and ${what} still LISTS what was ordered, with its number`, () => {
    const d = B.billData({ settings: { tax_rate: 0.05 }, restaurant: {}, orders, session: { bill_no: 5, invoice_no: 41, invoice_at: "2026-04-01T12:00:00Z" } });
    const v = visible(B.billDocHtml({ ...d, noBar: true, autoPrint: false }));
    return (v.some((x) => /Dish|A$|B$/.test(x)) && v.some((x) => /voided/.test(x)))
      || `a void record nobody can read is no record: ${v.slice(0, 18).join("/")}`;
  });
}

// ── 9 · THE SMALL-BILL TAX SPLIT, recorded rather than judged (8) ───────────────────────────
// Found by this bank on its first run, and it is a real thing a person would see: on a bill whose
// WHOLE tax rounds to ₹1, splitTax gives the first component the rupee and the last the remainder,
// so the paper reads
//
//     Subtotal   ₹19   ·   CGST 2.5%  ₹1   ·   SGST 2.5%  ₹0   ·   TOTAL  ₹20
//
// — a tax invoice naming a component that collected nothing at a stated positive rate. The column
// FOOTS, which is why no existing check saw it.
//
// It is NOT fixed here, because every alternative breaks a rule this document holds more strongly:
// printing paise contradicts a whole-rupee sheet; dropping the ₹0 component names a two-component
// regime with one component; rounding both up prints ₹2 of tax on ₹1 collected, which is the exact
// fault splitTax was written to prevent. So these rows PIN THE CURRENT BEHAVIOUR — they fail if it
// changes, either way — and the choice is carried to the owner as a report item.
//
// Reachable on a bill whose tax is under ₹1.50: about ₹30 at 5%. A tea counter sees it; a
// restaurant does not.
for (const [sub, wantSplit] of [[19, "1/0"], [21, "1/0"], [29, "1/0"], [40, "1/1"], [201, "5/5"], [380, "10/9"]]) {
  row(id(), `a ₹${sub} bill at 5%: the two tax halves print ${wantSplit}, and they add to the tax charged`, () => {
    const s2 = { tax_rate: 0.05 };
    const orders = [ord({ subtotal: sub, taxable_base: sub, tax_rate: 0.05, items: [{ title: "Chai", qty: 1, price: sub, tax_mode: "excl" }] })];
    const m = B.billMoney(orders, s2);
    const d2 = B.billData({ settings: s2, restaurant: {}, orders, money: m, session: {}, tableDisp: "1" });
    const got = (d2.taxRows || []).map((x) => x.amt).join("/");
    const sum = (d2.taxRows || []).reduce((a2, x) => a2 + x.amt, 0);
    if (sum !== Math.round(m.taxAdded)) return `the halves add to ${sum} but ${Math.round(m.taxAdded)} was charged`;
    return got === wantSplit || `the halves print ${got}, not ${wantSplit} — if this is the fix, the report item is the place to say so`;
  });
}
row(id(), "a ₹0 tax component is only ever possible when the WHOLE tax rounds to ₹1 or less", () => {
  const s2 = { tax_rate: 0.05 };
  const bad = [];
  for (let sub = 1; sub <= 2000; sub++) {
    const orders = [ord({ subtotal: sub, taxable_base: sub, tax_rate: 0.05, items: [{ title: "X", qty: 1, price: sub, tax_mode: "excl" }] })];
    const m = B.billMoney(orders, s2);
    const d2 = B.billData({ settings: s2, restaurant: {}, orders, money: m, session: {}, tableDisp: "1" });
    const zeros = (d2.taxRows || []).filter((x) => x.amt === 0);
    if (zeros.length && Math.round(m.taxAdded) > 1) bad.push(sub);
  }
  return bad.length === 0 || `a ₹0 component also appears at subtotal(s) ${bad.slice(0, 6).join(",")} where the tax is more than ₹1`;
});
row(id(), "…and the tax rows ALWAYS add up to the tax charged, at every subtotal from ₹1 to ₹2,000", () => {
  const s2 = { tax_rate: 0.05 };
  const bad = [];
  for (let sub = 1; sub <= 2000; sub++) {
    const orders = [ord({ subtotal: sub, taxable_base: sub, tax_rate: 0.05, items: [{ title: "X", qty: 1, price: sub, tax_mode: "excl" }] })];
    const m = B.billMoney(orders, s2);
    const d2 = B.billData({ settings: s2, restaurant: {}, orders, money: m, session: {}, tableDisp: "1" });
    const sum = (d2.taxRows || []).reduce((a2, x) => a2 + x.amt, 0);
    if (sum !== Math.round(m.taxAdded)) bad.push(`₹${sub}: rows ${sum} vs charged ${Math.round(m.taxAdded)}`);
  }
  return bad.length === 0 || `${bad.length} of 2000 did not add up (first: ${bad[0]})`;
});
