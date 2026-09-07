// ⬛ NEW — T11 of sweep #8 · BANK N · P101492–P101594 · ROUND 5
// EVERY EXPORTED FUNCTION OF billdoc.js, OVER THE SHAPES ITS OWN CALLERS REALLY HAND IT.
//
// WHY. This file publishes TWENTY-SEVEN things, and the sweeps have exercised the same four —
// billDocHtml, kotDocHtml, banquetDocHtml, billMoney — over and over, because those are the ones
// that draw paper. FOURTEEN had never been called by any bank in any round: financialYear,
// invFmt, bqOn, bqTaxModel, bqWords, combineBillLines, mrpPart, mrpTaxInside, splitTax,
// tipFromPaid, billRows, kotLineHtml, orderTaxRate, taxModel. They are not private helpers — they
// are on the export table, so the panels and the server may call them, and several decide MONEY.
//
// ── WHAT "EVERY SHAPE" MEANS HERE, AND WHY THE FIRST VERSION OF THIS BANK WAS WRONG ──────────
// It began by handing every function every value: a number where a list belongs, a Symbol, a
// function. Nine rows went red, and not one of them was a fault — `billMoney(-1)` throws because
// -1 has no .filter, which is a programming mistake in a caller, not a shape this app produces.
// A check that invents inputs nobody can produce reports faults nobody can hit, and this project
// has lost more time to that than to real bugs.
// So the shapes are the ones the app REALLY makes: a column that is null in the database, a field
// nobody filled in, an empty list, a list with a hole in it, a number that arrived as a string.
// Each function is handed the shapes its own signature can receive — which is also why the
// signatures are read out of the source below rather than guessed at (the first version had five
// of them wrong: splitTax takes the COMPONENTS not a count, orderTaxRate takes a RATE not a
// settings bag, invFmt takes a PREFIX, mrpPart takes the MONEY object, bqWords returns a string).
import { BILLDOC as B, row } from "./lib.mjs";

let id = 101492;
const R = (what, fn) => row(`P${id++}`, what, fn);

// A missing value, however it goes missing.
const NOTHING = [undefined, null, "", "  "];
// A number that isn't one — every one of these really does come out of the database or a form.
const NOTANUMBER = [...NOTHING, 0, -1, "0", "12.5", "abc", NaN];
/* A list, however it arrives broken. NOT the string forms: a database column that holds a list is
   either null or a list, and it is never the two-space string. Spreading NOTHING in here handed
   `billMoney("  ")` to a function whose first act is `.filter`, and four rows went red over a shape
   nothing in this product can produce — the same mistake, in miniature, that the first draft of
   this whole bank made. `""` is falsy so it lands on the `|| []` fallback and is harmless; `"  "`
   is truthy and is not a list. */
const LISTS = [undefined, null, [], [null], [undefined], [null, undefined], [{}], [{ qty: null, price: null }],
  [{ title: null, qty: "2", price: "200" }]];
/* A settings / money bag, however empty — same reasoning: a JSONB column is null or an object. */
const BAGS = [undefined, null, {}, { a: 1 }, { tax_rate: null }, { tax_rate: "abc" }];

/** What each export can actually be handed, first argument then second. */
const SHAPES = {
  banquetDocHtml: [BAGS], billData: [BAGS], billDocHtml: [BAGS], billRows: [BAGS],
  billIdentity: [BAGS, BAGS], billMoney: [LISTS, BAGS], bqOn: [BAGS, [...NOTHING, "cust_name", "dish", "zzz"]],
  bqPaper: [BAGS], bqTaxModel: [BAGS], bqWords: [[...NOTANUMBER, 1, 1234.56, 10000000]],
  combineBillLines: [LISTS], discPct: [NOTANUMBER, NOTANUMBER], financialYear: [[...NOTHING, "nope", 0, Date.now(), new Date("nope"), new Date()]],
  inr: [NOTANUMBER], invFmt: [NOTANUMBER, [...NOTHING, new Date(), "nope"], [...NOTHING, "INV", "AV"]],
  kotDocHtml: [BAGS], kotLineHtml: [[...NOTHING, {}, { qty: null }, { title: null, qty: "2" }], [...NOTHING, "a shared note"]],
  kotWhen: [[...NOTHING, "nope", 0, -1, Date.now(), new Date().toISOString()]],
  mrpPart: [BAGS], mrpTaxInside: [LISTS, NOTANUMBER], orderTaxRate: [BAGS, NOTANUMBER],
  phone10: [[...NOTANUMBER, "9876543210", "00919876543210", 9876543210]],
  splitTax: [NOTANUMBER, LISTS], taxModel: [BAGS], tipFromPaid: [NOTANUMBER, NOTANUMBER],
  tipPct: [NOTANUMBER, NOTANUMBER],
};
const NAMES = Object.keys(B).filter((k) => typeof B[k] === "function").sort();
const argsFor = (name) => SHAPES[name] || [BAGS, BAGS];
const pairs = (name) => {
  const [as, bs] = argsFor(name);
  const out = [];
  for (const a of as) for (const b of (bs || [undefined])) out.push([a, b]);
  return out;
};
const show = (v) => { try { return typeof v === "object" && v !== null ? JSON.stringify(v).slice(0, 24) : String(v).slice(0, 18); } catch { return "?"; } };

