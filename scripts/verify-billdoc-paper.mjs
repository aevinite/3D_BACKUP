// verify-billdoc-paper.mjs — the printed paper reads the SAME on every device, and its rows
// describe the rupees printed beside them.
//
//   node scripts/verify-billdoc-paper.mjs
//
// WHY THIS EXISTS (T8 sweep, 2026-08-17). verify-print-format.mjs already proves there is ONE
// description of each document and that the money adds up. It cannot see the fault class that keeps
// coming back instead: a document that renders correctly HERE and differently on the machine that
// actually prints it, because a date, a time or a day was left to the device's own locale and time
// zone. That has now been fixed three times in three places —
//
//   · the thermal bill's date row      2026-08-05 (T15)  — a US-locale tablet printed 8/5/2026
//   · the banquet sheet's date + time  2026-08-06        — one invoice, two dates, two devices
//   · the kitchen ticket's time + day  2026-08-17 (T8)   — four devices, four times, three days
//
// — and nothing guarded any of them, which is why the third one survived two later sweeps. This
// file re-renders every document with the process pinned to four different time zones and asserts
// the output is byte-identical. It is static: no database, no login, no browser, no dev server.
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const BILLDOC = require(join(ROOT, "public/panels/billdoc.js"));

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m, detail) => { fails++; console.log(`  FAIL ${m}`); if (detail) console.log(`         ${detail}`); };

// ── 1. ONE CLOCK, EVERY DEVICE ────────────────────────────────────────────────────────────────
// Re-run a tiny renderer in a child process with TZ (and the locale) forced, and compare the
// strings. TZ is the only honest way to test this — Intl reads it once per process.
const ZONES = ["Asia/Kolkata", "America/New_York", "Europe/London", "Australia/Sydney", "UTC"];
const PROBE = `
const B = require(${JSON.stringify(join(ROOT, "public/panels/billdoc.js"))});
const ts = process.argv[1];
const orders = [{ status: "served", subtotal: 100, taxable_base: 100, nontax_amount: 0, discount: 0,
  tax_rate: 0.05, items: [{ title: "A", qty: 1, price: 100, tax_mode: "excl" }] }];
const bill = B.billData({ settings: {}, restaurant: { slug: "x" }, orders, tableDisp: "5",
  session: { bill_no: 7, invoice_no: 41, invoice_at: ts, closed_at: ts } });
const bq = B.banquetDocHtml({ bill: { bill_no: "B1", issued_at: ts, subtotal: 100, total: 100 },
  lines: [], settings: {}, restaurant: {}, autoPrint: false });
console.log(JSON.stringify({
  kot: B.kotWhen(ts),
  billDate: bill.dateStr,
  invNo: bill.invNo,
  bqDate: (bq.match(/Dated<\\/div><div class="v">([^<]*)/) || [])[1],
  bqTime: (bq.match(/Time<\\/div><div class="v">([^<]*)/) || [])[1],
}));
`;
// Three instants that each catch a different half of the fault: an evening service, a past-midnight
// one (the 05:00 business-day rollover), and one straddling the UTC date line.
const INSTANTS = [
  ["an evening service", "2026-08-16T16:01:00Z"],   // 21:31 IST
  ["past midnight", "2026-08-16T20:20:00Z"],        // 01:50 IST the next day, same business day
  ["across the UTC date line", "2026-08-16T19:00:00Z"], // 00:30 IST the next day
  // THE FINANCIAL-YEAR BOUNDARY, both sides of it (T8 sweep #7, 2026-08-22). The three instants
  // above are all mid-August, so they could never see the one part of this document that was
  // still on device time: the FY inside the invoice number. 31 March / 1 April is the single most
  // consequential date in Indian accounting, and IST runs +05:30, so every device behind India
  // reads the PREVIOUS financial year for the first five and a half hours of the new one.
  ["the last hour of the financial year", "2026-03-31T17:30:00Z"], // 23:00 IST, 31 March
  ["the first hour of the financial year", "2026-03-31T19:30:00Z"], // 01:00 IST, 1 April
];
for (const [what, ts] of INSTANTS) {
  const seen = new Map();
  for (const tz of ZONES) {
    let out;
    try {
      out = execFileSync(process.execPath, ["-e", PROBE, ts], {
        env: { ...process.env, TZ: tz, LC_ALL: "en_US.UTF-8", LANG: "en_US.UTF-8" },
        encoding: "utf8",
      }).trim();
    } catch (e) { bad(`the document could not render under TZ=${tz}`, String(e).slice(0, 200)); continue; }
    seen.set(tz, out);
  }
  const values = [...new Set(seen.values())];
  if (values.length === 1) ok(`${what}: the bill, the ticket and the banquet sheet read identically in all ${ZONES.length} time zones`);
  else {
    bad(`${what}: the same order prints differently on different devices`,
      [...seen].map(([tz, v]) => `${tz} → ${v}`).join("\n         ")
      + "\n         pin every date/time to en-IN + Asia/Kolkata, as billData's dateStr already is");
  }
}

// ── 1b. THE FINANCIAL YEAR IS INDIA'S ────────────────────────────────────────────────────────
// `financialYear` decides the FY inside every invoice number. It read the DEVICE's calendar until
// 2026-08-22, so one sale issued at 01:00 IST on 1 April printed INV/2026-27/… in India and
// INV/2025-26/… on every device behind it — two numbers for one tax document, on a sheet whose
// date row already said 01/04/2026. Asserted here by name so a failure says which rule broke.
{
  const cases = [
    ["23:00 IST on 31 March", "2026-03-31T17:30:00Z", "2025-26"],
    ["01:00 IST on 1 April", "2026-03-31T19:30:00Z", "2026-27"],
    ["a bare date, 31 March", "2026-03-31", "2025-26"],
    ["a bare date, 1 April", "2026-04-01", "2026-27"],
    ["mid-year", "2026-08-16T16:01:00Z", "2026-27"],
  ];
  for (const [what, ts, want] of cases) {
    const got = BILLDOC.financialYear(ts);
    got === want
      ? ok(`the financial year of ${what} is ${want}, in India's calendar`)
      : bad(`the financial year of ${what} came out ${got}, not ${want}`,
        "derive it in Asia/Kolkata — the FY is part of the number that identifies the tax document");
  }
  // and the number it builds carries that year
  BILLDOC.invFmt(41, "2026-03-31T19:30:00Z", "INV") === "INV/2026-27/000041"
    ? ok("the invoice number carries India's financial year across the boundary")
    : bad(`invFmt at 01:00 IST on 1 April read ${BILLDOC.invFmt(41, "2026-03-31T19:30:00Z", "INV")}`,
      "one sale may not have two invoice numbers depending on which tablet printed it");
}

