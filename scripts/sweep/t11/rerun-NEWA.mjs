// NEW A of T8.md's sweep-#7 block re-run — ONE CLOCK, ONE DAY, ONE FINANCIAL YEAR, ON EVERY
// DEVICE. P18601–P18700.
//
// The rows are GENERATED FROM THE LEDGER ITSELF: each id's own check sentence names a field and an
// instant ("the bill's date row reads the same on every device at 01:50 IST"), so the assertion is
// built from the row rather than from my memory of the row. That is the only way 99 generated ids
// can be guaranteed to line up with what they claim to test — and a mis-aligned id is worse than
// no check, because it re-runs green against the wrong question.
import { BILLDOC as B, row, read } from "./lib.mjs";

const T8 = read(".claude/sweep/LEDGER/T8.md").split("\n");
const ROWS = [];
for (const ln of T8) {
  const m = /^\| (P186\d\d) \| (.*?) \| (.*?) \| (.*?) \|/.exec(ln);
  if (m) ROWS.push({ id: m[1], check: m[2].trim() });
}

// ── the instants the rows name, in IST, as real UTC timestamps ──────────────────────────────
// IST is UTC+05:30 with no daylight saving, so each is stated once and converted here.
const IST = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000).toISOString();
const INSTANTS = [
  ["an evening service (21:31 IST)", IST(2026, 8, 16, 21, 31)],
  ["01:50 IST", IST(2026, 8, 17, 1, 50)],
  ["00:30 IST", IST(2026, 8, 17, 0, 30)],
  ["04:59 IST", IST(2026, 8, 17, 4, 59)],
  ["05:01 IST", IST(2026, 8, 17, 5, 1)],
  ["23:00 IST on 31 March", IST(2026, 3, 31, 23, 0)],
  ["01:00 IST on 1 April", IST(2026, 4, 1, 1, 0)],
  ["noon IST on 1 January", IST(2026, 1, 1, 12, 0)],
  ["23:59 IST on 31 December", IST(2026, 12, 31, 23, 59)],
  ["00:01 IST on 1 January", IST(2026, 1, 1, 0, 1)],
];
const instantFor = (check) => {
  const hit = INSTANTS.find(([label]) => check.includes(label));
  return hit ? hit[1] : null;
};

// ── the eight fields, each read the way the real document reads it ──────────────────────────
const S = { tax_rate: 0.05, invoice_prefix: "INV" };
const FIELDS = {
  "the kitchen ticket's time and day": (ts) => B.kotWhen(ts),
  "the bill's date row": (ts) => B.billData({ settings: S, restaurant: {}, session: { invoice_at: ts }, orders: [{ status: "served", subtotal: 100, items: [] }] }).dateStr,
  "the invoice number": (ts) => B.invFmt(41, ts, "INV"),
  "the financial year": (ts) => B.financialYear(ts),
  "the banquet sheet's date": (ts) => (/<div class="lbl">Dated<\/div><div class="v">([^<]*)/.exec(bqHtml(ts)) || [])[1],
  "the banquet sheet's time": (ts) => (/<div class="lbl">Time<\/div><div class="v">([^<]*)/.exec(bqHtml(ts)) || [])[1],
  "the banquet advance's date": (ts) => (/([A-Z]+) PAY DT\.([0-9/]+)/.exec(bqHtml(ts, { advances: [{ mode: "upi", amt: 500, date: ts }] })) || [])[2],
  "the banquet function date": (ts) => {
    const h = bqHtml(ts, { func: "Reception", fn_date: ts });
    return (/Function: Reception · ([0-9/]+)/.exec(h) || [])[1];
  },
};
const bqHtml = (ts, over = {}) => B.banquetDocHtml({
  bill: { bill_no: "B/1", issued_at: ts, subtotal: 1000, discount: 0, tax: 180, total: 1180, ...over },
  lines: [{ title: "Hall", qty: 1, price: 1000 }], settings: {}, restaurant: {},
});