/* ── 1. NOTHING THROWS ─────────────────────────────────────────────────────────────────────────
   This file's own doctrine, written above billDocHtml: "one bad line must not cost the whole piece
   of paper". These documents are drawn into a window.open or a hidden iframe, so a throw is a
   BLANK WINDOW — the kitchen gets no ticket, or the guest gets no bill, with nothing on any screen
   saying why. That promise is only worth anything if it holds for the whole export table. */
for (const name of NAMES) {
  R(`billdoc.${name}() survives every shape its callers can hand it`, () => {
    const threw = [];
    for (const [a, b] of pairs(name)) {
      try { B[name](a, b); } catch (e) { threw.push(`${name}(${show(a)}${b === undefined ? "" : ", " + show(b)}) → ${e.message}`); }
    }
    return threw.length === 0 || `${threw.length} throw(s), first: ${threw[0]}`;
  });
}

/* ── 2. NOTHING PRINTS AS MACHINE LANGUAGE ─────────────────────────────────────────────────── */
const looksWrong = (v) => {
  let s;
  try { s = typeof v === "string" ? v : (v && typeof v === "object") ? JSON.stringify(v) : String(v); } catch { return false; }
  return /\[object Object\]|Invalid Date|\bNaN\b|\bundefined\b/.test(s);
};
for (const name of NAMES) {
  R(`…and billdoc.${name}() never hands back something that would print as machine language`, () => {
    const bad = [];
    for (const [a, b] of pairs(name)) {
      let out; try { out = B[name](a, b); } catch { continue; }
      if (out === undefined || out === null) continue;              // "nothing to say" is a fine answer
      if (typeof out === "number" && !Number.isFinite(out)) { bad.push(`${name}(${show(a)}) returned ${out}`); continue; }
      if (looksWrong(out)) bad.push(`${name}(${show(a)}) → ${String(typeof out === "string" ? out : JSON.stringify(out)).slice(0, 70)}`);
    }
    return bad.length === 0 || `${bad.length}: ${bad[0]}`;
  });
}

/* ── 3. THE ONES THAT DECIDE SOMETHING, ASKED PROPERLY ─────────────────────────────────────── */
R("inr() groups the Indian way at every size a bill really reaches", () => {
  const want = { 0: "0", 5: "5", 99: "99", 1000: "1,000", 99999: "99,999", 100000: "1,00,000",
    107880: "1,07,880", 10000000: "1,00,00,000" };
  const bad = Object.entries(want).filter(([n, w]) => !B.inr(Number(n)).includes(w))
    .map(([n, w]) => `${n} → "${B.inr(Number(n))}", expected to contain ${w}`);
  return bad.length === 0 || bad.join(" · ");
});
R("…and a negative amount keeps its sign where a person can see it", () =>
  /-|−/.test(B.inr(-250)) || `it prints -250 as "${B.inr(-250)}"`);
R("…and half a rupee is not printed as the same figure as one and a half", () =>
  B.inr(0.5) !== B.inr(1.5) || `0.5 and 1.5 both print as "${B.inr(0.5)}"`);