// ── 2. THE KITCHEN TICKET USES THE RESTAURANT'S DAY, NOT THE CALENDAR'S ───────────────────────
// "Today" rolls over at 05:00 IST everywhere else in this product (mig 044, lib/businessDay.ts,
// docs/NUMBERING.md). A ticket rung at 23:50 and reprinted at 00:10 of the SAME rush read
// "YESTERDAY" while the board, the bill and the Z-report all still said today.
{
  const bkey = (ms) => new Date(ms + 30 * 60000).toISOString().slice(0, 10);
  const now = Date.now();
  // An instant inside the CURRENT business day but on the previous calendar date, if there is one.
  const IST = (ms) => new Date(ms + 330 * 60000).toISOString();
  const istHour = Number(IST(now).slice(11, 13));
  if (istHour >= 5 && istHour < 24) {
    // We are after today's 05:00 rollover: 00:30 IST today is the same business day, a calendar day back.
    const midnightish = now - (istHour * 3600_000) - (30 * 60000);
    if (bkey(midnightish) === bkey(now)) {
      const s = BILLDOC.kotWhen(new Date(midnightish).toISOString());
      /YESTERDAY/.test(s)
        ? bad("a ticket from the same business day is branded YESTERDAY", `got "${s}" — use the 05:00 IST business day, not the calendar date`)
        : ok("a past-midnight ticket from the SAME business day prints as today");
    } else ok("a past-midnight ticket from the same business day prints as today (no case to build right now)");
  } else ok("skipped the past-midnight case — the clock is inside 00:00–05:00 IST, where it cannot be built");
  // And something genuinely old still says so.
  const old = BILLDOC.kotWhen(new Date(now - 5 * 86400000).toISOString());
  /^\d{1,2} [A-Z]{3} /.test(old)
    ? ok("a five-day-old ticket still names its date")
    : bad(`a five-day-old ticket printed "${old}"`, "an old ticket must say so — that is what this function exists for");
  const yday = BILLDOC.kotWhen(new Date(now - 86400000).toISOString());
  /^YESTERDAY /.test(yday)
    ? ok("yesterday's ticket says YESTERDAY")
    : bad(`yesterday's ticket printed "${yday}"`, "expected the YESTERDAY prefix");
  for (const junk of [null, "", "garbage", 0, undefined]) {
    if (BILLDOC.kotWhen(junk) !== "") { bad(`kotWhen(${JSON.stringify(junk)}) is not ""`, "a ticket must never print Invalid Date"); break; }
  }
  ok("a missing or unparseable time prints nothing, never \"Invalid Date\"");
}

// ── 3. THE PRINTED PERCENTAGE DESCRIBES THE PRINTED RUPEES ────────────────────────────────────
// billRows() clamps a discount bigger than the row it comes off (2026-08-06) so no negative
// "Taxable value" reaches a guest. The LABEL was left as the caller's own string, so the paper read
// "Discount (150%) − ₹100" — a percentage nobody was given, beside the amount actually deducted.
{
  const label = (d) => (BILLDOC.billDocHtml(d).match(/<span>Discount \(([^)]*)\)<\/span><span>([^<]*)</) || []).slice(1);
  const clamped = label({ name: "T", lines: [{ title: "A", qty: 1, price: 100 }], subtotal: 100, discount: 150,
    discLabel: BILLDOC.discPct(100, 150), total: 0, taxRows: [], tableDisp: "1", dateStr: "x" });
  clamped[0] === "100%"
    ? ok("a clamped discount is worded from what the paper actually deducted (100%)")
    : bad(`a clamped discount printed "(${clamped[0]}) ${clamped[1]}"`, "the percentage and the rupees must describe the same deduction");
  const plain = label({ name: "T", lines: [{ title: "A", qty: 1, price: 1000 }], subtotal: 1000, discount: 100,
    discLabel: "10%", total: 900, taxRows: [], tableDisp: "1", dateStr: "x" });
  plain[0] === "10%"
    ? ok("an ordinary discount keeps the caller's own label untouched")
    : bad(`an ordinary discount was re-worded to "${plain[0]}"`, "the re-wording must only happen when the clamp bites");
}

// ── 3b. AN MRP LINE IS COUNTED ONCE ───────────────────────────────────────────────────────────
// A sealed bottle sold at its printed price is outside the taxable base, and the tax inside its
// price is the manufacturer's. An MRP line whose tax_mode is "incl" is not "exempt", so it used to
// be counted BOTH as a taxed item row and again as the "MRP items" row — and a "Round off" of −₹40
// on a ₹462 bill silently absorbed the difference. The money charged was right; every row
// explaining it was wrong. These replay the paper and add the rows up the way a guest does.
{
  const S = { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }], mrp_tax_treatment: "inclusive" };
  const cases = [
    ["MRP priced tax-inclusive", { subtotal: 442, taxable_base: 400, nontax_amount: 42, mrp_amount: 42, discount: 0, tax_rate: 0.05,
      items: [{ title: "Dal", qty: 1, price: 400, tax_mode: "excl" }, { title: "Water", qty: 2, price: 21, is_mrp: true, tax_mode: "incl" }] }, S],
    ["MRP priced tax-inclusive, discounted", { subtotal: 442, taxable_base: 400, nontax_amount: 42, mrp_amount: 42, discount: 100, tax_rate: 0.05,
      items: [{ title: "Dal", qty: 1, price: 400, tax_mode: "excl" }, { title: "Water", qty: 2, price: 21, is_mrp: true, tax_mode: "incl" }] }, S],
    ["MRP treated as exempt", { subtotal: 440, taxable_base: 400, nontax_amount: 40, mrp_amount: 40, discount: 0, tax_rate: 0.05,
      items: [{ title: "Dal", qty: 1, price: 400, tax_mode: "excl" }, { title: "Water", qty: 2, price: 20, is_mrp: true, tax_mode: "exempt" }] }, { ...S, mrp_tax_treatment: "none" }],
  ];
  for (const [what, order, settings] of cases) {
    const os = [{ status: "served", ...order }];
    const d = BILLDOC.billData({ settings, restaurant: {}, orders: os, session: {} });
    const R = BILLDOC.billRows(d);
    const itemCol = order.items.reduce((a, i) => a + i.price * Math.max(1, i.qty || 1), 0);
    const money = BILLDOC.billMoney(os, settings);
    const foots = R.subtotal - R.discount + R.tax + R.nontax + R.roundOff === R.total;
    const counted = R.subtotal + R.nontax === itemCol;
    const sane = Math.abs(R.roundOff) <= 2;
    const charged = R.total === Math.round(money.total);
    (foots && counted && sane && charged)
      ? ok(`${what}: the item column (${itemCol}) is the subtotal (${R.subtotal}) plus the MRP row (${R.nontax}), it foots to ₹${R.total}, and the round-off is ₹${R.roundOff}`)
      : bad(`${what}: subtotal ${R.subtotal} + MRP ${R.nontax} vs item column ${itemCol}, round-off ${R.roundOff}, total ${R.total} vs charged ${money.total}`,
        "an MRP line belongs in exactly one row — counting it twice needs a fake round-off to hide");
  }
}

