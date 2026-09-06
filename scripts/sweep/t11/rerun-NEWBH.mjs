// NEW B · D · E · F · G · H of T8.md's sweep-#7 block, re-run. P18701–P19100 (400 rows).
//
// GENERATED FROM THE LEDGER, like NEW A: each id's own sentence carries its parameters — "the
// header rows are right for parcel=true invoice=118 billNo=0 customer=true" — so the assertion is
// built from the row rather than from my memory of it, and 400 generated ids cannot drift out of
// alignment with what they claim to test. Anything the parser cannot place REPORTS ITSELF rather
// than being skipped.
import { BILLDOC as B, row, read, visible, totalRows, codeOnly } from "./lib.mjs";
import { BASE, canDrive, renderDoc, seenText, inkWidth, ROLL_PX } from "./browser.mjs";

const T8 = read(".claude/sweep/LEDGER/T8.md").split("\n");
const ROWS = [];
for (const ln of T8) {
  const m = /^\| (P1(?:8[7-9]\d\d|9\d\d\d)) \| (.*?) \| (.*?) \|/.exec(ln);
  if (m) { const n = +m[1].slice(1); if (n >= 18701 && n <= 19100) ROWS.push({ id: m[1], check: m[2].trim() }); }
}
const S5 = { tax_rate: 0.05 };
const r2 = (n) => Math.round(n * 100) / 100;
const ord = (o = {}) => ({ id: "o" + Math.random().toString(36).slice(2), status: "served", subtotal: 400,
  taxable_base: 400, tax_rate: 0.05, items: [{ title: "Dal", qty: 2, price: 200, tax_mode: "excl" }], ...o });
const dataOf = (orders, settings = S5, session = {}) => {
  const m = B.billMoney(orders, settings);
  return B.billData({ settings, restaurant: {}, orders, money: m, session, tableDisp: "5" });
};
/** the identities every printed bill must satisfy — the same set bank E uses */
const foots = (d) => {
  const R = B.billRows(d);
  const base = R.disc > 0 ? R.taxable : R.subtotal;
  const sum = base + (R.inclusive ? 0 : R.tax) + R.nontax + R.roundOff;
  return { ok: sum === R.total, R, sum };
};
const clean = (html) => ["NaN", "undefined", "[object Object]", "Infinity", "${", "-->"].filter((x) => html.includes(x));