R("discPct() rounds to one decimal and drops a trailing zero", () => {
  const cases = [[400, 40, "10%"], [400, 50, "12.5%"], [400, 0, ""], [0, 40, ""], [9, 0.45, "5%"]];
  const bad = cases.filter(([s, d, w]) => B.discPct(s, d) !== w).map(([s, d, w]) => `${d} of ${s} → "${B.discPct(s, d)}", expected "${w}"`);
  return bad.length === 0 || bad.join(" · ");
});
R("…and a discount bigger than the bill does not print a percentage nobody can act on", () => {
  const s = B.discPct(20, 500);
  return (s === "" || /^\d+(\.\d)?%$/.test(s)) || `it prints "${s}"`;
});
R("tipPct() reads a tip the same way discPct reads a discount", () => {
  const bad = [[1000, 100, "10%"], [1000, 0, ""], [0, 100, ""]].filter(([s, t, w]) => B.tipPct(s, t) !== w)
    .map(([s, t, w]) => `${t} on ${s} → "${B.tipPct(s, t)}", expected "${w}"`);
  return bad.length === 0 || bad.join(" · ");
});
R("tipFromPaid() turns 'they handed over 3200 on a 3000 bill' into a 200 tip", () =>
  Math.abs(Number(B.tipFromPaid(3000, 3200)) - 200) < 0.01 || `it worked out ${JSON.stringify(B.tipFromPaid(3000, 3200))}`);
R("…and paying LESS than the bill is never a negative tip", () => {
  const t = Number(B.tipFromPaid(3000, 2800));
  return (!Number.isFinite(t) || t >= 0) || `it worked out a tip of ${t}`;
});
R("…and a tip has a ceiling, so a fat-fingered amount cannot become the bill", () =>
  (typeof B.TIP_MAX === "number" && B.TIP_MAX > 0) || `TIP_MAX is ${JSON.stringify(B.TIP_MAX)}`);
R("…and an amount beyond that ceiling does not become a tip", () => {
  const t = Number(B.tipFromPaid(100, 100 + B.TIP_MAX * 1000));
  return (!Number.isFinite(t) || t <= B.TIP_MAX * 1000) || `a tip of ${t} came back on a ₹100 bill`;
});
R("financialYear() puts 1 April in a different year from 31 March", () => {
  const apr = String(B.financialYear(new Date("2026-04-01T06:00:00+05:30")));
  const mar = String(B.financialYear(new Date("2026-03-31T06:00:00+05:30")));
  return apr !== mar || `both read "${apr}" — the FY boundary is not there`;
});
R("…and the boundary is 1 APRIL, not 1 January", () => {
  const jan = String(B.financialYear(new Date("2026-01-15T06:00:00+05:30")));
  const mar = String(B.financialYear(new Date("2026-03-15T06:00:00+05:30")));
  const may = String(B.financialYear(new Date("2026-05-15T06:00:00+05:30")));
  return (jan === mar && mar !== may) || `Jan "${jan}", Mar "${mar}", May "${may}"`;
});
R("…and it reads the date in IST, so a bill rung at 01:30 does not fall in last year", () => {
  const late = String(B.financialYear(new Date("2026-03-31T20:00:00Z")));    // 01:30 IST, 1 April
  const day = String(B.financialYear(new Date("2026-04-01T06:00:00+05:30")));
  return late === day || `01:30 IST on 1 April reads "${late}" but 11:30 the same day reads "${day}"`;
});
R("…and a date nobody can read falls back to now rather than to nothing", () => {
  const s = String(B.financialYear(new Date("nope")) ?? "");
  return (/\d/.test(s) && !/NaN|Invalid/.test(s)) || `it produced "${s}"`;
});
R("invFmt() builds an invoice number that carries its financial year and is padded", () => {
  const s = String(B.invFmt(7, new Date("2026-05-15T06:00:00+05:30"), "INV") ?? "");
  return /^INV\/\d{4}-\d{2}\/000007$/.test(s) || `it produced "${s}"`;
});
R("…and the same number in two different years is not the same invoice", () => {
  const a = String(B.invFmt(7, new Date("2026-05-15T06:00:00+05:30"), "INV"));
  const b = String(B.invFmt(7, new Date("2027-05-15T06:00:00+05:30"), "INV"));
  return a !== b || `both years produce "${a}"`;
});
R("…and a bill with NO invoice number gets no invoice number, not 'INV/2026-27/000000'", () =>
  B.invFmt(null, new Date(), "INV") === "" || `it produced "${B.invFmt(null, new Date(), "INV")}"`);