// ── 3e. THE BANQUET SHEET PRINTS NO NEGATIVE MONEY ────────────────────────────────────────────
// The thermal bill has forbidden a negative taxable value since 2026-08-06 (the clamp in
// billRows). The banquet sheet — the product's largest-value document — allocated its per-line
// taxable and tax columns by giving the LAST line the whole difference against the stored bill,
// so whenever the lines added to MORE than the bill (the exact case that absorption exists for:
// "a line edited after the bill was saved, or a line missing from the fetch") the last line went
// past zero and a real A5 printed "Stage decoration  1  28,800.00  -691.63  18.00%  -124.50".
// A negative line on a tax invoice reads as a refund nobody gave.
// Both properties are asserted together, because they pull against each other: the columns must
// still FOOT to their TOTAL row (T7's I8, which is what the absorption bought) AND no cell may
// print negative.
{
  const SET = { tax_components: [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }] };
  const shapes = [
    ["a line missing from the fetch", { subtotal: 216000, discount: 16000, tax: 36000, total: 236000 },
      [{ title: "Thali", qty: 180, price: 900 }, { title: "Live counter", qty: 1, price: 24000 },
       { title: "Welcome drinks", qty: 240, price: 120 }, { title: "Stage decoration", qty: 1, price: 28800 }]],
    ["a small gap with a cheap last line", { subtotal: 100000, discount: 0, tax: 18000, total: 118000 },
      [{ title: "Hall", qty: 1, price: 101000 }, { title: "Welcome gift", qty: 1, price: 100 }]],
    ["lines adding to LESS than the bill", { subtotal: 2000, discount: 0, tax: 360, total: 2360 },
      [{ title: "A", qty: 1, price: 600 }, { title: "B", qty: 1, price: 400 }]],
    ["lines that match the bill (every sheet today)", { subtotal: 1000, discount: 0, tax: 180, total: 1180 },
      [{ title: "A", qty: 1, price: 600 }, { title: "B", qty: 1, price: 400 }]],
    ["every line at zero", { subtotal: 0, discount: 0, tax: 0, total: 0 },
      [{ title: "A", qty: 1, price: 0 }, { title: "B", qty: 1, price: 0 }]],
  ];
  for (const [what, bill, lines] of shapes) {
    const html = BILLDOC.banquetDocHtml({ bill: { bill_no: "BQ", ...bill }, lines,
      settings: SET, restaurant: {}, autoPrint: false });
    const body = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
    const trs = body.split("</tr>").filter((r) => r.includes("<td"));
    const nums = (r) => [...r.matchAll(/<td class="r">(-?[\d,.]+)<\/td>/g)].map((m) => Number(m[1].replace(/,/g, "")));
    const data = trs.filter((r) => !r.includes('class="tot"') && nums(r).length >= 3).map(nums);
    const tot = nums(trs.find((r) => r.includes('class="tot"')) || "");
    const neg = [].concat(...data).filter((n) => n < 0);
    let drift = null;
    for (let c = 0; c < tot.length && drift === null; c++) {
      const sum = Math.round(data.reduce((a, r) => a + (r[c + 1] || 0), 0) * 100) / 100;
      if (Math.abs(sum - tot[c]) > 0.011) drift = `column ${c} adds to ${sum} under a TOTAL row of ${tot[c]}`;
    }
    if (neg.length) bad(`${what}: the banquet sheet printed negative money (${neg.join(", ")})`,
      "absorb a shortfall backwards, taking from each line only what it holds — a negative line reads as a refund nobody gave");
    else if (drift) bad(`${what}: ${drift}`,
      "the in-table TOTAL row is the proof the per-line columns add up — it must stay true (T7 I8)");
    else if (!data.length) bad(`${what}: no item rows rendered`, "the sheet must list its lines");
    else ok(`${what}: every column foots to its TOTAL row and no cell is negative`);
  }
}

// ── 3i. A FIELD OF SPACES IS EMPTY, AND NO MONEY BOX GOES BELOW ZERO ──────────────────────────
// Two rules this file states about itself, each defeated by one value:
//  · "empty prints NO line at all" / "NEVER fall back to a placeholder GSTIN" — beaten by a single
//    typed space, because `s.x || fallback` treats "  " as real. A Billing card of spaces printed a
//    blank restaurant name, a bare "Ph" and a bare "GSTIN" with nothing after it.
//  · "THE PAPER NEVER PRINTS A NEGATIVE TAXABLE VALUE" (2026-08-06) — billRows clamped a discount
//    bigger than its row but not a NEGATIVE one, and never floored the taxable value, while
//    billMoney in this same file has always ended `taxable: Math.max(0, ...)`.
{
  const ws = BILLDOC.billIdentity({ gstin: "   ", restaurant_address: "  ", restaurant_phone: " ",
    restaurant_name: "  ", invoice_prefix: " ", bill_footer: "  " }, { slug: "x", name: { en: "Green Bowl" } });
  (ws.gstin === "" && ws.address === "" && ws.phone === "" && ws.name === "Green Bowl" && ws.prefix === "INV")
    ? ok("a Billing card of spaces prints no address, no phone and no GSTIN line")
    : bad(`whitespace fields survived: ${JSON.stringify(ws)}`,
      "trim in billIdentity — a 'GSTIN' label with nothing after it is the placeholder this file refuses to print");
  const real = BILLDOC.billIdentity({ gstin: "24ABCDE1234F1Z5", restaurant_address: "12 Rue Verte",
    restaurant_phone: "+91 90999 14418", restaurant_name: "Little French House" }, { slug: "french-house" });
  (real.gstin === "24ABCDE1234F1Z5" && real.address === "12 Rue Verte" && real.name === "Little French House")
    ? ok("  …and a filled-in Billing card is untouched")
    : bad(`a real identity changed: ${JSON.stringify(real)}`, "the trim must only remove whitespace");
  const shapes = [
    ["a negative discount", { subtotal: 100, discount: -50, total: 105 }],
    ["a discount bigger than its row", { subtotal: 100, discount: 150, total: 0 }],
    ["an untaxed pile bigger than the subtotal", { subtotal: 100, nontax: 400, total: 105 }],
    ["a negative untaxed pile", { subtotal: 100, nontax: -40, total: 105 }],
    ["a negative subtotal", { subtotal: -100, total: -100 }],
    ["everything null", { subtotal: null, discount: null, nontax: null, total: null }],
  ];
  let bads = [];
  for (const [what, d] of shapes) {
    const R = BILLDOC.billRows(d);
    if (R.discount < 0) bads.push(`${what}: discount ${R.discount}`);
    if (R.taxable < 0) bads.push(`${what}: taxable ${R.taxable}`);
    if (R.nontax < 0) bads.push(`${what}: untaxed pile ${R.nontax}`);
    if (R.nontax > Math.max(0, R.subtotal + R.nontax)) bads.push(`${what}: untaxed pile exceeds the bill`);
  }
  bads.length === 0
    ? ok(`no money box goes below zero on any of the ${shapes.length} contradictory shapes`)
    : bad(`a negative figure reached a labelled money box: ${bads.join(" · ")}`,
      "billRows must floor the discount and the taxable value, as billMoney already does");
  // and the label, the MRP row and the arithmetic must all read ONE decision about the pile
  const split = BILLDOC.billRows({ subtotal: 442, nontax: 42, total: 462 });
  const dropped = BILLDOC.billRows({ subtotal: 100, nontax: 400, total: 105 });
  const html = BILLDOC.billDocHtml({ name: "R", lines: [{ title: "A", qty: 1, price: 100 }],
    subtotal: 100, nontax: 400, total: 105, taxRows: [], tableDisp: "5", dateStr: "x" });
  (split.nontax === 42 && dropped.nontax === 0 && /<span>Subtotal<\/span>/.test(html) && !/MRP items/.test(html))
    ? ok("  …and the label, the MRP row and the arithmetic read ONE decision about the untaxed pile")
    : bad("the label and the arithmetic disagree about the untaxed pile",
      "billDocHtml must read R.nontax, not re-derive d.nontax — two reads is how they drift");
}

// ── 3c. THE BILL NEVER SAYS IT IS A SECOND COPY — THE TICKET ALWAYS DOES ──────────────────────
// REJECTED (owner, 2026-08-19): a bill band existed 2026-08-17 → 2026-08-19 and he removed it —
// "I don't even want the reprinted bill shown in the bill … make the guard also in code like never
// change that to reprint thing". A guest asking for their bill again is service, not an incident.
// R37 in docs/REJECTED-IDEAS.md.
// The KITCHEN TICKET keeps its banner (owner, 2026-08-04, re-confirmed 2026-08-19 — "bill only,
// keep kot banner"): a cook who mistakes a duplicate for a fresh order cooks the food twice.
// The deeper guard, including the panels and the Audit, is scripts/verify-bill-reprint-is-silent.mjs.
{
  const S = { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }] };
  const os = [{ status: "served", subtotal: 620, taxable_base: 620, nontax_amount: 0, discount: 0, tax_rate: 0.05,
    items: [{ title: "A", qty: 2, price: 310, tax_mode: "excl" }] }];
  const mk = (a) => BILLDOC.billDocHtml(BILLDOC.billData({ settings: S, restaurant: {}, orders: os, session: { bill_no: 41 }, autoPrint: false, ...a }));
  const bands = (h) => [...h.matchAll(/<div class="vband">([^<]*)</g)].map((m) => m[1]);
  bands(mk({})).length === 0
    ? ok("a bill carries no duplicate band")
    : bad("a bill is branded a duplicate", "the owner removed this on 2026-08-19 — a reprint of a bill is not an event");
  // …and it stays silent even if a caller insists, so a stray `reprint: true` left in a panel
  // can never put the word back on a guest's bill.
  !/reprint/i.test(mk({ reprint: true }))
    ? ok("  …even when a caller passes reprint:true — the bill has no such flag any more")
    : bad("a reprint flag still reaches the bill sheet", "billdoc.js must ignore it entirely; see the REJECTED note there");
  // and the KOT's own banner still works, both ways
  /class="rp"/.test(BILLDOC.kotDocHtml({ rname: "R", kot: 1, lines: [], reprint: true }))
    && !/class="rp"/.test(BILLDOC.kotDocHtml({ rname: "R", kot: 1, lines: [] }))
    ? ok("the kitchen ticket still brands a reprint, and only a reprint")
    : bad("the ticket's duplicate banner regressed", "the KOT banner is the one he kept");
}

