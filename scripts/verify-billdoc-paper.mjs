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

// ── 3d. THE VERIFICATION LINE (mig 332) ───────────────────────────────────────────────────────
// The signed chain is only checkable by whoever holds the paper if it is ON the paper. It prints
// only when the caller supplies BOTH parts, so a bill printed before the columns are exposed is
// unchanged — and never on a cancelled sheet, whose sale was withdrawn.
{
  const S = { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }] };
  const line = { status: "served", subtotal: 100, taxable_base: 100, nontax_amount: 0, discount: 0, tax_rate: 0.05,
    items: [{ title: "A", qty: 1, price: 100, tax_mode: "excl" }] };
  const mk = (sess, extra) => BILLDOC.billDocHtml(BILLDOC.billData({ settings: S, restaurant: {}, orders: [{ ...line, ...(extra || {}) }], session: sess, autoPrint: false }));
  const ver = (h) => (h.match(/Verification ([^<]*)/) || [])[1] || "";
  !ver(mk({ bill_no: 1 }))
    ? ok("a bill with no chain row prints no verification line (every bill today)")
    : bad("a verification line printed with nothing to verify", "both parts must be supplied or the line stays off");
  !ver(mk({ bill_no: 1, chain_seq: 7 })) && !ver(mk({ bill_no: 1, chain_hash: "abc" }))
    ? ok("  …and half a reference prints nothing either")
    : bad("half a chain reference reached the paper", "a partial reference cannot be checked and must not print");
  ver(mk({ bill_no: 1, chain_seq: 1042, chain_hash: "a3f9c1d2e4b56789abcdef" })) === "1042 · a3f9c1d2e4b5"
    ? ok("a chained bill prints its sequence and the first 12 characters of its hash")
    : bad(`the verification line reads "${ver(mk({ bill_no: 1, chain_seq: 1042, chain_hash: "a3f9c1d2e4b56789abcdef" }))}"`,
      "one format, decided here, so every panel prints the same reference for the same bill");
  !ver(mk({ bill_no: 1, chain_seq: 9, chain_hash: "deadbeefcafe0000" }, { status: "cancelled" }))
    ? ok("  …and a cancelled sheet carries none")
    : bad("a cancelled bill printed a verification line", "that sale was withdrawn; the band across the top is the statement");
}

// ── 3g. THE DIGIT COUNTER NEVER CONTRADICTS THE BOX BESIDE IT ─────────────────────────────────
// "0/10" beside a complete number is the sheet giving two answers at once, and at a till the
// honest reading of it is "retype it". paintCount() only ran on the `input` event, and assigning
// `.value` from script fires no such event — so a reopened bill (the case the prefill feature was
// BUILT for, owner 2026-07-30) opened showing "0/10" against "98250 12345", and tapping a
// suggestion showed "5/10" against a ten-digit number. Measured on a 360px phone, 2026-08-22.
// Structural, so it cannot come back by a THIRD path being added: every write to the box must
// either go through setPhone() or be followed immediately by a paintCount().
{
  const { readFileSync } = await import("node:fs");
  const cust = readFileSync(join(ROOT, "public/panels/billcustomer.js"), "utf8");
  const lines = cust.split("\n");
  const offenders = [];
  lines.forEach((ln, i) => {
    if (!/\bphoneEl\.value\s*=[^=]/.test(ln)) return;
    if (/const setPhone\s*=/.test(ln)) return;                       // the helper itself
    const next = (lines[i + 1] || "") + (lines[i + 2] || "");
    if (!/paintCount\(\)/.test(next)) offenders.push(`line ${i + 1}: ${ln.trim().slice(0, 70)}`);
  });
  offenders.length === 0
    ? ok("every write to the mobile box repaints the digit counter")
    : bad(`a write to the mobile box leaves the counter stale: ${offenders.join(" · ")}`,
      "go through setPhone(), or call paintCount() straight after — a counter that contradicts the box reads as 'retype it'");
  /paintCount\(\);?\s*$/m.test(cust) && /const setPhone = \(v\) => \{ phoneEl\.value = v; paintCount\(\); \}/.test(cust)
    ? ok("  …and setPhone() is the one door that does it")
    : bad("setPhone() is gone or no longer repaints", "one door, so a new call site cannot forget");
}