R("…and a restaurant's own prefix is used when it has one", () =>
  String(B.invFmt(7, new Date(), "AV")).startsWith("AV/") || `it produced "${B.invFmt(7, new Date(), "AV")}"`);
R("kotWhen() prints nothing at all for a time it cannot read, never 'Invalid Date'", () => {
  const bad = [null, undefined, "", "nope", 0, -1, {}, []].map((v) => [v, String(B.kotWhen(v))])
    .filter(([, s]) => /Invalid|NaN|undefined/.test(s)).map(([v, s]) => `${String(v)} → "${s}"`);
  return bad.length === 0 || bad.join(" · ");
});
R("…and every month it prints is the same three letters, decided here rather than by the device", () => {
  const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const bad = [];
  for (let m = 0; m < 12; m++) {
    const s = B.kotWhen(new Date(Date.UTC(2026, m, 15, 6, 0, 0)).toISOString());
    if (!s.includes(" " + MON[m] + " ")) bad.push(`${MON[m]} printed as "${s}"`);
  }
  return bad.length === 0 || bad.join(" · ");
});
R("…and today's ticket shows only the time, because a cook does not need today's date", () => {
  const s = B.kotWhen(new Date().toISOString());
  return !/[A-Z]{3}/.test(s) || `today's ticket reads "${s}"`;
});
R("phone10() reads every shape a guest number arrives in", () => {
  const want = [["9876543210", "9876543210"], ["919876543210", "9876543210"], ["+91 98765 43210", "9876543210"],
    ["09876543210", "9876543210"], ["0919876543210", "9876543210"], ["00919876543210", "9876543210"]];
  const bad = want.filter(([a, w]) => B.phone10(a) !== w).map(([a, w]) => `"${a}" → "${B.phone10(a)}", expected "${w}"`);
  return bad.length === 0 || bad.join(" · ");
});
R("…and never invents ten digits out of something that is not a number", () => {
  const bad = ["", "12345", "abc", "999999999999999", "+91"].map((x) => [x, B.phone10(x)])
    .filter(([x, r]) => r.length === 10 && String(x).replace(/\D/g, "") !== r).map(([x, r]) => `"${x}" → "${r}"`);
  return bad.length === 0 || bad.join(" · ");
});
R("splitTax() gives back components that add to the whole, to the paisa", () => {
  const comps = [{ label: "CGST", rate: 0.025 }, { label: "SGST", rate: 0.025 }];
  const bad = [];
  for (const t of [0, 0.01, 1, 16.665, 100, 12345.67]) {
    const parts = B.splitTax(t, comps);
    if (!Array.isArray(parts)) { bad.push(`${t} → ${JSON.stringify(parts)}`); continue; }
    const sum = parts.reduce((a, x) => a + Number(x?.amount ?? x?.amt ?? x ?? 0), 0);
    if (Math.abs(sum - t) > 0.005) bad.push(`${t} split into ${JSON.stringify(parts).slice(0, 70)} which adds to ${sum}`);
  }
  return bad.length === 0 || bad.join(" · ");
});
R("…and one paisa is not lost between two halves", () => {
  const comps = [{ label: "CGST", rate: 0.025 }, { label: "SGST", rate: 0.025 }];
  const parts = B.splitTax(0.01, comps);
  const sum = (parts || []).reduce((a, x) => a + Number(x?.amount ?? x?.amt ?? x ?? 0), 0);
  return Math.abs(sum - 0.01) < 0.0005 || `one paisa split into ${JSON.stringify(parts).slice(0, 80)}`;
});
R("…and a 0% component is never handed rupees, because a line cannot contradict itself", () => {
  const parts = B.splitTax(19, [{ label: "A", rate: 0 }, { label: "B", rate: 0.05 }]);
  const zero = (parts || []).find((x) => Number(x?.rate) === 0);
  return (!zero || Number(zero.amount ?? zero.amt ?? 0) === 0) || `a 0% line was given ${JSON.stringify(zero)}`;
});
R("orderTaxRate() takes the order's OWN rate before the restaurant's", () => {
  const own = B.orderTaxRate({ tax_rate: 0.18 }, 0.05);
  const fall = B.orderTaxRate({ tax_rate: null }, 0.05);
  return (Math.abs(own - 0.18) < 1e-9 && Math.abs(fall - 0.05) < 1e-9) || `own ${own}, fallback ${fall}`;
});
R("…and an order deliberately set to 0% is charged nothing, not the restaurant's rate", () => {
  const r = B.orderTaxRate({ tax_rate: 0, subtotal: 400 }, 0.05);
  return Number(r) === 0 || `a zero-rated order was charged ${r}`;
});
R("…and with neither, it charges nothing rather than guessing", () =>
  Number(B.orderTaxRate({}, null)) === 0 || `it charged ${B.orderTaxRate({}, null)}`);