// ── 3f. WHAT THE SHEET CALLS ITSELF ───────────────────────────────────────────────────────────
// A tax invoice must carry the supplier's GSTIN (CGST Rule 46(b)/(c); the one-liner in
// docs/COMPLIANCE-GUARDRAILS.md is "Real GSTIN on any tax invoice"). billIdentity() has refused to
// invent one since 2026-08-04 — an unconfigured restaurant prints no GSTIN line — but the HEADING
// kept saying TAX INVOICE anyway, so the sheet claimed to be the one thing it could not be.
// Measured 2026-08-22: 16 of 17 dev restaurants have no GSTIN, the flagship included.
// Also pinned the other way: a restaurant that HAS filled its GSTIN in must be unchanged.
{
  const SET = { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }] };
  const os = [{ status: "served", subtotal: 250, taxable_base: 250, nontax_amount: 0, discount: 0,
    tax_rate: 0.05, items: [{ title: "Salad", qty: 1, price: 250, tax_mode: "excl" }] }];
  const head = (settings, orders) => {
    const html = BILLDOC.billDocHtml(BILLDOC.billData({ settings, restaurant: {},
      session: { bill_no: 3 }, autoPrint: false, orders: orders || os }));
    return [(html.match(/<div class="kind">([^<]*)/) || [])[1],
      (html.match(/<title>([^—]*)/) || [])[1].trim()];
  };
  const cases = [
    ["a restaurant with a GSTIN", { ...SET, gstin: "24ABCDE1234F1Z5" }, null, "Tax Invoice"],
    ["a restaurant with NO GSTIN", { ...SET }, null, "Bill"],
    ["a GSTIN of only spaces", { ...SET, gstin: "   " }, null, "Bill"],
    ["a composition restaurant", { ...SET, price_tax_mode: "composition" }, null, "Bill of Supply"],
    ["a cancelled sale", { ...SET, gstin: "24ABCDE1234F1Z5" },
      [{ ...os[0], status: "cancelled" }], "Cancelled Bill"],
  ];
  for (const [what, settings, orders, want] of cases) {
    const [kind, title] = head(settings, orders);
    (kind === want && title === want)
      ? ok(`${what} hands over a "${want}", in the heading and the tab title`)
      : bad(`${what} is headed "${kind}" (tab "${title}"), not "${want}"`,
        "a sheet with no GSTIN on it cannot be a tax invoice — and one WITH a GSTIN must not change");
  }
}

// ── 3d. THE BILL CARRIES NO VERIFICATION LINE, EVER (R50) ─────────────────────────────────────
// REJECTED (owner, 2026-08-28): "DON'T DO 19TH ONE." It was built on 2026-08-17 off his own "do
// both 11 and 12", wired to the data on 2026-08-28, and rendered side by side against a normal bill
// so he could see exactly what it added — one line reading `Verification 1042 · a3f9c1d2e4b5` under
// the total. He looked at it and said no, for the same reason that removed the "Reprint · Duplicate"
// band eleven days earlier (R37): a guest's copy of their own bill does not carry extra marks.
// The tamper-evident chain (migration 332) is UNAFFECTED and still runs on every issued bill. It
// simply stays in the records and is never printed.
// This guard pins it OFF in every shape a caller could reach for, including a caller that insists.
{
  const S = { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }], gstin: "24X" };
  const line = { status: "served", subtotal: 100, taxable_base: 100, nontax_amount: 0, discount: 0,
    tax_rate: 0.05, items: [{ title: "A", qty: 1, price: 100, tax_mode: "excl" }] };
  const mk = (a) => BILLDOC.billDocHtml(BILLDOC.billData({ settings: S, restaurant: {},
    autoPrint: false, orders: [line], ...a }));
  const shapes = [
    ["the reference on the session", mk({ session: { bill_no: 1, chain_seq: 7, chain_hash: "deadbeefcafe" } })],
    ["the reference on the order rows", mk({ session: { bill_no: 1 },
      orders: [{ ...line, chain_seq: 1042, chain_hash: "a3f9c1d2e4b5" }] })],
    ["a caller passing chainOnPaper: true", mk({ session: { bill_no: 1, chain_seq: 7, chain_hash: "deadbeefcafe" },
      chainOnPaper: true })],
    ["billDocHtml handed the fields directly", BILLDOC.billDocHtml({ name: "R", taxRows: [],
      lines: [{ title: "A", qty: 1, price: 100 }], subtotal: 100, total: 100,
      chainSeq: 1042, chainHash: "a3f9c1d2e4b5" })],
    ["an ordinary bill", mk({ session: { bill_no: 1 } })],
  ];
  const stray = shapes.filter(([, html]) => /Verification/.test(html)).map(([w]) => w);
  stray.length === 0
    ? ok("no verification line reaches a guest's bill, in any shape a caller could ask for (R50)")
    : bad(`a verification line printed: ${stray.join(", ")}`,
      "he said don't do it — a guest's copy of their own bill carries no extra marks (R50, same reason as R37)");
  // …and billData exposes no such field at all, so a panel cannot pass one on by accident
  const d = BILLDOC.billData({ settings: S, restaurant: {},
    session: { bill_no: 1, chain_seq: 7, chain_hash: "x" }, orders: [line] });
  const fields = Object.keys(d).filter((k) => /chain/i.test(k));
  fields.length === 0
    ? ok("  …and bill data carries no chain field at all, so nothing can pass one on")
    : bad(`bill data still exposes: ${fields.join(", ")}`,
      "a field that silently does nothing is how the line gets drawn again — remove it, do not leave it half-alive");
  // the bill still prints everything it should
  /TOTAL/.test(shapes[4][1]) && /class="foot"/.test(shapes[4][1])
    ? ok("  …and an ordinary bill is otherwise unchanged")
    : bad("removing the line changed the rest of the bill", "only that line was meant to go");
}

// ── 3g. THE DIGIT COUNTER NEVER CONTRADICTS THE BOX BESIDE IT ─────────────────────────────────
// "0/10" beside a complete number is the sheet giving two answers at once, and at a till the honest
// reading of it is "retype it". paintCount() only ran on the `input` event, and assigning `.value`
// from script fires none — so a reopened bill opened showing "0/10" against "98250 12345", and
// tapping a suggestion showed "5/10". Structural, so a THIRD write path cannot miss it.
{
  const { readFileSync: rf } = await import("node:fs");
  const cust = rf(join(ROOT, "public/panels/billcustomer.js"), "utf8");
  const lines = cust.split("\n");
  const offenders = [];
  lines.forEach((ln, i) => {
    if (!/\bphoneEl\.value\s*=[^=]/.test(ln)) return;
    if (/const setPhone\s*=/.test(ln)) return;
    const next = (lines[i + 1] || "") + (lines[i + 2] || "");
    if (!/paintCount\(\)/.test(next)) offenders.push(`line ${i + 1}: ${ln.trim().slice(0, 70)}`);
  });
  offenders.length === 0
    ? ok("every write to the mobile box repaints the digit counter")
    : bad(`a write to the mobile box leaves the counter stale: ${offenders.join(" · ")}`,
      "go through setPhone(), or call paintCount() straight after — a counter that contradicts the box reads as 'retype it'");
  /const setPhone = \(v\) => \{ phoneEl\.value = v; paintCount\(\); \}/.test(cust)
    ? ok("  …and setPhone() is the one door that does it")
    : bad("setPhone() is gone or no longer repaints", "one door, so a new call site cannot forget");
}

