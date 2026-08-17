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

// ── 3c. A SECOND COPY SAYS SO, AND A FIRST COPY NEVER DOES ────────────────────────────────────
// The kitchen ticket has branded reprints since 2026-08-04; the bill gained the same band on
// 2026-08-17. A first print marked DUPLICATE would be a lie on paper, which is the failure mode
// that matters — so both directions are pinned.
{
  const S = { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }] };
  const os = [{ status: "served", subtotal: 620, taxable_base: 620, nontax_amount: 0, discount: 0, tax_rate: 0.05,
    items: [{ title: "A", qty: 2, price: 310, tax_mode: "excl" }] }];
  const mk = (a) => BILLDOC.billDocHtml(BILLDOC.billData({ settings: S, restaurant: {}, orders: os, session: { bill_no: 41 }, autoPrint: false, ...a }));
  const bands = (h) => [...h.matchAll(/<div class="vband">([^<]*)</g)].map((m) => m[1]);
  bands(mk({})).length === 0
    ? ok("a first print of a bill carries no duplicate band")
    : bad("a FIRST print is branded a duplicate", "a sheet marked DUPLICATE that is really the original is a lie on paper");
  /Reprint/i.test(bands(mk({ reprint: true }))[0] || "")
    ? ok("a reprinted bill carries the Reprint · Duplicate band")
    : bad("a reprinted bill is indistinguishable from the original", "pass reprint:true — the ticket has had this since 2026-08-04");
  bands(mk({ reprint: true })).length === 1 && mk({ reprint: true }).indexOf('class="vband"') < mk({ reprint: true }).indexOf('class="kind"')
    ? ok("  …at the top, above the document's name")
    : bad("the bill's duplicate band is not at the top", "it has to be the first thing read");
  // and the KOT's own banner still works, both ways
  /class="rp"/.test(BILLDOC.kotDocHtml({ rname: "R", kot: 1, lines: [], reprint: true }))
    && !/class="rp"/.test(BILLDOC.kotDocHtml({ rname: "R", kot: 1, lines: [] }))
    ? ok("the kitchen ticket still brands a reprint, and only a reprint")
    : bad("the ticket's duplicate banner regressed", "one flag, three documents");
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
    ["332_", "every issued bill is signed and chained"]]) {
    doc.includes(needle)
      ? ok(`the doc names the rule: ${why}`)
      : bad(`docs/NUMBERING.md no longer names ${why}`, "this page is the one place that says which number is which");
  }
}

console.log(fails
  ? `\n${fails} check(s) FAILED — the paper does not read the same everywhere, or its rows do not describe its rupees.`
  : "\nAll checks passed — one clock, one day, and every printed figure describes itself.");
process.exit(fails ? 1 : 0);