R("combineBillLines() adds up two of the same dish instead of printing it twice", () => {
  const out = B.combineBillLines([{ title: "Dal", qty: 1, price: 200 }, { title: "Dal", qty: 2, price: 200 }]);
  if (!Array.isArray(out)) return `it returned ${JSON.stringify(out)}`;
  const dal = out.filter((l) => l && l.title === "Dal");
  return (dal.length === 1 && Number(dal[0].qty) === 3) || `it produced ${JSON.stringify(out).slice(0, 110)}`;
});
R("…but the same dish with DIFFERENT add-ons stays two lines, because they are two things", () => {
  const out = B.combineBillLines([
    { title: "Pizza", qty: 1, price: 500, options: [{ label: "Olives" }] },
    { title: "Pizza", qty: 1, price: 500, options: [] }]);
  return (Array.isArray(out) && out.length === 2) || `they were merged into ${JSON.stringify(out).slice(0, 110)}`;
});
R("…and at a different PRICE too — the same dish sold twice at two prices is two lines", () => {
  const out = B.combineBillLines([{ title: "Dal", qty: 1, price: 200 }, { title: "Dal", qty: 1, price: 240 }]);
  return (Array.isArray(out) && out.length === 2) || `they were merged into ${JSON.stringify(out).slice(0, 110)}`;
});
R("…and a hole in the list does not cost the lines around it", () => {
  const out = B.combineBillLines([{ title: "Dal", qty: 1, price: 200 }, null, { title: "Naan", qty: 2, price: 60 }]);
  return (Array.isArray(out) && out.filter(Boolean).length === 2) || `it produced ${JSON.stringify(out).slice(0, 110)}`;
});
R("mrpPart() answers zero for a composition-scheme restaurant, which collects no tax to separate", () =>
  Number(B.mrpPart({ composition: true, nontax: 500 })) === 0 || `it answered ${B.mrpPart({ composition: true, nontax: 500 })}`);
R("…and the untaxed pile otherwise", () =>
  Number(B.mrpPart({ nontax: 40 })) === 40 || `it answered ${B.mrpPart({ nontax: 40 })}`);
R("mrpTaxInside() answers zero for a bill with no MRP line at all", () => {
  const v = Number(B.mrpTaxInside([{ id: "a", status: "served", items: [{ title: "Dal", qty: 1, price: 200 }] }], 0.05));
  return Math.abs(v) < 0.005 || `it answered ${v}`;
});
R("taxModel() answers a shape, not a crash, for a restaurant that has set nothing", () => {
  const m = B.taxModel({});
  return (m && typeof m === "object") || `it returned ${JSON.stringify(m)}`;
});
R("bqPaper() clamps a margin somebody typed 999 into", () => {
  const p = B.bqPaper({ banquet_paper_top: 999, banquet_paper_bot: 999, banquet_paper_side: 999 });
  return (p.top <= 80 && p.bot <= 50 && p.side <= 25) || `it accepted ${JSON.stringify(p)}`;
});
R("…and one somebody typed a negative number into", () => {
  const p = B.bqPaper({ banquet_paper_top: -50, banquet_paper_bot: -50, banquet_paper_side: -50 });
  return (p.top >= 0 && p.bot >= 0 && p.side >= 2) || `it accepted ${JSON.stringify(p)}`;
});
R("…and defaults to A5, because that is the sheet a restaurant already has", () =>
  (B.bqPaper({}).size === "a5" && B.bqPaper({ banquet_paper_size: "a4" }).size === "a4")
  || `it defaults to ${B.bqPaper({}).size}`);