// ── 3h. NO DOCUMENT PRINTS "Invalid Date" ─────────────────────────────────────────────────────
// The ticket has refused since it was written and the thermal bill since 2026-08-05. The banquet
// sheet guarded none of its THREE date fields, so it printed `Dated  Invalid Date` — the field that
// decides which GST period a sale falls in. Reachable through the DATA: `banquet_bills.advances` is
// JSONB and migrations 237/239 store the date with NO cast.
{
  const base = { bill_no: "BQ/2026/014", subtotal: 1000, tax: 180, total: 1180 };
  const JUNK = ["garbage", {}, "", "2026-13-45", null, 0, NaN, undefined, [], "n/a"];
  let bad_ = 0, lost = 0;
  for (const j of JUNK) {
    const sheets = [
      ["issued_at", { ...base, issued_at: j }],
      ["fn_date", { ...base, issued_at: "2026-08-16T16:01:00Z", fn_date: j, func: "Reception" }],
      ["an advance's date", { ...base, issued_at: "2026-08-16T16:01:00Z", advances: [{ amt: 500, mode: "upi", date: j }] }],
    ];
    for (const [field, bill] of sheets) {
      const html = BILLDOC.banquetDocHtml({ bill, lines: [{ title: "A", qty: 1, price: 1000 }],
        settings: {}, restaurant: {}, autoPrint: false });
      if (/Invalid Date|NaN/.test(html)) { bad_++; if (bad_ === 1) bad(`the banquet sheet printed Invalid Date for ${field} = ${JSON.stringify(j)}`, "guard every date read, as the bill and the ticket already do — a missing date prints NOTHING, never a lie"); }
      if (field === "an advance's date" && !/500\//.test(html)) { lost++; if (lost === 1) bad(`an advance's amount vanished with its date (${JSON.stringify(j)})`, "drop the date, never the rupees"); }
    }
  }
  if (!bad_ && !lost) ok(`all ${JUNK.length * 3} junk-date cases print no "Invalid Date", and every advance keeps its money`);
  const good = BILLDOC.banquetDocHtml({ bill: { ...base, issued_at: "2026-08-16T16:01:00Z",
    fn_date: "2026-09-14", func: "Reception", fn_from: "7pm", advances: [{ amt: 500, mode: "upi", date: "2026-08-01" }] },
    lines: [{ title: "A", qty: 1, price: 1000 }], settings: {}, restaurant: {}, autoPrint: false });
  /* ⚠️ THIS PINNED THE INCONSISTENCY IT WAS MEANT TO IGNORE (2026-09-04). It required the three dates
     LITERALLY — "Dated 16-08-2026" with dashes, "DT.01/08/2026" and "14/09/2026" with slashes — which
     is two date formats on one sheet, frozen in place by the guard that was only ever supposed to
     prove a VALID date still prints (see its own old failure line: "the guard must only bite on an
     unparseable value"). The owner asked for one format on 2026-09-04, and this went red on the fix.
     So it asserts the rule instead: all three dates appear, and they all punctuate the same way. */
  const dSep = (good.match(/Dated<\/div><div class="v">(\d{2})([-/])(\d{2})\2(\d{4})/) || [])[2];
  const three = [
    ["the invoice date",  /Dated<\/div><div class="v">16[-/]08[-/]2026/],
    ["the advance date",  /UPI PAY DT\.01[-/]08[-/]2026/],
    ["the function date", /Function: Reception · 14[-/]09[-/]2026 7pm/],
  ].filter(([, re]) => !re.test(good)).map(([w]) => w);
  const seps = [...good.matchAll(/\b\d{2}([-/])\d{2}\1\d{4}\b/g)].map((m) => m[1]);
  const mixed = [...new Set(seps)];
  if (three.length) bad("a good banquet sheet lost a date", `missing: ${three.join(", ")} — the guard must only bite on an unparseable value`);
  else if (mixed.length > 1) bad("the banquet sheet prints two date formats", `it used ${JSON.stringify(mixed)} on one sheet — dashes in one place and slashes in another, on the largest-value document this product prints`);
  else ok(`  …and a sheet with real dates prints all three, all punctuated "${dSep || mixed[0]}"`);
}

// ── 3j. TWO PLACES, TWO DEFAULT WORDS, ONE SETTING ────────────────────────────────────────────
// Owner, 2026-08-28: the PRINTED bill says GST (it sits beside CGST/SGST and is read by a customer
// and an inspector); a STAFF PANEL says just "Tax". One setting — a restaurant's own word wins on
// both; only the fallback differs. NOTHING may prefill either default into settings.tax_label: the
// Settings form used to write the SCREEN's word in, so saving it made the PAPER say "Tax".
{
  const { readFileSync: rf } = await import("node:fs");
  const cases = [
    ["a restaurant that has never set the word", {}, "GST", "Tax"],
    ["a word of only spaces", { tax_label: "   " }, "GST", "Tax"],
    ["a restaurant that typed VAT", { tax_label: "VAT" }, "VAT", "VAT"],
    ["a restaurant that typed GST itself", { tax_label: "GST" }, "GST", "GST"],
  ];
  const bads = [];
  for (const [what, settings, paper, screen] of cases) {
    const bi = BILLDOC.billIdentity(settings, {});
    if (bi.taxLabel !== paper) bads.push(`${what}: the PAPER says "${bi.taxLabel}", not "${paper}"`);
    if (bi.taxLabelScreen !== screen) bads.push(`${what}: the SCREEN says "${bi.taxLabelScreen}", not "${screen}"`);
  }
  bads.length === 0
    ? ok("the paper defaults to GST and a panel defaults to Tax — and a restaurant's own word wins on both")
    : bad(`the tax word is wrong somewhere: ${bads.join(" · ")}`,
      "billIdentity carries BOTH — taxLabel for the paper, taxLabelScreen for a panel");
  const mrpNote = (settings) => BILLDOC.billData({ settings: { ...settings, mrp_tax_treatment: "inclusive" },
    restaurant: {}, session: { bill_no: 1 }, autoPrint: false,
    orders: [{ status: "served", subtotal: 442, taxable_base: 400, nontax_amount: 42, mrp_amount: 42,
      discount: 0, tax_rate: 0.05, items: [{ title: "Dal", qty: 1, price: 400, tax_mode: "excl" },
        { title: "Water", qty: 2, price: 21, is_mrp: true, tax_mode: "incl" }] }] }).mrpNote;
  const bqWord = (settings) => {
    const html = BILLDOC.banquetDocHtml({ settings, restaurant: {}, autoPrint: false,
      bill: { bill_no: "B", subtotal: 1000, tax: 180, total: 1180, tax_lines: [] },
      lines: [{ title: "A", qty: 1, price: 1000 }] });
    return (html.match(/<span>([A-Za-z]+) 18%<\/span>/) || [])[1];
  };
  const surf = [];
  for (const [what, settings] of cases.map((c) => [c[0], c[1]])) {
    const want = BILLDOC.billIdentity(settings, {}).taxLabel;
    const note = mrpNote(settings), bq = bqWord(settings);
    if (!note.endsWith(" " + want)) surf.push(`${what}: the MRP note says "${note}", not "${want}"`);
    if (bq !== want) surf.push(`${what}: the banquet fallback says "${bq}", not "${want}"`);
  }
  surf.length === 0
    ? ok("  …and every generic tax word ON PAPER is that one word")
    : bad(`the paper's tax word differs by surface: ${surf.join(" · ")}`, "read bi.taxLabel everywhere on paper");
  const writers = [];
  for (const f of ["public/panels/editor/app.js", "components/admin/RestaurantSettings.tsx", "public/panels/tablet/app.js"]) {
    let src; try { src = rf(join(ROOT, f), "utf8"); } catch { continue; }
    for (const line of src.split("\n")) {
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
      if (/(s|draft|settings)\.tax_label\s*=(?!=)/.test(line)) writers.push(`${f}: ${line.trim().slice(0, 80)}`);
    }
  }
  writers.length === 0
    ? ok("  …and no panel or form writes a default back into settings.tax_label")
    : bad(`a default is being prefilled into settings.tax_label: ${writers.join(" · ")}`,
      "one setting with two right defaults only works while nothing saves either one — show it as a hint");
}

// ── 3k. ONE BAD LINE DOES NOT COST THE WHOLE PIECE OF PAPER ───────────────────────────────────
// A single null in a line list threw out of the render on ALL THREE documents, and they draw into a
// window.open — so a throw is a BLANK WINDOW and no paper at all. `items` is JSONB, so a null
// element is one database write away. Printing the other nine dishes beats printing nothing.
{
  const cases = [
    ["a ticket with a null among its lines", () => BILLDOC.kotDocHtml({ rname: "R", kot: 1,
      lines: [{ qty: 1, title: "Dal" }, null, { qty: 2, title: "Naan" }] }), /Dal/],
    ["a ticket of nothing but nulls", () => BILLDOC.kotDocHtml({ rname: "R", kot: 1, lines: [null, undefined] }), /\(no items\)/],
    ["kotLineHtml with no argument", () => BILLDOC.kotLineHtml(), /class="kl"/],
    ["banquetDocHtml with no argument", () => BILLDOC.banquetDocHtml(), /Tax Invoice/],
    ["a bill with a null among its lines", () => BILLDOC.billDocHtml({ name: "R", taxRows: [],
      lines: [null, { title: "Dal", qty: 1, price: 100 }], subtotal: 100, total: 100 }), /Dal/],
    ["a banquet sheet with a null line", () => BILLDOC.banquetDocHtml({ bill: { bill_no: "B", subtotal: 100, total: 100 },
      lines: [null, { title: "Hall", qty: 1, price: 100 }], settings: {}, restaurant: {} }), /Hall/],
    ["an ORDER carrying a null item", () => BILLDOC.billDocHtml(BILLDOC.billData({ settings: {}, restaurant: {},
      session: { bill_no: 1 }, orders: [{ status: "served", subtotal: 100, taxable_base: 100, tax_rate: 0.05,
        items: [null, { title: "Dal", qty: 1, price: 100 }] }] })), /Dal/],
  ];
  const bads = [];
  for (const [what, fn, want] of cases) {
    try { const html = fn(); if (!want.test(html)) bads.push(`${what}: rendered, but the good lines are missing`); }
    catch (e) { bads.push(`${what}: threw — ${e.message}`); }
  }
  bads.length === 0
    ? ok(`all ${cases.length} bad-line shapes still produce a document, with the good lines on it`)
    : bad(`a bad line stopped the paper: ${bads.join(" · ")}`,
      "drop empty entries — these render into a window.open, so a throw is a blank window and no paper");
  const threw = [];
  for (const [k, fn] of Object.entries(BILLDOC)) {
    if (typeof fn !== "function") continue;
    try { fn(); } catch (e) { threw.push(`${k}: ${e.message}`); }
  }
  threw.length === 0
    ? ok(`  …and all ${Object.keys(BILLDOC).length} entry points survive being called with nothing`)
    : bad(`an entry point throws on no argument: ${threw.join(" · ")}`, "every door on the public API defaults its argument");
}

// ── 3l. AN ALL-MRP BILL IS JUST A BILL ────────────────────────────────────────────────────────
// A shop whose whole sale is sealed products printed "Food subtotal ₹0" over "MRP items ₹42". The
// split says nothing when there is no food (owner, 2026-08-28). A bill with ANY food is untouched.
{
  const rowsOf = (d) => {
    const html = BILLDOC.billDocHtml({ name: "R", lines: [{ title: "A", qty: 1, price: 42 }],
      tableDisp: "5", dateStr: "x", ...d });
    const block = html.slice(html.indexOf('class="totals"'), html.indexOf(">TOTAL<"));
    return [...block.matchAll(/<div class="t[^"]*"><span>([^<]*)<\/span>/g)].map((m) => m[1]);
  };
  const only = rowsOf({ subtotal: 42, nontax: 42, total: 42, taxRows: [] });
  const mixed = rowsOf({ subtotal: 442, nontax: 42, total: 462,
    taxRows: [{ label: "CGST", rate: 2.5, amt: 10 }, { label: "SGST", rate: 2.5, amt: 10 }] });
  const none = rowsOf({ subtotal: 1240, nontax: 0, total: 1302,
    taxRows: [{ label: "CGST", rate: 2.5, amt: 31 }, { label: "SGST", rate: 2.5, amt: 31 }] });
  const bads = [];
  if (only.includes("Food subtotal") || only.includes("MRP items")) bads.push(`an all-sealed bill still splits: ${only.join(" / ")}`);
  if (!only.includes("Subtotal")) bads.push(`an all-sealed bill lost its Subtotal: ${only.join(" / ")}`);
  if (!mixed.includes("Food subtotal") || !mixed.includes("MRP items")) bads.push(`a mixed bill stopped splitting: ${mixed.join(" / ")}`);
  if (!none.includes("Subtotal") || none.includes("MRP items")) bads.push(`an ordinary bill changed: ${none.join(" / ")}`);
  for (const [what, d] of [["all sealed", { subtotal: 42, nontax: 42, total: 42, taxRows: [] }],
    ["mixed", { subtotal: 442, nontax: 42, total: 462, taxRows: [{ label: "C", rate: 2.5, amt: 10 }, { label: "S", rate: 2.5, amt: 10 }] }]]) {
    const R = BILLDOC.billRows(d);
    const base = R.disc > 0 ? R.taxable : R.subtotal;
    if (base + R.tax + R.nontax + R.roundOff !== R.total) bads.push(`${what} no longer foots`);
    if (Math.abs(R.roundOff) > 2) bads.push(`${what} needs a round-off of ${R.roundOff}`);
  }
  bads.length === 0
    ? ok("a bill of nothing but sealed goods reads as a plain Subtotal, and a mixed bill still splits")
    : bad(`the sealed-goods split is wrong: ${bads.join(" · ")}`, "drop the split only when there is no food at all");
}

// ── 3m. THE NUMBER ROW IS ALWAYS LABELLED "Invoice" (R49) ─────────────────────────────────────
// REJECTED (owner, 2026-08-28): "KEEP INVOICE". It was changed to "Serial no" on a composition Bill
// of Supply earlier that day — a composition dealer may not issue a tax invoice, and CGST Rule 49
// calls that number a serial number — and he looked at the sheet and said no. Everyone at the
// restaurant calls it the invoice number; a second name for one number teaches staff there are two
// things when there is one. The PREFIX is the knob he does own, so it is checked here too.
// Also pins item 14 option B: the note under the total carries NO rule of its own.
{
  const SET = { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }], gstin: "24ABCDE1234F1Z5" };
  const row = (extra, cancelled) => {
    const html = BILLDOC.billDocHtml(BILLDOC.billData({ settings: { ...SET, ...extra }, restaurant: {},
      autoPrint: false, session: { bill_no: 41, invoice_no: 118, invoice_at: "2026-08-16T16:01:00Z" },
      orders: [{ status: cancelled ? "cancelled" : "served", subtotal: 880, taxable_base: 880,
        nontax_amount: 0, discount: 0, tax_rate: extra.price_tax_mode === "composition" ? 0 : 0.05,
        items: [{ title: "Thali", qty: 4, price: 220 }] }] }));
    const m = html.match(/<div class="kv"><span>([^<]*)<\/span><b>([^<]*)<\/b>/);
    return { kind: (html.match(/<div class="kind">([^<]*)/) || [])[1], label: m && m[1], value: m && m[2] };
  };
  const cases = [
    ["an ordinary tax invoice", {}, false, "Tax Invoice"],
    ["a composition Bill of Supply", { price_tax_mode: "composition" }, false, "Bill of Supply"],
    ["a cancelled sale", {}, true, "Cancelled Bill"],
    ["a restaurant with no GSTIN", { gstin: "" }, false, "Bill"],
  ];
  const bads = [];
  for (const [what, extra, cancelled, kind] of cases) {
    const r = row(extra, cancelled);
    if (r.kind !== kind) bads.push(`${what}: headed "${r.kind}"`);
    if (r.label !== "Invoice") bads.push(`${what}: the number row says "${r.label}" — he said KEEP INVOICE (R49)`);
  }
  const own = row({ price_tax_mode: "composition", invoice_prefix: "BOS" }, false);
  if (!/^BOS\/\d{4}-\d{2}\/000118$/.test(own.value || "")) bads.push(`a chosen prefix did not reach the number: ${own.value}`);
  const plain = row({}, false);
  if (!/^INV\/\d{4}-\d{2}\/000118$/.test(plain.value || "")) bads.push(`the default prefix changed: ${plain.value}`);
  bads.length === 0
    ? ok('the number row says "Invoice" on every document (R49), and the restaurant\'s own prefix still reaches the number')
    : bad(`the invoice row changed: ${bads.join(" · ")}`,
      'he said KEEP INVOICE — the number gets no second name per document; the PREFIX is the knob he sets');
  const mrpHtml = BILLDOC.billDocHtml(BILLDOC.billData({ settings: { ...SET, mrp_tax_treatment: "inclusive" },
    restaurant: {}, autoPrint: false, session: { bill_no: 41 },
    orders: [{ status: "served", subtotal: 442, taxable_base: 400, nontax_amount: 42, mrp_amount: 42,
      discount: 0, tax_rate: 0.05, items: [{ title: "Dal", qty: 1, price: 400, tax_mode: "excl" },
        { title: "Water", qty: 2, price: 21, is_mrp: true, tax_mode: "incl" }] }] }));
  const note = (mrpHtml.match(/<div class="mini"[^>]*>[^<]*<\/div>/) || [])[0] || "";
  (/MRP items include/.test(note) && !/border-top/.test(note))
    ? ok("  …and the note under the total carries no rule of its own (item 14, option B — his choice)")
    : bad(`the note under the total reads ${note || "(missing)"}`,
      "he chose option B: no second rule 1.5mm under the TOTAL row's own border — it prints as a stutter");
}