// ── 3h. NO DOCUMENT PRINTS "Invalid Date" ─────────────────────────────────────────────────────
// The ticket has refused since it was written and the thermal bill since 2026-08-05. The banquet
// sheet guarded none of its THREE date fields, so it printed `Dated  Invalid Date` — the field
// that decides which GST period a sale falls in — plus the same on its function line and on every
// advance receipt. Reachable through the data, not only the preview: `banquet_bills.advances` is
// JSONB and migrations 237/239 store the date with NO cast, so any text the client sends is kept.
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
      // and a missing date must never take the MONEY with it
      if (field === "an advance's date" && !/500\/-/.test(html)) { lost++; if (lost === 1) bad(`an advance's amount vanished with its date (${JSON.stringify(j)})`, "drop the date, never the rupees"); }
    }
  }
  if (!bad_ && !lost) ok(`all ${JUNK.length * 3} junk-date cases print no "Invalid Date", and every advance keeps its money`);
  // …and a good sheet is untouched
  const good = BILLDOC.banquetDocHtml({ bill: { ...base, issued_at: "2026-08-16T16:01:00Z",
    fn_date: "2026-09-14", func: "Reception", fn_from: "7pm", advances: [{ amt: 500, mode: "upi", date: "2026-08-01" }] },
    lines: [{ title: "A", qty: 1, price: 1000 }], settings: {}, restaurant: {}, autoPrint: false });
  (/Dated<\/div><div class="v">16-08-2026/.test(good) && /UPI PAY DT\.01\/08\/2026/.test(good)
    && /Function: Reception · 14\/09\/2026 7pm/.test(good))
    ? ok("  …and a sheet with real dates prints all three of them exactly as before")
    : bad("a good banquet sheet's dates changed", "the guard must only bite on an unparseable value");
  // the thermal bill and the ticket, same question, so all three stay together
  for (const j of JUNK) {
    if (BILLDOC.kotWhen(j) !== "" && /Invalid|NaN/.test(BILLDOC.kotWhen(j))) {
      bad(`kotWhen(${JSON.stringify(j)}) printed "${BILLDOC.kotWhen(j)}"`, "a ticket never prints Invalid Date"); break; }
    const d = BILLDOC.billData({ settings: {}, restaurant: {}, session: { invoice_at: j, invoice_no: 1 },
      orders: [{ status: "served", subtotal: 1, taxable_base: 1, tax_rate: 0.05, items: [{ title: "A", qty: 1, price: 1 }] }] });
    if (/Invalid|NaN/.test(d.dateStr + d.invNo)) {
      bad(`the bill printed "${d.dateStr}" / "${d.invNo}" for ${JSON.stringify(j)}`, "the bill never prints Invalid Date either"); break; }
  }
  ok("the bill and the ticket refuse the same ten junk values");
}

// ── 3j. ONE WORD FOR THE TAX, ON EVERY SURFACE ────────────────────────────────────────────────
// `tax_label` had TWO defaults inside this one file: billIdentity said "Tax", and three inline
// reads said "GST". A restaurant that has never set the word — the default state — then got a
// different one depending on which panel printed the bill, because the manager panel copies
// billIdentity's answer into its own settings first and nothing else does. Manager: "MRP items
// include Rs 2 Tax". Tablet, Access preview, admin preview: "...Rs 2 GST".
{
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
  // the manager panel resolves the word FIRST and copies it in; every other surface passes the
  // settings straight through. Both must land on the same word.
  const cases = [
    ["a restaurant that has never set the word", {}],
    ["the manager panel, which copies billIdentity's answer in first", { tax_label: "Tax" }],
    ["a whitespace label", { tax_label: "   " }],
    ["a restaurant that set its own word", { tax_label: "VAT" }],
  ];
  const bads = [];
  for (const [what, settings] of cases) {
    const want = BILLDOC.billIdentity(settings, {}).taxLabel;
    const note = mrpNote(settings), bq = bqWord(settings);
    if (!note.endsWith(" " + want)) bads.push(`${what}: the MRP note says "${note}", not "${want}"`);
    if (bq !== want) bads.push(`${what}: the banquet fallback says "${bq}", not "${want}"`);
  }
  bads.length === 0
    ? ok("every surface prints ONE word for the tax — billIdentity's answer, whatever the settings say")
    : bad(`the tax word differs by surface: ${bads.join(" · ")}`,
      "read bi.taxLabel — an inline `s.tax_label || \"GST\"` gives the tablet a different word from the manager panel");
  // and there is no second default left in the file
  const { readFileSync: rf } = await import("node:fs");
  // Scan the CODE, not the comments — the note explaining this fix quotes the old default, and a
  // guard that reads its own explanation as evidence is the fault it is meant to catch.
  const js = rf(join(ROOT, "public/panels/billdoc.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const inline = [...js.matchAll(/s\.tax_label\s*\|\|\s*"([^"]*)"/g)].map((m) => m[1]);
  const stray = inline.filter((w, i) => i > 0 || w !== "Tax");
  stray.length === 0
    ? ok("  …and only billIdentity carries the default")
    : bad(`a second default for the tax word: ${stray.join(", ")}`,
      "one setting, one default — resolve it in billIdentity and read bi.taxLabel everywhere else");
}

// ── 3k. ONE BAD LINE DOES NOT COST THE WHOLE PIECE OF PAPER ───────────────────────────────────
// A single null in a line list threw out of the render, on ALL THREE documents. They are drawn
// into a window.open or a hidden iframe, so a throw there is a BLANK WINDOW: the kitchen gets no
// ticket, or the guest gets no bill, with nothing on screen saying why — the worst possible shape
// of "a tap must never vanish in silence", at the till, mid-rush. `items` is JSONB in this
// product, so a null element is one database write away. Printing the other nine dishes beats
// printing nothing.
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
    try {
      const html = fn();
      if (!want.test(html)) bads.push(`${what}: rendered, but the good lines are missing`);
    } catch (e) { bads.push(`${what}: threw — ${e.message}`); }
  }
  bads.length === 0
    ? ok(`all ${cases.length} bad-line shapes still produce a document, with the good lines on it`)
    : bad(`a bad line stopped the paper: ${bads.join(" · ")}`,
      "drop empty entries — these documents render into a window.open, so a throw is a blank window and no paper at all");
  // every public entry point survives being called with nothing
  const threw = [];
  for (const [k, fn] of Object.entries(BILLDOC)) {
    if (typeof fn !== "function") continue;
    try { fn(); } catch (e) { threw.push(`${k}: ${e.message}`); }
  }
  threw.length === 0
    ? ok(`  …and all ${Object.keys(BILLDOC).length} entry points survive being called with nothing`)
    : bad(`an entry point throws on no argument: ${threw.join(" · ")}`,
      "this file is the public LFH_BILLDOC API — every door defaults its argument");
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
  // And every runtime export is declared.
  const undeclared = Object.keys(BILLDOC).filter((k) => !new RegExp(`export function ${k}\\b`).test(dts));
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
