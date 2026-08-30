// verify:inventory-window — the month a stock report is actually about.
//
// ── WHY THIS EXISTS (T25 round 2, sweep #7, 2026-08-31) ──────────────────────────────────────────
//
// `lib/inventoryWindow.ts` is the ONE definition of "a month of stock" — the owner's Inventory page
// and the Inventory report both read it, precisely so the same restaurant cannot get two different
// totals from two screens. It tested its input with `^\d{4}-\d{2}$`, which accepts a month that does
// not exist, and BOTH callers validate with that same loose pattern, so nothing upstream caught it.
// Measured before the fix:
//
//     inventoryMonthWindow("2026-13") → 2026-12-31T23:30Z … 2027-01-31T23:30Z, labelled "2026-13"
//     inventoryMonthWindow("2026-00") → 2025-11-30T23:30Z … 2025-12-31T23:30Z, labelled "2026-00"
//
// i.e. **January 2027's purchases under a made-up heading.** A month picker cannot produce either,
// but a hand-edited address can — and the function's own note forbids exactly that outcome in as
// many words: *"a report that silently swapped to a different month would be worse than one that
// quietly stayed on this one."* The rule was written down and applied to the SHAPE but not to the
// RANGE. Same rule `lib/dashRange.ts` already applies to the manager's dashboard: a word nobody
// offers must resolve to something real, never reach somewhere else.
//
// This guard asserts the PROPERTIES, not the pattern — so a future rewrite that gets there another
// way still passes, and one that reintroduces the hole cannot:
//   1. whatever comes in, the label is a real month;
//   2. an impossible month answers with the CURRENT month, never a different one;
//   3. every window is a whole number of days, 28–31, starting 05:00 IST on the 1st;
//   4. consecutive windows touch exactly — no gap and no overlap where a purchase could hide or be
//      counted twice;
//   5. and the two callers do not carry a looser pattern of their own.
//
// Run: `npm run verify:inventory-window` (esbuild-bundled, so it can import through `@/`).
import { readFileSync } from "node:fs";
import { inventoryMonthWindow, documentDateBounds } from "@/lib/inventoryWindow";

const DAY = 86_400_000;
const fails: string[] = [];
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; if (!cond) fails.push(msg); };
const isRealMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

// 1 + 2. An impossible month is not a month.
const thisMonth = inventoryMonthWindow("").month;
for (const bad of ["2026-13", "2026-00", "2026-99", "0000-13", "2026-1", "2026-003", "9999-13"]) {
  const w = inventoryMonthWindow(bad);
  ok(isRealMonth(w.month), `"${bad}" produced the label ${w.month}, which is not a real month`);
  ok(w.month === thisMonth, `"${bad}" silently answered with ${w.month} instead of the current month`);
}

// Rubbish of every shape falls back, and never yields an invalid date.
for (const bad of ["", "abc", "2026", "26-03", "2026-3", null, undefined, {}, [], 7, true, NaN]) {
  const w = inventoryMonthWindow(bad as unknown as string);
  ok(w.month === thisMonth, `${String(bad)} → ${w.month}`);
  ok(!Number.isNaN(Date.parse(w.fromIso)), `${String(bad)} → invalid fromIso ${w.fromIso}`);
  ok(!Number.isNaN(Date.parse(w.toIso)), `${String(bad)} → invalid toIso ${w.toIso}`);
}

// A real month is honoured, and the business day starts at 05:00 IST (= 23:30 UTC the day before).
{
  const w = inventoryMonthWindow("2026-03");
  ok(w.month === "2026-03", `a real month was not honoured: ${w.month}`);
  ok(w.fromIso === "2026-02-28T23:30:00.000Z", `March 2026 does not start at 05:00 IST on the 1st: ${w.fromIso}`);
  ok(w.toIso === "2026-03-31T23:30:00.000Z", `March 2026 does not end at 05:00 IST on 1 April: ${w.toIso}`);
  ok(w.from === "2026-03-01", `the printed 'from' is not the 1st: ${w.from}`);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(w.to), `the printed 'to' is not a plain date: ${w.to}`);
}

// 3 + 4. Whole days, sane length, and consecutive months touching exactly.
for (let y = 2025; y <= 2028; y++) {
  for (let m = 1; m <= 12; m++) {
    const label = `${y}-${String(m).padStart(2, "0")}`;
    const w = inventoryMonthWindow(label);
    const days = (Date.parse(w.toIso) - Date.parse(w.fromIso)) / DAY;
    ok(days === Math.round(days), `${label} is ${days} days long — a part-day slipped in`);
    ok(days >= 28 && days <= 31, `${label} is ${days} days long`);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    ok(w.toIso === inventoryMonthWindow(next).fromIso, `${label} does not meet ${next}: ${w.toIso} vs ${inventoryMonthWindow(next).fromIso}`);
  }
}
ok((Date.parse(inventoryMonthWindow("2028-02").toIso) - Date.parse(inventoryMonthWindow("2028-02").fromIso)) / DAY === 29, "February 2028 is not 29 days — leap years are not being honoured");

// documentDateBounds prints the two dates a document would show.
{
  const b = documentDateBounds("2026-02-28T23:30:00.000Z", "2026-03-31T23:30:00.000Z");
  ok(b.from === "2026-03-01", `documentDateBounds from = ${b.from}`);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(b.to), `documentDateBounds to = ${b.to}`);
}

// 5. No caller may carry a looser month pattern of its own — that is how this hole survived.
{
  const route = readFileSync("app/api/owner/inventory/route.ts", "utf8");
  const loose = route.match(/\/\^\\d\{4\}-\\d\{2\}\$\//g) || [];
  ok(loose.length === 0,
     `app/api/owner/inventory/route.ts still validates the month with the loose /^\\d{4}-\\d{2}$/ — ` +
     `it accepts 2026-13. Use the real-month pattern /^\\d{4}-(0[1-9]|1[0-2])$/ or lean on the window helper.`);
}

// NOTHING TO CHECK IS A FAILURE, NOT A PASS. This guard's subjects are hard-coded, so the only way
// it can silently stop checking is an edit that deletes the loops. The floor is well under the real
// count so it never needs editing as the guard grows.
if (checks < 150) {
  console.log(`\n✗ verify:inventory-window ran only ${checks} checks — it should run hundreds. Its loops were cut.`);
  process.exit(1);
}

if (fails.length) {
  console.log(`\n✗ verify:inventory-window — ${fails.length} of ${checks} checks failed:\n`);
  for (const f of fails.slice(0, 20)) console.log("  · " + f);
  if (fails.length > 20) console.log(`  … and ${fails.length - 20} more`);
  console.log(`
A month of stock has ONE definition (lib/inventoryWindow.ts) precisely so the owner's Inventory page
and the Inventory report cannot disagree. A month that does not exist must fall back to the current
one — never to a different month under a made-up heading.
`);
  process.exit(1);
}
console.log(`✓ verify:inventory-window — ${checks} checks: an impossible month never becomes a different month, every window is whole days at 05:00 IST, and consecutive months touch exactly`);