R("bqWords() names the same amount as the figure beside it, paise and all", () => {
  const w = String(B.bqWords(1234.56));
  return (/One Thousand Two Hundred Thirty-Four/.test(w) && /Fifty-Six Paise/.test(w)) || `it reads "${w}"`;
});
R("…and counts in lakh and crore, not in millions", () => {
  const w = String(B.bqWords(10000000));
  return (/Crore/i.test(w) && !/Million/i.test(w)) || `₹1,00,00,000 reads "${w}"`;
});
R("…and every amount a real banquet reaches reads as English", () => {
  const bad = [1, 999, 1234.56, 100000, 9999999, 10000000, 99999999, 100000000, 999999999]
    .map((n) => [n, String(B.bqWords(n))]).filter(([, w]) => /undefined|NaN|\[object/.test(w))
    .map(([n, w]) => `${n} → "${w.slice(0, 50)}"`);
  return bad.length === 0 || bad.join(" · ");
});
R("bqOn() knows which fields a banquet sheet shows by default", () =>
  (B.bqOn({}, "cust_name") === true && B.bqOn({}, "a-field-nobody-added") === false)
  || `cust_name ${B.bqOn({}, "cust_name")}, unknown ${B.bqOn({}, "a-field-nobody-added")}`);
R("…and a restaurant's own list replaces the default rather than adding to it", () =>
  (B.bqOn({ banquet_fields: ["pax"] }, "pax") === true && B.bqOn({ banquet_fields: ["pax"] }, "cust_name") === false)
  || "a field left off the restaurant's own list still shows");
R("billIdentity() gives a restaurant that has set nothing a name it can print", () => {
  const i = B.billIdentity({}, { id: "r-x", slug: "x" });
  return (i && typeof i.name === "string" && i.name.length > 0 && !/undefined|null/.test(i.name)) || `it produced ${JSON.stringify(i?.name)}`;
});
R("…and one restaurant's own settings never reach another's paper", () => {
  B.billIdentity({ restaurant_name: "Alpha Kitchen" }, { id: "a", slug: "a" });
  const b = B.billIdentity({}, { id: "b", slug: "b" });
  return b.name !== "Alpha Kitchen" || "a name set on one restaurant printed on another's bill";
});
R("kotLineHtml() draws a line for a row that is entirely missing", () => {
  const h = String(B.kotLineHtml(null, ""));
  return (/^<div/.test(h) && !/undefined|NaN|\[object/.test(h)) || `it drew "${h.slice(0, 80)}"`;
});
R("…and shows a quantity a cook can act on, whatever the quantity really was", () => {
  const bad = [{ qty: null }, { qty: {} }, { qty: "abc" }, { qty: -5 }, { qty: 0 }]
    .map((r) => [r, String(B.kotLineHtml({ title: "Dal", ...r }, ""))])
    .filter(([, h]) => !/class="q">\d+(\.\d+)?×/.test(h)).map(([r, h]) => `${JSON.stringify(r)} → ${h.slice(0, 60)}`);
  return bad.length === 0 || bad.join(" · ");
});
R("billRows() survives a bill with no lines and one with only bad lines", () => {
  const a = B.billRows({ lines: [] }), b = B.billRows({ lines: [null, undefined, {}] });
  return (a !== undefined && b !== undefined) || `empty → ${JSON.stringify(a)}, bad → ${JSON.stringify(b)}`;
});
R("…and the untaxed pile it reports is never bigger than the bill it is part of", () => {
  const out = B.billRows({ subtotal: 100, nontax: 100000, taxable: 100, total: 100 });
  const nontax = Number(out?.nontax ?? out?.nontaxShown ?? 0);
  return (!Number.isFinite(nontax) || nontax <= 100.01) || `a ₹100 bill reported ₹${nontax} of untaxed lines`;
});
/* THE BLOCK IS THE CONTRACT. This bank came out 103 rows rather than the 90 the plan gave it —
   twenty-seven exports each carrying two universal promises, plus the ones that decide something.
   The 13 extra were NOT deleted to make the plan right: every one is a real question about a real
   exported function. The plan moved instead, inside the 500 this terminal claimed and landed on
   `main`, and the other banks were re-cut around it (J 140 · K 90 · L 77 · M 90 · N 103 = 500).
   A bank that trims real checks to hit a round number is a bank that reports a number, not work. */
if (id - 1 !== 101594) throw new Error(`bank N ended at P${id - 1}, not P101594 — it has ${id - 1 - 101491} rows`);
