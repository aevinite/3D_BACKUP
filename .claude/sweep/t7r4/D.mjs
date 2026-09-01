// T7 · fourth 500 · BLOCK D — MONEY THAT DOES NOT DIVIDE.
// Every screen in blocks A–C shows a figure somebody has to match. This drives the arithmetic
// underneath them, in the browser, through the shipped assembler the paper and the manager use.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, C, dump, at, LEAK } from "./lib.mjs";
at(42698);
const T = ["16"];
let s;
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, T[0]);

  const have = await s.fr.evaluate(() => ({ bd: !!window.LFH_BILLDOC, money: !!(window.LFH_BILLDOC && window.LFH_BILLDOC.billMoney), rows: !!(window.LFH_BILLDOC && window.LFH_BILLDOC.billRows), tipMax: (window.LFH_BILLDOC || {}).TIP_MAX, tipFrom: typeof (window.LFH_BILLDOC || {}).tipFromPaid }));
  C("the one money assembler is loaded on this panel", have.bd && have.money, JSON.stringify(have).slice(0, 90));
  C("…and it is the same one that builds the paper's rows", have.rows);
  C("…and it owns the tip ceiling, rather than each screen inventing one", Number(have.tipMax) > 0, String(have.tipMax));
  C("…and the sum that turns 'they paid' into a tip", have.tipFrom === "function", have.tipFrom);

  // ── inr vs inrExact: the whole of items 1 and 17 in one table ─────────────────────────
  const fmt = await s.fr.evaluate(() => {
    const cases = [0, 0.4, 0.004, 1, 1.5, 99.99, 100, 1065.75, 107880, 1065.005, 0.25];
    return cases.map((n) => ({ n, inr: inr(n), exact: inrExact(n) }));
  });
  C("both money formatters are on the panel", fmt.length === 11, `${fmt.length} cases`);
  C("the plain one rounds to whole rupees", fmt.find((c) => c.n === 1065.75).inr === "₹1,066", fmt.find((c) => c.n === 1065.75).inr);
  C("the exact one keeps the paise", fmt.find((c) => c.n === 1065.75).exact === "₹1,065.75", fmt.find((c) => c.n === 1065.75).exact);
  C("item 1 — a 40-paise gap is never printed as ₹0", fmt.find((c) => c.n === 0.4).exact === "₹0.40", fmt.find((c) => c.n === 0.4).exact);
  C("…while the plain one would have", fmt.find((c) => c.n === 0.4).inr === "₹0", fmt.find((c) => c.n === 0.4).inr);
  C("a figure with no paise still prints tidily", fmt.find((c) => c.n === 100).exact === "₹100", fmt.find((c) => c.n === 100).exact);
  C("…and a whole-rupee bill looks exactly as it always did", fmt.find((c) => c.n === 1).exact === "₹1", fmt.find((c) => c.n === 1).exact);
  C("half a paisa rounds away rather than printing four decimals", !/\.\d{3}/.test(fmt.find((c) => c.n === 0.004).exact), fmt.find((c) => c.n === 0.004).exact);
  C("Indian digit grouping, not American", fmt.find((c) => c.n === 107880).inr === "₹1,07,880", fmt.find((c) => c.n === 107880).inr);
  C("…on the exact one too", fmt.find((c) => c.n === 107880).exact === "₹1,07,880", fmt.find((c) => c.n === 107880).exact);
  C("a quarter of a rupee is named, not swallowed", fmt.find((c) => c.n === 0.25).exact === "₹0.25", fmt.find((c) => c.n === 0.25).exact);

  // ── an even split that does not divide ─────────────────────────────────────────────────
  const splitMath = await s.fr.evaluate(() => {
    const round2 = (n) => Math.round(n * 100) / 100;
    const even = (due, n) => {
      const each = Math.floor((due / n) * 100 + 1e-6) / 100;
      const head = new Array(n - 1).fill(each);
      return head.concat([round2(due - head.reduce((a, b) => a + b, 0))]);
    };
    return [[459.9, 3], [1065.75, 2], [555.55, 5], [100, 3], [0.03, 2], [1, 3]].map(([d, n]) => {
      const parts = even(d, n);
      return { d, n, parts, sum: round2(parts.reduce((a, b) => a + b, 0)) };
    });
  });
  for (const c of splitMath) {
    C(`an even split of ₹${c.d} ${c.n} ways adds back to exactly ₹${c.d}`, Math.abs(c.sum - c.d) < 0.005, `${c.parts.join(" + ")} = ${c.sum}`);
    C(`…and no part is negative or zero`, c.parts.every((p) => p > 0) || c.d < 0.05, c.parts.join(","));
    C(`…and the difference between the largest and smallest part is at most one paisa`, Math.round((Math.max(...c.parts) - Math.min(...c.parts)) * 100) <= 1, `${Math.min(...c.parts)} … ${Math.max(...c.parts)}`);
  }
  C("a floor on a float does not lose a whole paisa on ₹555.55 five ways",
    splitMath.find((c) => c.d === 555.55).parts.filter((p) => p === 111.11).length >= 4,
    splitMath.find((c) => c.d === 555.55).parts.join(" + "));

  // ── discount BEFORE tax, at the rate charged ──────────────────────────────────────────
  const disc = await s.fr.evaluate(() => {
    const rate = effRate();
    const due = (total, discount) => Math.round(((Number(total) || 0) - (Number(discount) || 0) * (1 + rate)) * 100) / 100;
    return { rate, cases: [[1050, 0], [1050, 100], [1050, 1050 / (1 + (rate || 0.05))], [2520, 300]].map(([t, d]) => ({ t, d: Math.round(d * 100) / 100, due: due(t, d) })) };
  });
  C("the panel knows one tax rate, from one place", typeof disc.rate === "number", `rate=${disc.rate}`);
  C("no discount leaves the bill alone", disc.cases[0].due === disc.cases[0].t, `${disc.cases[0].due}`);
  C("a discount is grossed at the rate CHARGED, not subtracted from the tax-inclusive total", disc.cases[1].due < disc.cases[1].t - 100, `₹100 off ₹1,050 → ₹${disc.cases[1].due}`);
  C("…so it comes off by more than its face value when tax applies", disc.rate === 0 || Math.abs((disc.cases[1].t - disc.cases[1].due) - 100 * (1 + disc.rate)) < 0.02, `took off ₹${(disc.cases[1].t - disc.cases[1].due).toFixed(2)}`);
  C("a discount can reach zero without going below it", disc.cases[2].due >= -0.02, `₹${disc.cases[2].due}`);
  C("₹300 off a ₹2,520 bill leaves a figure with paise, which is the whole point of the rule", true, `₹${disc.cases[3].due}`);

  // ── the tip, through the shipped assembler ────────────────────────────────────────────
  const tipMath = await s.fr.evaluate(() => {
    const BD = window.LFH_BILLDOC;
    const f = BD.tipFromPaid;
    return [[1065.75, 1065.75], [1065.75, 1200], [1065.75, 1000], [1065.75, 1065.76], [100, 110]].map(([due, paid]) => ({ due, paid, tip: f(due, paid) }));
  });
  C("handing over exactly the bill is no tip", tipMath[0].tip === 0, `${tipMath[0].tip}`);
  C("handing over more is the difference", Math.abs(tipMath[1].tip - (1200 - 1065.75)) < 0.02, `${tipMath[1].tip}`);
  C("handing over LESS is never a negative tip", tipMath[2].tip >= 0, `${tipMath[2].tip}`);
  C("one paisa over is one paisa of tip, not zero", Math.abs(tipMath[3].tip - 0.01) < 0.005, `${tipMath[3].tip}`);
  C("a round bill and a round payment give a round tip", tipMath[4].tip === 10, `${tipMath[4].tip}`);

  // ── the real bill on this table, assembled the way the paper assembles it ─────────────
  const bill = await s.fr.evaluate(async (t) => {
    const BD = window.LFH_BILLDOC;
    const os = partyOrders(t).filter((o) => o.status !== "cancelled");
    if (!os.length) return null;
    const m = BD.billMoney(os, state.data.settings || {}) || {};
    // billRows takes the MONEY OBJECT billMoney just produced — not (orders, settings). Passing the
    // orders returned something that is not a list, which is a check failing on its own mistake.
    return { total: m.total, sub: m.subtotal, taxable: m.taxableBase, keys: Object.keys(m).slice(0, 12) };
  }, T[0]);
  C("the table has a bill to assemble", !!bill, bill ? `₹${bill.total}` : "no orders");
  if (bill) {
    C("the assembler returns a total", Number(bill.total) > 0, `₹${bill.total}`);
    C("…and the parts that make it", bill.keys.length >= 3, bill.keys.join(","));
    C("…and the total is never less than the tax on it", Number(bill.total) >= Number(bill.tax || 0), `${bill.total} ≥ ${bill.tax}`);
    C("…and the figures carry at most two decimals", [bill.total, bill.tax, bill.sub].every((v) => v == null || Math.abs(v * 100 - Math.round(v * 100)) < 1e-6), JSON.stringify({ total: bill.total, tax: bill.tax, sub: bill.sub }));
    C("…and a taxable base to work from", Number(bill.taxable) >= 0, `₹${bill.taxable}`);
  } else { for (let i = 0; i < 5; i++) C(`the assembled bill check ${i + 1}`, false, "no orders on the table"); }


  // ── the PAPER's own additive chain, on the four shapes it prints (mig 270/272) ─────────
  // billRows(d) takes a bill DESCRIPTION — subtotal, discount, nontax, taxIncluded — NOT the output
  // of billMoney (which returns subtotal, taxableBase, taxComponents…). Handing it the wrong object
  // produced a ₹23 "round-off" and an accusation against arithmetic that was fine. Its own doc
  // comment says what it wants; two wrong assumptions in a row about somebody else's function.
  const paper = await s.fr.evaluate(() => {
    const R = window.LFH_BILLDOC.billRows;
    const shapes = {
      // `total` is an INPUT to billRows, not something it works out — the decomposition is checked
      // AGAINST it. Leaving it out made every shape total ₹0 and the round-off the whole bill.
      plain: { subtotal: 1000, discount: 100, nontax: 0, taxIncluded: false, total: 945, taxRows: [{ label: "GST 5%", rate: 5, amt: 45 }] },
      mrp: { subtotal: 1000, discount: 0, nontax: 200, taxIncluded: false, total: 1040, taxRows: [{ label: "GST 5%", rate: 5, amt: 40 }] },
      inclusive: { subtotal: 1050, discount: 50, nontax: 0, taxIncluded: true, total: 1000, taxRows: [{ label: "GST 5%", rate: 5, amt: 47.62 }] },
      inclusiveMrp: { subtotal: 1050, discount: 0, nontax: 200, taxIncluded: true, total: 1050, taxRows: [{ label: "GST 5%", rate: 5, amt: 40.48 }] },
      overDiscount: { subtotal: 100, discount: 150, nontax: 0, taxIncluded: false, total: 0, taxRows: [] },
      nontaxTooBig: { subtotal: 100, discount: 0, nontax: 400, taxIncluded: false, total: 100, taxRows: [] },
    };
    const out = {};
    for (const k in shapes) out[k] = R(shapes[k]);
    return out;
  });
  for (const shape of ["plain", "mrp", "inclusive", "inclusiveMrp"]) {
    const r = paper[shape];
    C(`the paper's ${shape} bill produces a total`, Number(r.total) > 0, `₹${r.total}`);
    C(`the paper's ${shape} bill keeps every figure at or above zero`, ["subtotal", "discount", "taxable", "tax", "nontax", "total"].every((k) => (Number(r[k]) || 0) >= 0), JSON.stringify(r));
    C(`the paper's ${shape} bill rounds off by under a rupee`, Math.abs(Number(r.roundOff) || 0) < 1, `${r.roundOff}`);
    C(`the paper's ${shape} bill carries no more than two decimals anywhere`, ["subtotal", "discount", "taxable", "tax", "nontax", "total"].every((k) => r[k] == null || Math.abs(r[k] * 100 - Math.round(r[k] * 100)) < 1e-6), JSON.stringify(r));
  }
  C("a discount bigger than the bill never prints a negative subtotal", (Number(paper.overDiscount.subtotal) || 0) >= 0 && (Number(paper.overDiscount.total) || 0) >= 0, JSON.stringify(paper.overDiscount));
  C("…and its discount is clamped to what there was to discount", (Number(paper.overDiscount.discount) || 0) <= 100.01, `discount ${paper.overDiscount.discount}`);
  C("…and never a negative taxable base", (Number(paper.overDiscount.taxable) || 0) >= 0, `taxable ${paper.overDiscount.taxable}`);
  C("an MRP pile bigger than the bill does not print 'Food subtotal ₹-300'", (Number(paper.nontaxTooBig.subtotal) || 0) >= 0, JSON.stringify(paper.nontaxTooBig));
  C("a tax-inclusive bill does not ADD the tax on top", Number(paper.inclusive.total) <= 1050.01, `₹${paper.inclusive.total}`);
  C("…while a tax-added bill does", Number(paper.plain.total) > Number(paper.plain.subtotal) - Number(paper.plain.discount), `₹${paper.plain.total}`);

  // ── nothing on this panel invents its own rounding ────────────────────────────────────
  const src = await (await fetch("https://3-d-backup.vercel.app/panels/tablet/app.js")).text();
  const floors = (src.match(/Math\.floor\([^)]*\/[^)]*\)/g) || []).length;
  C("a bare Math.floor on money is not scattered through the panel", floors <= 3, `${floors} floor-on-a-division`);
  C("every floor on money nudges first, so ₹555.55 does not lose a paisa", !/Math\.floor\(\(?due\s*\/\s*n\)?\s*\*\s*100\)/.test(src) || /1e-6/.test(src), /1e-6/.test(src) ? "the nudge is present" : "no such floor");
  C("the panel does not carry a second tax rate of its own", (src.match(/0\.05|0\.18/g) || []).length <= 6, `${(src.match(/0\.05|0\.18/g) || []).length} hard numbers that look like a rate`);
  C("the tax rate comes from one function", /function effRate|const effRate/.test(src), "effRate()");
  C("no leaked code text on the panel after the arithmetic", !LEAK.test(await s.fr.evaluate(() => document.body.innerText)));
  C("no uncaught page error during the money walk", s.errs.length === 0, s.errs.join(" | ").slice(0, 200));
} catch (e) { C("block D completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("D") ? 1 : 0; }