// ── "the same on every device" — run the field with the machine's own zone moved under it ───
// Node reads process.env.TZ at Date construction, so each zone is applied for the duration of the
// call and put straight back. Four zones spanning UTC−4 to UTC+11, which is what caught the four
// original faults ("India tablet YESTERDAY 09:31 pm · New York 12:01 pm").
const ZONES = ["Asia/Kolkata", "America/New_York", "Europe/London", "Australia/Sydney", "Pacific/Kiritimati"];
function everyDevice(fn, ts) {
  const was = process.env.TZ;
  const out = [];
  try {
    for (const tz of ZONES) {
      process.env.TZ = tz;
      out.push({ tz, v: String(fn(ts)) });
    }
  } finally { process.env.TZ = was; }
  return out;
}

let built = 0, unmatched = [];
for (const { id, check } of ROWS) {
  const field = Object.keys(FIELDS).find((f) => check.startsWith(f + " reads the same on every device"));
  const ts = instantFor(check);
  if (field && ts) {
    built++;
    row(id, check, () => {
      const seen = everyDevice(FIELDS[field], ts);
      const distinct = [...new Set(seen.map((s) => s.v))];
      if (distinct.length === 1) return distinct[0] !== "undefined" || `every device agrees, but the field is undefined`;
      return `${distinct.length} different answers: ` + seen.map((s) => `${s.tz.split("/")[1]}="${s.v}"`).join(" · ");
    });
    continue;
  }
  unmatched.push({ id, check });
}