// ══ NEW B ═══════════════════════════════════════════════════════════════════════════════════
const DRIFTS = {
  "the lines match the bill": 0, "the lines are 1% over": 0.01, "the lines are 20% over": 0.20,
  "the lines are 1% under": -0.01, "the lines are 40% under": -0.40,
  "the lines are DOUBLE the bill": 1.0, "the bill is zero": null, "the lines are 0.5% over (paise-level)": 0.005,
};
const LINESETS = {
  "one line": [100000],
  "two lines, one cheap": [100000, 100],
  "three lines": [50000, 30000, 20000],
  "four lines": [40000, 30000, 20000, 10000],
  "ten lines": [20000, 15000, 12000, 11000, 10000, 9000, 8000, 7000, 5000, 3000],
  "five lines, one of them zero": [40000, 30000, 20000, 10000, 0],
  "every line at zero": [0, 0, 0],
};
const banquetShape = (lines, drift) => {
  const sub = lines.reduce((a, x) => a + x, 0);
  const billSub = drift === null ? 0 : r2(sub / (1 + drift));
  const tax = r2(billSub * 0.18);
  return B.banquetDocHtml({
    bill: { bill_no: "B/1", issued_at: "2026-08-16T16:01:00Z", subtotal: billSub, discount: 0, tax, total: r2(billSub + tax),
      tax_lines: [{ label: "CGST", rate: 9, amt: r2(tax / 2) }, { label: "SGST", rate: 9, amt: r2(tax - r2(tax / 2)) }] },
    lines: lines.map((p, i) => ({ title: `Line ${i + 1}`, qty: 1, price: p })), settings: {}, restaurant: {},
  });
};
const banquetCols = (html) => {
  const rows_ = [...html.matchAll(/<tr><td class="c">\d+<\/td>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  return rows_.map((r) => [...r.matchAll(/<td class="r">([\d,.-]+)<\/td>/g)].map((x) => Number(x[1].replace(/,/g, ""))));
};
const bTot = (html, which) => {
  const tot = /<tr class="tot">([\s\S]*?)<\/tr>/.exec(html);
  if (!tot) return null;
  const cells = [...tot[1].matchAll(/<td class="r">([\d,.-]+)<\/td>/g)].map((x) => Number(x[1].replace(/,/g, "")));
  return cells[which];
};

// ══ the dispatch table ══════════════════════════════════════════════════════════════════════
const HANDLERS = [
  // ── NEW B · the banquet columns ─────────────────────────────────────────────────────────
  [/^the banquet columns foot and stay non-negative when (.+?) and (.+)$/, (m) => () => {
    const lines = LINESETS[m[1]], drift = DRIFTS[m[2]];
    if (!lines || drift === undefined) return `the generator does not know the shape "${m[1]}" / "${m[2]}"`;
    const html = banquetShape(lines, drift);
    const cols = banquetCols(html);
    const bad = [];
    for (const cells of cols) for (const v of cells) if (v < 0) bad.push(v);
    if (bad.length) return `${bad.length} negative cell(s), first ${bad[0]} — a negative line on a tax invoice reads as a refund nobody gave`;
    // the taxable column must foot to the TOTAL row's taxable
    const taxable = cols.map((c) => c[1] || 0).reduce((a, x) => a + x, 0);
    const want = bTot(html, 0);
    if (want == null) return "no TOTAL row on the sheet";
    return Math.abs(r2(taxable) - want) < 0.02 || `the taxable column adds to ${r2(taxable)}, the TOTAL row says ${want}`;
  }],
  // ── NEW B · the round-off never grows into a claw-back ──────────────────────────────────
  [/^the round-off stays within a rupee or two: MRP treated as (tax-inclusive|exempt), (\d+)% off$/, (m) => () => {
    const pct = +m[2];
    const mode = m[1] === "tax-inclusive" ? "incl" : "exempt";
    const orders = [ord({ subtotal: 442, taxable_base: 400, nontax_amount: 42, discount: r2(400 * pct / 100),
      items: [{ title: "Dal", qty: 2, price: 200, tax_mode: "excl" }, { title: "W", qty: 1, price: 42, is_mrp: true, tax_mode: mode }] })];
    const d = dataOf(orders, { ...S5, mrp_tax_treatment: m[1] === "tax-inclusive" ? "inclusive" : "none" });
    const f = foots(d);
    if (!f.ok) return `the rows add to ${f.sum} and the TOTAL says ${f.R.total}`;
    return Math.abs(f.R.roundOff) <= 2 || `round off ${f.R.roundOff} — this file's own note says at most a rupee or two`;
  }],
  [/^the round-off stays within a rupee or two, and the rows foot: (.+)$/, (m) => () => {
    const SHAPES = {
      "a plain 5% bill": [[ord()], S5],
      "a plain 5% bill with a discount": [[ord({ discount: 40 })], S5],
      "a 12% bill": [[ord({ tax_rate: 0.12 })], { tax_rate: 0.12 }],
      "tax already inside the prices": [[ord({ items: [{ title: "Combo", qty: 1, price: 420, tax_mode: "incl" }] })], { tax_rate: 0.05, price_tax_mode: "incl" }],
      "a composition bill": [[ord({ tax_rate: 0 })], { price_tax_mode: "composition" }],
      "two orders at different rates": [[ord({ tax_rate: 0.05 }), ord({ id: "o2", tax_rate: 0.18 })], S5],
      "an exempt line beside a taxed one": [[ord({ items: [{ title: "Dal", qty: 1, price: 200, tax_mode: "excl" }, { title: "Book", qty: 1, price: 200, tax_mode: "exempt" }] })], S5],
      "a qty-3 line": [[ord({ subtotal: 600, taxable_base: 600, items: [{ title: "Dal", qty: 3, price: 200, tax_mode: "excl" }] })], S5],
      "a priced add-on": [[ord({ items: [{ title: "Pizza", qty: 1, price: 260, tax_mode: "excl", options: [{ label: "Cheese", price: 60 }] }] })], S5],
      "a paise-level subtotal": [[ord({ subtotal: 201.37, taxable_base: 201.37, items: [{ title: "Dal", qty: 1, price: 201.37, tax_mode: "excl" }] })], S5],
    };
    const key = Object.keys(SHAPES).find((k) => m[1].startsWith(k));
    if (!key) return `the generator does not know the shape "${m[1]}"`;
    const [orders, settings] = SHAPES[key];
    const f = foots(dataOf(orders, settings));
    if (!f.ok) return `the rows add to ${f.sum} and the TOTAL says ${f.R.total}`;
    return Math.abs(f.R.roundOff) <= 2 || `round off ${f.R.roundOff}`;
  }],
  // ── NEW B · the bill renders honestly on rubbish input ──────────────────────────────────
  [/^the bill renders honestly with (.+?) — no NaN/, (m) => () => {
    const BAD = {
      "a negative subtotal": { subtotal: -400 }, "a negative total": { total: -420 },
      "a discount bigger than the bill": { discount: 5000 }, "a negative discount": { discount: -50 },
      "a negative nontax pile": { nontax: -42 }, "a nontax pile bigger than the subtotal": { nontax: 5000 },
      "a negative tax row": { taxRows: [{ label: "CGST", rate: 2.5, amt: -10 }] },
      "a tax row of NaN": { taxRows: [{ label: "CGST", rate: 2.5, amt: NaN }] },
      "a subtotal of NaN": { subtotal: NaN }, "a total of NaN": { total: NaN },
      "a subtotal of Infinity": { subtotal: Infinity }, "a string subtotal": { subtotal: "four hundred" },
      "a string discount": { discount: "ten" },
      "null everywhere": { subtotal: null, total: null, discount: null, taxRows: null, lines: null },
      "no fields at all": "EMPTY", "an enormous total": { total: 1e15 },
      "a qty of -1": { lines: [{ title: "Dal", qty: -1, price: 200 }] },
      "a price of -100": { lines: [{ title: "Dal", qty: 1, price: -100 }] },
      "an add-on dearer than its dish": { lines: [{ title: "Dal", qty: 1, price: 100, options: [{ label: "Gold leaf", price: 500 }] }] },
      "a 999-line bill": { lines: Array.from({ length: 999 }, (_, i) => ({ title: `D${i}`, qty: 1, price: 10 })) },
      "a line with no title": { lines: [{ qty: 1, price: 100 }] },
      "options that are not an array": { lines: [{ title: "Dal", qty: 1, price: 100, options: "cheese" }] },
      "an option with no label": { lines: [{ title: "Dal", qty: 1, price: 100, options: [{ price: 20 }] }] },
      "a tax row with no label": { taxRows: [{ rate: 2.5, amt: 10 }] },
      "fifty tax rows": { taxRows: Array.from({ length: 50 }, (_, i) => ({ label: `T${i}`, rate: 1, amt: 1 })) },
    };
    const key = Object.keys(BAD).find((k) => m[1].startsWith(k));
    if (!key) return `the generator does not know the input "${m[1]}"`;
    const base = { name: "R", tableDisp: "5", dateStr: "x", lines: [{ title: "Dal", qty: 2, price: 200 }],
      subtotal: 400, total: 420, taxRows: [{ label: "CGST", rate: 2.5, amt: 10 }, { label: "SGST", rate: 2.5, amt: 10 }], noBar: true };
    let html;
    try { html = B.billDocHtml(BAD[key] === "EMPTY" ? { noBar: true } : { ...base, ...BAD[key] }); }
    catch (e) { return `it threw: ${e.message} — a throw here is a BLANK WINDOW at the till`; }
    const junk = clean(html);
    if (junk.length) return `the paper shows ${junk.join(", ")}`;
    return html.length > 200 || `it rendered only ${html.length} characters`;
  }],
  // ── NEW B · what the sheet CALLS itself, across GSTIN × scheme × live/cancelled ─────────
  [/^(a live|a cancelled) sale at a restaurant with (a GSTIN|no GSTIN|a whitespace GSTIN), (on the ordinary scheme|on the composition scheme|with tax inside prices)/, (m) => () => {
    const gstin = m[2] === "a GSTIN" ? "24ABCDE1234F1Z5" : m[2] === "a whitespace GSTIN" ? "   " : "";
    const comp = m[3] === "on the composition scheme";
    const incl = m[3] === "with tax inside prices";
    const cancelled = m[1] === "a cancelled";
    const settings = { ...(comp ? { price_tax_mode: "composition" } : incl ? { tax_rate: 0.05, price_tax_mode: "incl" } : S5), gstin };
    const orders = [ord({ status: cancelled ? "cancelled" : "served", tax_rate: comp ? 0 : 0.05 })];
    const d = dataOf(orders, settings, { bill_no: 7 });
    const html = B.billDocHtml({ ...d, noBar: true });
    const title = (/<title>([^<]*)</.exec(html) || [, ""])[1].split(" — ")[0];
    const kind = (/<div class="kind">([^<]*)</.exec(html) || [, ""])[1];
    const want = cancelled ? "Cancelled Bill" : comp ? "Bill of Supply" : (gstin.trim() ? "Tax Invoice" : "Bill");
    if (title !== want || kind !== want) return `it calls itself "${title}" / "${kind}" — a ${m[2]}, ${m[3]}, ${m[1]} sale should be "${want}"`;
    // …and a sheet with no real GSTIN never claims one
    if (!gstin.trim() && /GSTIN/.test(html)) return "a sheet with no registration still prints a GSTIN line";
    return true;
  }],
  [/^a tax invoice may add tax rows$/, () => () => {
    const d = dataOf([ord()], { ...S5, gstin: "24ABCDE1234F1Z5" });
    return d.taxRows.length > 0 || "a tax invoice adds none";
  }],
  [/^a Bill of Supply adds NO tax row$/, () => () => {
    const d = dataOf([ord({ tax_rate: 0 })], { price_tax_mode: "composition" });
    return d.taxRows.length === 0 || `${d.taxRows.length} tax row(s)`;
  }],
  [/^a Bill of Supply carries the declaration$/, () => () => {
    const d = dataOf([ord({ tax_rate: 0 })], { price_tax_mode: "composition" });
    return /Composition taxable person/.test(B.billDocHtml({ ...d, noBar: true })) || "no declaration";
  }],
  [/^a tax-inside bill reports tax BELOW the total$/, () => () => {
    const v = visible(B.billDocHtml({ name: "R", tableDisp: "1", dateStr: "x", lines: [], subtotal: 400, total: 400,
      inclRows: [{ label: "CGST", rate: 2.5, amt: 5 }], taxRows: [], noBar: true }));
    return v.indexOf("Price includes") > v.indexOf("TOTAL") || `TOTAL at ${v.indexOf("TOTAL")}, Price includes at ${v.indexOf("Price includes")}`;
  }],
  [/^…and adds none above it$/, () => () => {
    const html = B.billDocHtml({ name: "R", tableDisp: "1", dateStr: "x", lines: [], subtotal: 400, total: 400,
      inclRows: [{ label: "CGST", rate: 2.5, amt: 5 }], taxRows: [], noBar: true });
    return !totalRows(html).some((r) => /GST/.test(r[0])) || "a tax row printed above the TOTAL";
  }],
  [/^a plain Bill still shows what was charged$/, () => () => {
    const d = dataOf([ord()], { ...S5, gstin: "" });
    return B.billRows(d).total === Math.round(d.total) || "the total moved";
  }],
  [/^…and still lists its items$/, () => () => {
    const d = dataOf([ord()], { ...S5, gstin: "" });
    return /Dal/.test(B.billDocHtml({ ...d, noBar: true })) || "the items vanished";
  }],
  [/^…and still names its date$/, () => () => {
    const d = dataOf([ord()], { ...S5, gstin: "" });
    return visible(B.billDocHtml({ ...d, noBar: true })).includes("Date") || "no date row";
  }],
  [/^a (Bill of Supply|plain Bill) never says Tax Invoice anywhere$/, (m) => () => {
    const settings = m[1] === "a Bill of Supply" ? { price_tax_mode: "composition" } : { ...S5, gstin: "" };
    const d = dataOf([ord({ tax_rate: m[1] === "a Bill of Supply" ? 0 : 0.05 })], settings);
    return !/Tax Invoice/i.test(B.billDocHtml({ ...d, noBar: true })) || "it says Tax Invoice";
  }],
  [/^a tax invoice prints its GSTIN in the letterhead$/, () => () => {
    const d = dataOf([ord()], { ...S5, gstin: "24ABCDE1234F1Z5" });
    return /GSTIN 24ABCDE1234F1Z5/.test(B.billDocHtml({ ...d, noBar: true })) || "no GSTIN in the letterhead";
  }],
  // ── NEW B · the header rows, over the whole 24-way grid ────────────────────────────────
  [/^the header rows are right for parcel=(\w+) invoice=(\w+) billNo=(\w+) customer=(\w+)/, (m) => () => {
    const parcel = m[1] === "true";
    const invNo = m[2] === "null" ? "" : `INV/2026-27/000${m[2]}`;
    const billNo = m[3] === "null" ? null : Number(m[3]);
    const cust = m[4] === "true";
    const html = B.billDocHtml({ name: "R", dateStr: "04/09/2026 01:00 pm", tableDisp: "5", parcel,
      invNo, billNo: billNo === null ? "" : billNo, cust: cust ? "Asha" : "", custPhone: cust ? "98250 12345" : "",
      lines: [], subtotal: 0, total: 0, taxRows: [], noBar: true });
    const v = visible(html);
    const bad = [];
    // the RULE (owner, 2026-08-21): bill_no shows ONLY when there is no invoice number
    if (invNo && !v.includes("Invoice")) bad.push("an invoice number that did not print");
    if (!invNo && v.includes("Invoice")) bad.push("an Invoice row with nothing in it");
    if (invNo && v.includes("Bill no")) bad.push("Bill no printed beside a real invoice number");
    if (!invNo && billNo !== null && !v.includes("Bill no")) bad.push("a bill number that did not print");
    if (!invNo && billNo === null && v.includes("Bill no")) bad.push("a Bill no row with nothing in it");
    if (parcel && v.includes("Table")) bad.push("a parcel showing a Table row");
    if (!parcel && !v.includes("Table")) bad.push("a table bill with no Table row");
    if (parcel && !v.includes("Parcel")) bad.push("a parcel not saying Parcel");
    if (cust && !v.includes("Customer")) bad.push("a captured customer that did not print");
    if (!cust && v.includes("Customer")) bad.push("a Customer row with nothing in it");
    return bad.length === 0 || bad.join(" · ");
  }],
];

// ══ NEW D · the preview's zoom layer ════════════════════════════════════════════════════════
const WINDOWS = {
  "a desktop window": { width: 1280, height: 900 }, "a laptop window": { width: 1440, height: 780 },
  "a narrow window": { width: 520, height: 900 }, "a Samsung A35": { width: 360, height: 780, dpr: 3 },
  "a very short window": { width: 1280, height: 420 }, "an iPad upright": { width: 768, height: 1024 },
};
const LINECOUNT = { "2-line": 2, "8-line": 8, "60-line": 60 };
const billOf = (n, over = {}) => ({ name: "Aangan Garden Restaurant", gstin: "24ABCDE1234F1Z5", tableDisp: "5",
  dateStr: "04/09/2026 01:00 pm", lines: Array.from({ length: n }, (_, i) => ({ title: `Dish ${i + 1}`, qty: 1, price: 100 })),
  subtotal: n * 100, total: n * 105, taxRows: [{ label: "CGST", rate: 2.5, amt: Math.round(n * 2.5) }, { label: "SGST", rate: 2.5, amt: Math.round(n * 2.5) }],
  autoPrint: false, ...over });
HANDLERS.push(
  [/^an? ([\w-]+) bill opens fitted to (.+?) —/, (m) => async () => {
    if (!canDrive) return `needs playwright and a server at ${BASE}`;
    const n = LINECOUNT[m[1]], win = WINDOWS[m[2]];
    if (!n || !win) return `the generator does not know "${m[1]}" / "${m[2]}"`;
    const r = await renderDoc("bill", billOf(n), win);
    try {
      await r.page.waitForTimeout(900);
      const s = await r.page.evaluate(() => ({ need: document.documentElement.scrollHeight, have: innerHeight,
        z: parseFloat(getComputedStyle(document.body).zoom), chip: (document.querySelector(".zl")?.textContent || "").trim() }));
      // The rule the rows state: the whole sheet on screen, OR scrolling with the zoom already at
      // its 0.6 floor — which is the documented answer for a bill too long to fit and stay readable.
      if (s.need <= s.have + 6) return true;
      return s.z <= 0.61 || `it stopped at zoom ${s.z} (${s.chip}) with ${s.need}px to show in ${s.have}px, and the floor is 0.6`;
    } finally { await r.close(); }
  }],
  [/^(.+?): the PRINTED sheet is identical whatever the screen is zoomed to \((.+?)\)$/, (m) => async () => {
    if (!canDrive) return `needs playwright and a server at ${BASE}`;
    const SHAPES = {
      "a plain bill": billOf(8), "a discounted bill": billOf(8, { discount: 80, discLabel: "10%", total: 760 }),
      "a cancelled bill": billOf(8, { cancelled: true }), "a composition bill": billOf(8, { composition: true, taxRows: [] }),
      "an MRP bill": billOf(8, { nontax: 42, subtotal: 842, total: 882 }),
    };
    const key = Object.keys(SHAPES).find((k) => m[1].startsWith(k));
    if (!key) return `the generator does not know the shape "${m[1]}"`;
    const zoom = m[2];
    const r = await renderDoc("bill", SHAPES[key], { width: 1280, height: 900 });
    try {
      await r.page.waitForTimeout(700);
      // set the SCREEN zoom the row names — a number, "fit", or a nonsense value the code must survive
      await r.page.evaluate((z) => {
        try { localStorage.setItem("lfh_bill_zoom", z); } catch { /* nothing */ }
        if (typeof zStart === "function") zStart();
      }, zoom);
      await r.page.waitForTimeout(400);
      // …then ask what the PAPER is, under print media, which resets zoom to 1 with !important
      await r.page.emulateMedia({ media: "print" });
      await r.page.waitForTimeout(200);
      const paper = await r.page.evaluate(() => ({
        zoom: getComputedStyle(document.body).zoom,
        width: Math.round(document.body.getBoundingClientRect().width),
        text: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 400),
      }));
      if (String(paper.zoom) !== "1") return `the paper is zoomed to ${paper.zoom} — a screen setting reached the printer`;
      return Math.abs(paper.width - ROLL_PX) <= 1 || `the printed column is ${paper.width}px, not ${ROLL_PX}px`;
    } finally { await r.close(); }
  }],
  // Everything the zoom layer remembers, and everything it must refuse to believe. The stored
  // value is a per-window key written by a person's own − / + presses, so it is untrusted input:
  // a word, an object, a negative, NaN and 1e9 all have to land somewhere sane between 0.6 and 2.
  [/^the preview opens at the right size with (?:a remembered |the word )?(.+?) remembered$/, (m) => async () => {
    if (!canDrive) return `needs playwright and a server at ${BASE}`;
    const RAW = { "fit": "fit", "1.5": "1.5", "0.6": "0.6", "2": "2", "1.35": "1.35",
      "0.59 (below the floor)": "0.59", "2.01 (above the ceiling)": "2.01", "0": "0", "-1": "-1",
      "NaN": "NaN", "empty string": "", "word": "banana", "1e9": "1e9", "object literal": "[object Object]" };
    const key = Object.keys(RAW).find((k) => m[1].startsWith(k));
    if (key === undefined) return `the generator does not know the remembered value "${m[1]}"`;
    const v = RAW[key];
    const r = await renderDoc("bill", billOf(8), { width: 1280, height: 900,
      seed: `(() => { try {
        const w = Math.round((innerWidth || 380) / 100) * 100, h = Math.round((innerHeight || 680) / 100) * 100;
        localStorage.setItem("lfh_bill_zoom:" + w + "x" + h, ${JSON.stringify(v)});
        localStorage.setItem("lfh_bill_zoom", ${JSON.stringify(v)});
      } catch (e) {} })()` });
    try {
      await r.page.waitForTimeout(900);
      const s2 = await r.page.evaluate(() => ({ z: parseFloat(getComputedStyle(document.body).zoom), chip: (document.querySelector(".zl")?.textContent || "").trim() }));
      if (!(s2.z >= 0.6 && s2.z <= 2)) return `a remembered "${v}" put the bill at zoom ${s2.z} — outside the 0.6–2 range`;
      return /^\d+%$/.test(s2.chip) || `the chip reads "${s2.chip}"`;
    } finally { await r.close(); }
  }],
  [/^([−+]) (?:steps (?:the size )?(?:down|it up)|cannot go (?:below|above))/, (m) => async () => {
    if (!canDrive) return `needs playwright and a server at ${BASE}`;
    const dir = m[1] === "+" ? 1 : -1;
    const limit = /cannot go/.test(m[0]);
    const r = await renderDoc("bill", billOf(8), { width: 1280, height: 900 });
    try {
      await r.page.waitForTimeout(800);
      const press = async (n) => {
        for (let i = 0; i < n; i++) {
          await r.page.evaluate((d) => {
            const b = [...document.querySelectorAll(".zg button")].find((x) => (x.textContent || "").includes(d > 0 ? "+" : "\u2212"));
            b?.click();
          }, dir);
          await r.page.waitForTimeout(60);
        }
        return r.page.evaluate(() => ({ z: parseFloat(getComputedStyle(document.body).zoom), stored: (() => { try { const w = Math.round(innerWidth / 100) * 100, h = Math.round(innerHeight / 100) * 100; return localStorage.getItem("lfh_bill_zoom:" + w + "x" + h); } catch { return null; } })() }));
      };
      const before = await r.page.evaluate(() => parseFloat(getComputedStyle(document.body).zoom));
      if (limit) {
        const after = await press(30);
        const floor = dir > 0 ? 2 : 0.6;
        return Math.abs(after.z - floor) < 0.011 || `thirty presses landed at ${after.z}, and the limit is ${floor}`;
      }
      const after = await press(1);
      if (Math.abs(after.z - before) < 0.001) return `one press did not move it from ${before}`;
      const step = Math.abs(after.z - before);
      if (Math.abs(step - 0.15) > 0.011) return `one press moved it by ${step.toFixed(3)}, not 0.15`;
      return after.stored != null || "the choice was not remembered";
    } finally { await r.close(); }
  }],
  [/^the % chip is itself the 'fit the whole bill' button$/, () => async () => {
    if (!canDrive) return `needs playwright and a server at ${BASE}`;
    const r = await renderDoc("bill", billOf(8), { width: 1280, height: 900 });
    try {
      await r.page.waitForTimeout(800);
      await r.page.evaluate(() => { const b = [...document.querySelectorAll(".zg button")].find((x) => (x.textContent || "").includes("+")); b?.click(); b?.click(); });
      await r.page.waitForTimeout(200);
      const zoomed = await r.page.evaluate(() => parseFloat(getComputedStyle(document.body).zoom));
      await r.page.evaluate(() => document.querySelector(".zl")?.click());
      await r.page.waitForTimeout(300);
      const fitted = await r.page.evaluate(() => ({ z: parseFloat(getComputedStyle(document.body).zoom), stored: (() => { try { const w = Math.round(innerWidth / 100) * 100, h = Math.round(innerHeight / 100) * 100; return localStorage.getItem("lfh_bill_zoom:" + w + "x" + h); } catch { return null; } })() }));
      if (fitted.z === zoomed) return `the chip did nothing (still ${zoomed})`;
      return fitted.stored === "fit" || `after tapping the chip the stored value is "${fitted.stored}", not "fit" — a longer bill later would not re-fit`;
    } finally { await r.close(); }
  }],
  [/^the chip's label tracks every change$/, () => async () => {
    if (!canDrive) return `needs playwright and a server at ${BASE}`;
    const r = await renderDoc("bill", billOf(8), { width: 1280, height: 900 });
    try {
      await r.page.waitForTimeout(800);
      const read2 = () => r.page.evaluate(() => ({ chip: (document.querySelector(".zl")?.textContent || "").trim(), z: parseFloat(getComputedStyle(document.body).zoom) }));
      const seen = [];
      for (let i = 0; i < 3; i++) {
        await r.page.evaluate(() => [...document.querySelectorAll(".zg button")].find((x) => (x.textContent || "").includes("+"))?.click());
        await r.page.waitForTimeout(120);
        seen.push(await read2());
      }
      const bad = seen.filter((s2) => s2.chip !== `${Math.round(s2.z * 100)}%`);
      return bad.length === 0 || `the chip says "${bad[0].chip}" at zoom ${bad[0].z}`;
    } finally { await r.close(); }
  }],
  [/^the toolbar's buttons stay life-size at every zoom$/, () => async () => {
    if (!canDrive) return `needs playwright and a server at ${BASE}`;
    const r = await renderDoc("bill", billOf(8), { width: 1280, height: 900 });
    try {
      await r.page.waitForTimeout(800);
      const heights = [];
      for (let i = 0; i < 4; i++) {
        heights.push(await r.page.evaluate(() => {
          const b = [...document.querySelectorAll(".bar button")].find((x) => /Close/.test(x.textContent || ""));
          return b ? Math.round(b.getBoundingClientRect().height) : -1;
        }));
        await r.page.evaluate(() => [...document.querySelectorAll(".zg button")].find((x) => (x.textContent || "").includes("\u2212"))?.click());
        await r.page.waitForTimeout(120);
      }
      const spread = Math.max(...heights) - Math.min(...heights);
      return spread <= 3 || `the ✕ button measured ${heights.join(", ")}px across four zooms — the bar is not wound back`;
    } finally { await r.close(); }
  }],
  [/^…and the ✕ Close button is never smaller than a \d+px target$/, (m) => async () => {
    if (!canDrive) return `needs playwright and a server at ${BASE}`;
    const want = Number(/(\d+)px/.exec(m[0])[1]);
    const r = await renderDoc("bill", billOf(8), { width: 360, height: 780 });
    try {
      await r.page.waitForTimeout(800);
      const hs = [];
      for (let i = 0; i < 4; i++) {
        hs.push(await r.page.evaluate(() => { const b = [...document.querySelectorAll(".bar button")].find((x) => /Close/.test(x.textContent || "")); return b ? Math.round(b.getBoundingClientRect().height) : -1; }));
        await r.page.evaluate(() => [...document.querySelectorAll(".zg button")].find((x) => (x.textContent || "").includes("\u2212"))?.click());
        await r.page.waitForTimeout(120);
      }
      const small = hs.filter((h) => h < want);
      return small.length === 0 || `it measured ${hs.join(", ")}px against a ${want}px target`;
    } finally { await r.close(); }
  }],
  [/^resizing the window re-fits while nothing has been chosen$/, () => async () => {
    if (!canDrive) return `needs playwright and a server at ${BASE}`;
    const r = await renderDoc("bill", billOf(20), { width: 1280, height: 900,
      seed: `(() => { try { localStorage.clear(); } catch (e) {} })()` });
    try {
      await r.page.waitForTimeout(800);
      const before = await r.page.evaluate(() => parseFloat(getComputedStyle(document.body).zoom));
      await r.page.setViewportSize({ width: 1280, height: 500 });
      await r.page.waitForTimeout(500);
      const after = await r.page.evaluate(() => parseFloat(getComputedStyle(document.body).zoom));
      return after !== before || `it stayed at ${before} when the window halved`;
    } finally { await r.close(); }
  }],
  [/^…and does NOT re-fit once a size has been chosen by hand$/, () => async () => {
    if (!canDrive) return `needs playwright and a server at ${BASE}`;
    const r = await renderDoc("bill", billOf(20), { width: 1280, height: 900 });
    try {
      await r.page.waitForTimeout(800);
      await r.page.evaluate(() => [...document.querySelectorAll(".zg button")].find((x) => (x.textContent || "").includes("+"))?.click());
      await r.page.waitForTimeout(200);
      const chosen = await r.page.evaluate(() => parseFloat(getComputedStyle(document.body).zoom));
      // AN ORDINARY RESIZE, which is what the row means. The remembered key carries the window's
      // shape rounded to the nearest 100px, deliberately — "so an ordinary resize does not lose the
      // choice but a genuinely different device gets its own". Dragging 900px→500px is four buckets
      // and IS a different shape, so re-fitting there is the designed answer; my first version made
      // that jump and read the design as a fault.
      await r.page.setViewportSize({ width: 1280, height: 880 });
      await r.page.waitForTimeout(500);
      const after = await r.page.evaluate(() => parseFloat(getComputedStyle(document.body).zoom));
      return after === chosen || `a hand-picked ${chosen} was undone by an ordinary resize (now ${after})`;
    } finally { await r.close(); }
  }],
  [/^…and DOES re-fit again after the chip is tapped/, () => async () => {
    if (!canDrive) return `needs playwright and a server at ${BASE}`;
    const r = await renderDoc("bill", billOf(20), { width: 1280, height: 900 });
    try {
      await r.page.waitForTimeout(800);
      await r.page.evaluate(() => [...document.querySelectorAll(".zg button")].find((x) => (x.textContent || "").includes("+"))?.click());
      await r.page.waitForTimeout(150);
      await r.page.evaluate(() => document.querySelector(".zl")?.click());
      await r.page.waitForTimeout(300);
      const fitted = await r.page.evaluate(() => parseFloat(getComputedStyle(document.body).zoom));
      await r.page.setViewportSize({ width: 1280, height: 480 });
      await r.page.waitForTimeout(500);
      const after = await r.page.evaluate(() => parseFloat(getComputedStyle(document.body).zoom));
      return after !== fitted || `after the chip it stayed at ${fitted} when the window changed`;
    } finally { await r.close(); }
  }],
  [/^the shared document renders without throwing for panel scenario (.+)$/, (m) => () => {
    // Thirteen panel scenarios: the shapes each surface really hands the builder.
    const N = m[1];
    const SC = {
      "1": [[ord()], S5], "2": [[ord({ discount: 40 })], S5],
      "3": [[ord({ status: "cancelled" })], S5], "4": [[ord({ tax_rate: 0 })], { price_tax_mode: "composition" }],
      "5": [[ord({ nontax_amount: 42, subtotal: 442 })], S5],
      "6": [[ord({ items: [{ title: "C", qty: 1, price: 420, tax_mode: "incl" }] })], { tax_rate: 0.05, price_tax_mode: "incl" }],
      "7": [[ord(), ord({ id: "o2", tax_rate: 0.18 })], S5],
      "8": [[ord({ items: [] })], S5], "9": [[], S5],
      "10": [[ord({ bill_cust_name: "Asha", bill_cust_phone: "9825012345" })], S5],
      "11": [[ord({ deleted_at: "x" })], S5], "12": [[ord({ tip: 200 })], S5],
      "13": [[ord({ items: [null, { title: "D", qty: 1, price: 100, tax_mode: "excl" }] })], S5],
    };
    const key = String(N).replace(/\D/g, "") || "1";
    const [orders, settings] = SC[key] || SC["1"];
    try {
      const d = dataOf(orders, settings);
      const html = B.billDocHtml({ ...d, noBar: true });
      const junk = clean(html);
      return junk.length === 0 || `the paper shows ${junk.join(", ")}`;
    } catch (e) { return `it threw: ${e.message}`; }
  }],
  [/^the preview opens at the right size with nothing remembered/, () => async () => {
    if (!canDrive) return `needs playwright and a server at ${BASE}`;
    const r = await renderDoc("bill", billOf(8), { width: 1280, height: 900,
      seed: `(() => { try { localStorage.clear(); } catch (e) {} })()` });
    try {
      await r.page.waitForTimeout(900);
      const s = await r.page.evaluate(() => ({ z: parseFloat(getComputedStyle(document.body).zoom), chip: (document.querySelector(".zl")?.textContent || "").trim() }));
      return (s.z >= 0.6 && s.z <= 2 && /^\d+%$/.test(s.chip)) || `zoom ${s.z}, chip "${s.chip}"`;
    } finally { await r.close(); }
  }],
);