// ── 3o. A DISCOUNT THAT ROUNDS AWAY TO NOTHING PRINTS NO ROW ──────────────────────────────────
// T11 sweep #8, 2026-09-04. The Discount row was drawn from the CALLER's raw figure while the
// rupees beside it come from billRows(), which rounds to whole rupees — so any discount under 50
// paise printed "Discount − ₹0" over "Taxable value ₹200" on a ₹200 bill, and lost its percentage
// too (the re-label fires and discPct() of zero is ""). Reachable from the discount modal's own 5%
// option: 5% of a ₹9 chai is ₹0.45. Same rule as §3l's all-sealed bill, in the owner's own words —
// "a zero in a labelled money box reads as a mistake even though the column adds up".
// Pinned in BOTH directions: the row must vanish under half a rupee AND must still be there at
// half a rupee and above, so this cannot be "fixed" into hiding a real discount.
{
  const rowsOf = (discount, total) => {
    const html = BILLDOC.billDocHtml({
      name: "R", lines: [{ title: "A", qty: 1, price: 200 }], tableDisp: "5", dateStr: "x",
      subtotal: 200, discount, discLabel: "0.2%", total,
      taxRows: [{ label: "CGST", rate: 2.5, amt: 5 }, { label: "SGST", rate: 2.5, amt: 5 }],
    });
    const block = html.slice(html.indexOf('class="totals"'), html.indexOf(">TOTAL<"));
    return [...block.matchAll(/<div class="t[^"]*"><span>([^<]*)<\/span><span>([^<]*)<\/span>/g)].map((m) => [m[1], m[2]]);
  };
  const label = (rows) => rows.map((r) => r[0]);
  const bads = [];
  for (const d of [0.01, 0.4, 0.49]) {
    const rows = rowsOf(d, 210 - d);
    if (label(rows).some((l) => /^Discount/.test(l))) bads.push(`a ₹${d} discount still prints a row: ${label(rows).join(" / ")}`);
    if (label(rows).includes("Taxable value")) bads.push(`a ₹${d} discount still restates the taxable value`);
    const zero = rows.find((r) => /^Discount/.test(r[0]) && /₹0\s*$/.test(r[1]));
    if (zero) bads.push(`a labelled money box deducts nothing: ${zero.join(" ")}`);
  }
  for (const d of [0.5, 0.6, 10]) {
    const rows = rowsOf(d, 210 - d);
    if (!label(rows).some((l) => /^Discount/.test(l))) bads.push(`a real ₹${d} discount lost its row: ${label(rows).join(" / ")}`);
    if (!label(rows).includes("Taxable value")) bads.push(`a real ₹${d} discount lost its Taxable value row`);
  }
  // …and the TOTAL is still passed straight through, which is what makes this safe to change.
  for (const d of [0, 0.4, 0.6, 10]) {
    const R = BILLDOC.billRows({ subtotal: 200, discount: d, total: 210 - d,
      taxRows: [{ label: "C", rate: 2.5, amt: 5 }, { label: "S", rate: 2.5, amt: 5 }] });
    if (R.total !== Math.round(210 - d)) bads.push(`a ₹${d} discount moved the TOTAL to ${R.total}`);
  }
  bads.length === 0
    ? ok("a discount under half a rupee prints no row at all, and a real one still prints both of its rows")
    : bad(`the sub-rupee discount row is wrong: ${bads.join(" · ")}`,
      "gate the Discount row on billRows()'s own whole-rupee figure, never on the caller's raw one");
}

// ── 3n. THE TILL'S CUSTOMER SEARCH — THE CAP IS REAL, AND ONLY ONE SIDE HOLDS IT ──────────────
// `lfh_customer_phone_search` used to put its LIMIT AFTER a `json_agg`, which caps the one aggregate
// row and not the array inside it — measured before migration 365: asking for 1 returned 5. And the
// panel must never work out "was this truncated?" from a row count and a constant of its own: with
// the two out of step by six rows, the sheet narrowed from a truncated list and the guest's name
// never appeared at all. The server knows; the server says.
{
  const { readFileSync: rf, readdirSync } = await import("node:fs");
  const bads = [];
  const migs = readdirSync(join(ROOT, "supabase/migrations"))
    .filter((f) => /customer_phone_search|bill_customer|row_cap/.test(f)).sort();
  const live = migs.map((f) => rf(join(ROOT, "supabase/migrations", f), "utf8"))
    .filter((t) => t.includes("CREATE OR REPLACE FUNCTION lfh_customer_phone_search")).pop();
  if (!live) bads.push("lfh_customer_phone_search is defined in no migration");
  else {
    const fn = live.slice(live.lastIndexOf("CREATE OR REPLACE FUNCTION lfh_customer_phone_search"));
    const body = fn.slice(0, fn.indexOf("$$;") + 3);
    const limAt = body.lastIndexOf("LIMIT ");
    const aggAt = body.lastIndexOf("json_agg");
    if (limAt < 0) bads.push("the search has no LIMIT at all");
    else if (limAt > aggAt) bads.push("the LIMIT still sits AFTER json_agg — it caps one aggregate row, not the rows");
  }
  const route = rf(join(ROOT, "app/api/editor/[...path]/route.ts"), "utf8");
  const at = route.indexOf('p === "customer-search"');
  const blk = at < 0 ? "" : route.slice(at, at + 1800);
  if (!/whole:\s*matches\.length\s*<\s*CUSTOMER_SEARCH_ROWS/.test(blk)) bads.push("the route no longer tells the panel whether it truncated");
  if (!/p_limit:\s*CUSTOMER_SEARCH_ROWS/.test(blk)) bads.push("the route's row cap is not the one named constant it reports against");
  const cust = rf(join(ROOT, "public/panels/billcustomer.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  if (/ASK_ROWS|rows\.length\s*<\s*\d+/.test(cust)) bads.push("the panel is guessing the server's cap again instead of reading `whole`");
  if (!/res && res\.whole === true/.test(cust)) bads.push("the panel no longer reads the server's truncation flag");
  if (/whole:\s*true/.test(cust)) bads.push("the panel defaults `whole` to true — an old server would lose customers");
  bads.length === 0
    ? ok("the customer search's row cap is real, and only the SERVER decides whether an answer was complete")
    : bad(`the till's customer search can over-read or lose a customer: ${bads.join(" · ")}`,
      "cap the ROWS inside the query, and let the server report truncation — a constant on each side drifts silently");
}

// ── 4. THE TYPES ARE THE ONE DESCRIPTION ──────────────────────────────────────────────────────
// The .d.ts is what the Next server and the admin React screens see. A field the document branches
// its whole identity on, missing from the type, means a TypeScript caller cannot render that
// document at all — which is how `cancelled` went undeclared for eleven days.
{
  const { readFileSync } = await import("node:fs");
  const js = readFileSync(join(ROOT, "public/panels/billdoc.js"), "utf8");
  const dts = readFileSync(join(ROOT, "public/panels/billdoc.d.ts"), "utf8");
  // Every `d.<field>` the BILL renderer reads, and every `o.<field>` the TICKET renderer reads.
  const billBody = js.slice(js.indexOf("function billDocHtml"), js.indexOf("function kotWhen"));
  const kotBody = js.slice(js.indexOf("function kotDocHtml"), js.indexOf("function kotBarCss"));
  const readsOf = (body, v) => [...new Set([...body.matchAll(new RegExp(`\\b${v}\\.([a-zA-Z_][a-zA-Z0-9_]*)`, "g"))].map((m) => m[1]))];
  const declared = (iface) => {
    const at = dts.indexOf(`interface ${iface}`);
    const block = dts.slice(at, dts.indexOf("}", at));
    return new Set([...block.matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\??:/gm)].map((m) => m[1]));
  };
  const IGNORE = new Set(["c", "n", "r", "filter", "map", "reduce", "length", "getTime", "getDate",
    "getMonth", "getFullYear", "toLocaleDateString", "toLocaleTimeString", "appendChild", "customer_name", "amt", "base"]);
  for (const [label, body, v, iface] of [["the bill", billBody, "d", "BillDocData"], ["the ticket", kotBody, "o", "KotDocData"]]) {
    const want = readsOf(body, v).filter((f) => !IGNORE.has(f));
    const have = declared(iface);
    const missing = want.filter((f) => !have.has(f));
    missing.length === 0
      ? ok(`${iface} declares every field ${label} actually reads (${want.length})`)
      : bad(`${iface} is missing ${missing.join(", ")}`,
        "the .d.ts is what TypeScript callers can pass — an undeclared field is a document they cannot render");
  }
  // And every runtime export is declared — as a function OR as a value. This only looked for
  // `export function`, so a plain constant entry point (TIP_MAX, 2026-08-28) read as undeclared
  // while it was declared one line below discPct. The rule is "a caller can reach it by name",
  // not "it is a function"; anything the module exports and the .d.ts does not name still fails.
  const undeclared = Object.keys(BILLDOC).filter((k) =>
    !new RegExp(`export (?:function|const|let|var) ${k}\\b`).test(dts));
  undeclared.length === 0
    ? ok(`all ${Object.keys(BILLDOC).length} entry points are declared`)
    : bad(`undeclared entry points: ${undeclared.join(", ")}`, "a caller cannot reach what the types do not name");
}

// ── 5. docs/NUMBERING.md STILL POINTS AT FILES THAT EXIST ─────────────────────────────────────
{
  const { readFileSync, existsSync } = await import("node:fs");
  const doc = readFileSync(join(ROOT, "docs/NUMBERING.md"), "utf8");
  const named = [...new Set([...doc.matchAll(/`(\d{3}_[a-z0-9_]+\.sql)`/g)].map((m) => m[1]))];
  const gone = named.filter((f) => !existsSync(join(ROOT, "supabase/migrations", f)));
  gone.length === 0
    ? ok(`docs/NUMBERING.md names ${named.length} migrations and all of them exist`)
    : bad(`docs/NUMBERING.md points at files that are gone: ${gone.join(", ")}`,
      "migrations get renumbered on merge — find the rule by its CONTENT and re-point the doc");
  // The two newest rules the prose leans on must be in the index table too.
  for (const [needle, why] of [["261_", "one series for parcel, banquet and the platforms"],
    ["331_", "a cancelled sale takes no invoice number"],
    ["332_", "every issued bill is signed and chained"],
    // The two rules that decide what the CUSTOMER's sheet shows, added 2026-08-22. This page is
    // the one place that answers "which number is this?", and it did not mention either: that the
    // sheet shows bill_no ONLY when there is no invoice number (owner, 2026-08-21), or that a
    // reprint is recorded but never printed (owner, 2026-08-19).
    ["333_", "a bill remembers it has been printed, so a button can say Reprint"],
    ["339_", "…and the printed bill says nothing about it"]]) {
    doc.includes(needle)
      ? ok(`the doc names the rule: ${why}`)
      : bad(`docs/NUMBERING.md no longer names ${why}`, "this page is the one place that says which number is which");
  }
}

// ── 5b. THE PAGE STATES THE RULE THAT DECIDES WHAT THE CUSTOMER SEES ──────────────────────────
// The printed sheet stopped showing bill_no whenever there is an invoice number (owner,
// 2026-08-21) and this page — the one place that answers "which number is this?" — still said the
// bill number is what "the customer's bill" shows. A doc that describes the old paper sends the
// next person looking for a fault that is a decision.
{
  const { readFileSync } = await import("node:fs");
  const doc = readFileSync(join(ROOT, "docs/NUMBERING.md"), "utf8");
  const js = readFileSync(join(ROOT, "public/panels/billdoc.js"), "utf8");
  // the code really does gate it…
  const gated = /!d\.invNo && d\.billNo !== "" && d\.billNo != null/.test(js);
  // …and the page really does say so
  const said = /only when there is no invoice number/i.test(doc);
  gated && said
    ? ok("docs/NUMBERING.md states the rule the printed sheet actually follows for bill_no")
    : bad(gated
        ? "the sheet hides bill_no when there is an invoice number, and docs/NUMBERING.md does not say so"
        : "docs/NUMBERING.md claims a bill_no rule the document no longer follows",
      "this page is the one place that answers 'which number is this?' — it has to describe today's paper");
}

console.log(fails
  ? `\n${fails} check(s) FAILED — the paper does not read the same everywhere, or its rows do not describe its rupees.`
  : "\nAll checks passed — one clock, one day, and every printed figure describes itself.");
process.exit(fails ? 1 : 0);