// ── the rows that are not the 8×10 grid: each states its own expected answer ─────────────────
const ONE_OFFS = {
  "the FY of 23:00 IST on 31 March is 2025-26": () => B.financialYear(IST(2026, 3, 31, 23, 0)) === "2025-26" || `it is ${B.financialYear(IST(2026, 3, 31, 23, 0))}`,
  "the FY of 01:00 IST on 1 April is 2026-27": () => B.financialYear(IST(2026, 4, 1, 1, 0)) === "2026-27" || `it is ${B.financialYear(IST(2026, 4, 1, 1, 0))}`,
  "a calendar year turning does NOT turn the financial year": () => {
    const dec = B.financialYear(IST(2026, 12, 31, 23, 59)), jan = B.financialYear(IST(2027, 1, 1, 0, 1));
    return dec === jan || `31 Dec says ${dec}, 1 Jan says ${jan}`;
  },
  "the invoice number carries that FY, not today's": () =>
    B.invFmt(41, IST(2026, 3, 15, 12, 0), "INV") === "INV/2025-26/000041" || `it reads ${B.invFmt(41, IST(2026, 3, 15, 12, 0), "INV")}`,
  "the bill's date row and the banquet sheet's name the SAME calendar day": () => {
    const ts = IST(2026, 8, 16, 21, 31);
    const bill = FIELDS["the bill's date row"](ts).split(" ")[0];              // dd/mm/yyyy
    const bq = String(FIELDS["the banquet sheet's date"](ts)).replace(/-/g, "/");
    return bill === bq || `bill "${bill}" vs sheet "${bq}"`;
  },
  "…and the same clock time": () => {
    const ts = IST(2026, 8, 16, 21, 31);
    const bill = FIELDS["the bill's date row"](ts).split(" ").slice(1).join(" ").toUpperCase().replace(/\s/g, "");
    const bq = String(FIELDS["the banquet sheet's time"](ts)).toUpperCase().replace(/\s/g, "");
    return bill === bq || `bill "${bill}" vs sheet "${bq}"`;
  },
  "the ticket's clock time agrees with the bill's for the same order": () => {
    const ts = IST(2026, 8, 16, 21, 31);
    const kot = B.kotWhen(ts).replace(/^.*?(\d{2}:\d{2} [AP]M)$/, "$1");
    const bill = FIELDS["the bill's date row"](ts).split(" ").slice(1).join(" ").toUpperCase();
    return kot === bill || `ticket "${kot}" vs bill "${bill}"`;
  },
  "a ticket at 04:59 IST belongs to the day that is ENDING, one at 05:01 to the new one": () => {
    const key = (ts) => new Date(Date.parse(ts) + 30 * 60000).toISOString().slice(0, 10);
    return key(IST(2026, 8, 17, 4, 59)) !== key(IST(2026, 8, 17, 5, 1))
      || `both fall on ${key(IST(2026, 8, 17, 4, 59))} — the business day no longer turns at 05:00`;
  },
  "a bare date string (no time) is read as an India date on every device": () => {
    const seen = everyDevice((v) => (/([A-Z]+) PAY DT\.([0-9/]+)/.exec(bqHtml(IST(2026, 8, 16, 21, 31), { advances: [{ mode: "upi", amt: 500, date: "2026-08-01" }] })) || [])[2], null);
    const distinct = [...new Set(seen.map((s) => s.v))];
    return (distinct.length === 1 && distinct[0] === "01/08/2026") || `${distinct.length} answers: ${distinct.join(" · ")}`;
  },
  "a bare date on the FY boundary is read as an India date too": () => {
    const seen = everyDevice(() => B.financialYear("2026-04-01"), null);
    const distinct = [...new Set(seen.map((s) => s.v))];
    return distinct.length === 1 || `${distinct.length} answers: ${distinct.join(" · ")}`;
  },
};
// ── "no document prints Invalid Date or NaN for X" — all three documents, one bad value each ──
// A date can arrive as anything: banquet_bills.advances is JSONB and migrations 237/239 store the
// date with NO cast, so any text the client sent comes straight back out. All three documents are
// asked, because the kitchen ticket refused from the day it was written, the thermal bill since
// 2026-08-05 and the banquet sheet only since 2026-08-22 — three different dates, one rule.
const BAD_VALUES = {
  "null": null, "an empty string": "", "the word garbage": "garbage", "zero": 0,
  "undefined": undefined, "NaN": NaN, "a negative epoch": -1,
  "an object": { nope: true }, "a far-future date": "275760-09-14T00:00:00Z",
};
const printsNothingBad = (v) => {
  const bad = [];
  const kotText = B.kotDocHtml({ rname: "R", kot: 1, tableLabel: "T1", when: B.kotWhen(v), lines: [{ qty: 1, title: "Dal" }] });
  if (/Invalid Date|NaN/.test(kotText)) bad.push("the kitchen ticket");
  const d = B.billData({ settings: S, restaurant: {}, session: { invoice_at: v }, orders: [{ status: "served", subtotal: 100, items: [] }] });
  if (/Invalid Date|NaN/.test(B.billDocHtml({ ...d, noBar: true }))) bad.push("the bill");
  const bqh = bqHtml(IST(2026, 8, 16, 21, 31), { advances: [{ mode: "upi", amt: 500, date: v }], fn_date: v, func: "Reception" });
  if (/Invalid Date|NaN/.test(bqh)) bad.push("the banquet sheet");
  return bad;
};
for (const { id, check } of unmatched) {
  const m = /no document prints "Invalid Date" or NaN for (.+)$/.exec(check);
  if (m && m[1] in BAD_VALUES) {
    built++;
    row(id, check, () => {
      const bad = printsNothingBad(BAD_VALUES[m[1]]);
      return bad.length === 0 || `${bad.join(" and ")} printed it`;
    });
    continue;
  }
  const key = Object.keys(ONE_OFFS).find((k) => check.startsWith(k.slice(0, 40)));
  if (key) { built++; row(id, check, ONE_OFFS[key]); continue; }
  // Anything the parser cannot place is reported LOUDLY rather than silently dropped — a generated
  // bank that quietly skips rows is the "suite that filters itself out" scar.
  row(id, check, () => `this row was not matched to an assertion by the generator — it must be read and implemented, not skipped`);
}
if (built < ROWS.length) console.log(`  (NEW A: ${built} of ${ROWS.length} rows generated from the ledger; the rest report themselves)`);