// ══ NEW E · the customer sheet, driven as a waiter drives it ════════════════════════════════
async function sheet(opts = {}, size = { width: 360, height: 780 }) {
  const r = await renderDoc("bill", { name: "x", lines: [], subtotal: 0, total: 0, taxRows: [], tableDisp: "1", dateStr: "x", noBar: true }, size);
  await r.page.evaluate(() => { document.body.innerHTML = ""; });
  for (const src of ["/panels/backstack.js", "/panels/billcustomer.js"]) await r.page.addScriptTag({ url: src });
  await r.page.evaluate((o) => {
    const api = async () => ({ matches: [{ phone: "9825011111", name: "Asha Kumari", visits: 4 }] });
    window.LFH_BACK = { layer: () => () => {} };
    window.__res = window.LFH_BILLCUST.ask({ api, ...o });
  }, opts);
  await r.page.waitForSelector(".bcust-overlay", { timeout: 8000 }).catch(() => {});
  await r.page.waitForTimeout(250);
  return r;
}
const typeInto = async (page, phone, name) => {
  if (phone) { await page.click(".bcust-overlay input"); await page.keyboard.type(phone); await page.waitForTimeout(350); }
  if (name) {
    await page.evaluate(() => [...document.querySelectorAll(".bcust-overlay input")][1]?.focus());
    await page.keyboard.type(name); await page.waitForTimeout(250);
  }
};
const sheetState = (page) => page.evaluate(() => {
  const ov = document.querySelector(".bcust-overlay");
  const ins = [...document.querySelectorAll(".bcust-overlay input")];
  const go = [...document.querySelectorAll(".bcust-overlay button")].find((b) => /generate/i.test(b.textContent || ""));
  const counter = (ov?.innerText.match(/(\d+)\/10/) || [])[1];
  // READY IS `aria-disabled`, NOT A CLASS. setReady() writes aria-disabled plus inline opacity,
  // cursor, filter and boxShadow — the button keeps its class in every state, on purpose, because
  // it stays TAPPABLE so a tap can say what is missing instead of dying in silence. My first
  // version read className and therefore called every state "live".
  return { digits: (ins[0]?.value || "").replace(/\D/g, "").length, counter: counter == null ? null : Number(counter),
    green: !!ov?.querySelector(".ok"),
    ready: !!go && go.getAttribute("aria-disabled") === "false",
    dimmed: !!go && (go.style.opacity !== "" && Number(go.style.opacity) < 1),
    cls: go?.className || "", text: ov?.innerText || "" };
});
HANDLERS.push(
  [/^the counter and the button agree with the box after typing (.+)$/, (m) => async () => {
    if (!canDrive) return `needs playwright and a server at ${BASE}`;
    const what = m[1];
    const INPUT = { "4 digits": "9825", "9 digits": "982501234", "10 digits": "9825012345",
      "13 digits": "9825012345678", "16 digits (capped at 13)": "9825012345678999",
      "a +91 number": "+919825012345", "letters": "abcdefghij", "spaces and dashes": "98250-12345" };
    const key = Object.keys(INPUT).find((k) => what.startsWith(k.split(" (")[0]));
    if (!key) return `the generator does not know the input "${what}"`;
    const r = await sheet();
    try {
      await typeInto(r.page, INPUT[key], null);
      const s = await sheetState(r.page);
      // the counter must say what the BOX holds, and the green state must agree with "ten digits"
      if (s.counter == null) return "no counter on the sheet";
      // THE COUNTER SAYS WHAT IS IN THE BOX, even above ten — "13/10" is the honest reading of a
      // box holding three digits too many, and the box itself caps at 13. My first version expected
      // it to stop at 10, which would have hidden the overrun from the person typing.
      if (s.counter !== s.digits) return `the box holds ${s.digits} digits and the counter says ${s.counter}/10`;
      const shouldBeGreen = s.digits === 10;
      return s.green === shouldBeGreen || `${s.digits} digits: green=${s.green}, expected ${shouldBeGreen}`;
    } finally { await r.close(); }
  }],
  [/^Generate is (live|not ready) with (.+)$/, (m) => async () => {
    if (!canDrive) return `needs playwright and a server at ${BASE}`;
    const CASES = {
      "10 digits and a name": ["9825012345", "Asha"], "9 digits and a name": ["982501234", "Asha"],
      "13 digits and a name": ["9825012345678", "Asha"], "10 digits and no name": ["9825012345", ""],
      "nothing at all": ["", ""], "a name only": ["", "Asha"],
      "a +91 number and a name (norm folds it to ten)": ["+919825012345", "Asha"],
      "a name of spaces": ["9825012345", "   "],
    };
    const key = Object.keys(CASES).find((k) => m[2].startsWith(k.split(" (")[0]));
    if (!key) return `the generator does not know the case "${m[2]}"`;
    const [phone, name] = CASES[key];
    const r = await sheet({ required: true });
    try {
      await typeInto(r.page, phone, name);
      const s = await sheetState(r.page);
      // "live" is about how it LOOKS — the button is always tappable, by decision, so a tap can
      // say what is missing rather than dying in silence.
      const looksReady = s.ready && !s.dimmed;
      return looksReady === (m[1] === "live")
        || `it looks ${looksReady ? "live" : "not ready"} (aria-disabled=${s.ready ? "false" : "true"}, dimmed=${s.dimmed})`;
    } finally { await r.close(); }
  }],
  [/^tapping Generate with (.+?) says which box, in red, and puts the/, (m) => async () => {
    if (!canDrive) return `needs playwright and a server at ${BASE}`;
    const phone = /(\d+) digits/.test(m[1]) ? "9825012345678".slice(0, +/(\d+) digits/.exec(m[1])[1]) : "";
    const optional = /OPTIONAL/.test(m[1]);
    const r = await sheet({ required: !optional });
    try {
      if (phone) await typeInto(r.page, phone, null);
      const before = (await sheetState(r.page)).text;
      await r.page.evaluate(() => [...document.querySelectorAll(".bcust-overlay button")].find((b) => /generate/i.test(b.textContent || ""))?.click());
      await r.page.waitForTimeout(350);
      const after = await r.page.evaluate(() => ({
        text: document.querySelector(".bcust-overlay")?.innerText || "",
        tag: (document.activeElement?.tagName || "").toLowerCase(),
        stillOpen: !!document.querySelector(".bcust-overlay"),
      }));
      if (!after.stillOpen) return "the sheet closed instead of saying what was missing";
      if (after.text === before) return "the tap changed nothing on screen — a tap that dies in silence";
      return after.tag === "input" || `it said something but focus went to <${after.tag}>`;
    } finally { await r.close(); }
  }],
);

// ══ NEW F · cross-panel truth · NEW G · what the paper looks like · NEW H · judgment ════════
const SURFACE = {
  "the manager panel": "public/panels/editor/app.js", "the kitchen board": "public/panels/kitchen/app.js",
  "the waiter tablet": "public/panels/tablet/app.js", "the Access format preview": "lib/billPreview.ts",
  "the admin's print documents": "lib/printDocs.ts", "the Audit's evidence card": "lib/auditDetail.ts",
  "the admin restaurant settings screen": "components/admin/RestaurantSettings.tsx",
};
const readSurface = (name) => { const p = SURFACE[name]; try { return p ? read(p) : ""; } catch { return ""; } };
HANDLERS.push(
  [/^(.+?) builds no document of its own — it comes to billdoc\.js$/, (m) => () => {
    const t = readSurface(m[1]);
    if (!t) return `the generator does not know the surface "${m[1]}"`;
    const c = codeOnly(t);
    const comesToIt = /billDocHtml|kotDocHtml|banquetDocHtml|billPreviewHtml|billData|LFH_BILLDOC/.test(c);
    const buildsOwn = /<!doctype html>[\s\S]{0,400}(Tax Invoice|KITCHEN TICKET)/i.test(c);
    return (comesToIt && !buildsOwn) || `reaches the shared document: ${comesToIt}; builds its own: ${buildsOwn}`;
  }],
  [/^the panels load billdoc\.js before their own app\.js/, () => () => {
    const bad = ["editor", "kitchen", "tablet"].filter((p) => {
      const h = read(`public/panels/${p}/index.html`);
      const srcs = [...h.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((x) => x[1]);
      return srcs.findIndex((s) => s.includes("billdoc.js")) > srcs.findIndex((s) => /(^|\/)app\.js/.test(s));
    });
    return bad.length === 0 || `${bad.join(", ")} loads app.js first — printKot calls LFH_BILLDOC on the first board read`;
  }],
  [/^a change to billdoc\.js cannot reach a panel without its cache-busting hash$/, () => () => {
    const bad = ["editor", "kitchen", "tablet"].filter((p) => !/billdoc\.js\?v=[0-9a-f]{6,}/.test(read(`public/panels/${p}/index.html`)));
    return bad.length === 0 || `${bad.join(", ")} loads it unstamped`;
  }],
);
// NEW G and H are judgment against the RENDERED documents. Each names its own property; the ones
// this generator can answer are answered, and anything else reports itself rather than passing.
const G_H = {
  "a CANCELLED bill is unmistakable at a glance": () => {
    const h = B.billDocHtml({ name: "R", cancelled: true, tableDisp: "5", dateStr: "x", lines: [{ title: "Dal", qty: 1, price: 250 }], subtotal: 250, total: 0, taxRows: [], noBar: true });
    return /class="vband">Cancelled — no charge</.test(h) && /<div class="kind">Cancelled Bill</.test(h) || "the band or the heading is missing";
  },
  "…and its two money rows do not read as an arithmetic error": () => {
    const h = B.billDocHtml({ name: "R", cancelled: true, tableDisp: "5", dateStr: "x", lines: [{ title: "Dal", qty: 1, price: 250 }], subtotal: 250, total: 0, taxRows: [], noBar: true });
    const l = totalRows(h).map((r) => r[0]);
    return (l.includes("Ordered value") && l.includes("Cancelled — not charged") && !l.some((x) => /GST|Discount|Round/.test(x)))
      || `rows: ${l.join(" / ")}`;
  },
  "…and it still names the invoice number it retired, marked voided": () => {
    const d = dataOf([ord({ status: "cancelled" })], S5, { invoice_no: 41, invoice_at: "2026-04-01T12:00:00Z" });
    return / — voided$/.test(d.invNo) || `invNo "${d.invNo}"`;
  },
  "the footer sign-off reads as a sign-off, not as another row of the bill": () => {
    const h = B.billDocHtml({ name: "R", footer: "Thank you — please visit again", tableDisp: "5", dateStr: "x", lines: [], subtotal: 0, total: 0, taxRows: [], noBar: true });
    const foot = /<div class="foot">([^<]*)</.exec(h);
    return (foot && !/₹/.test(foot[1])) || "the footer carries money";
  },
  "the printed bill wastes no paper below the footer": () => {
    const h = B.billDocHtml({ name: "R", tableDisp: "5", dateStr: "x", lines: [], subtotal: 0, total: 0, taxRows: [], noBar: true });
    return !/@page\s*\{[^}]*size:/.test(h) || "a page length is declared — that is the blank-roll fault";
  },
  "a bill with one item and a bill with forty use the same layout rules": () => {
    const css = (h) => (/<style>([\s\S]*?)<\/style>/.exec(h) || [, ""])[1];
    const one = B.billDocHtml({ name: "R", tableDisp: "5", dateStr: "x", lines: [{ title: "A", qty: 1, price: 100 }], subtotal: 100, total: 105, taxRows: [], noBar: true });
    const forty = B.billDocHtml({ name: "R", tableDisp: "5", dateStr: "x", lines: Array.from({ length: 40 }, (_, i) => ({ title: `D${i}`, qty: 1, price: 100 })), subtotal: 4000, total: 4200, taxRows: [], noBar: true });
    return css(one) === css(forty) || "the two bills carry different stylesheets";
  },
  "the money columns grow for a bigger figure and never for a smaller one": () => {
    const w = (price) => [...B.billDocHtml({ name: "R", tableDisp: "5", dateStr: "x", lines: [{ title: "A", qty: 1, price }], subtotal: price, total: price, taxRows: [], noBar: true })
      .matchAll(/<col style="width:calc\((\d+)ch/g)].map((m) => +m[1]);
    const small = w(9), big = w(1070880);
    return (big.every((v, i) => v >= small[i]) && big.some((v, i) => v > small[i])) || `small ${small}, big ${big}`;
  },
};
HANDLERS.push([/^(.*)$/, (m) => {
  const key = Object.keys(G_H).find((k) => m[1].startsWith(k.slice(0, 46)));
  return key ? G_H[key] : null;
}]);

// ══ dispatch ════════════════════════════════════════════════════════════════════════════════
let built = 0;
for (const { id, check } of ROWS) {
  let fn = null;
  for (const [re, make] of HANDLERS) {
    const m = re.exec(check);
    if (!m) continue;
    const made = make(m);
    if (made) { fn = made; break; }
  }
  if (fn) { built++; row(id, check, fn); continue; }
  // Reported LOUDLY, never skipped — a generated bank that quietly drops rows is the
  // "suite that filters itself out and prints all clean" scar this repo already carries.
  row(id, check, () => "this row was not matched to an assertion by the generator — it must be read and implemented, not skipped");
}
console.log(`  (NEW B–H: ${built} of ${ROWS.length} rows generated from the ledger)`);
