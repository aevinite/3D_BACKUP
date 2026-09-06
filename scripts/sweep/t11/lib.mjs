// scripts/sweep/t11/lib.mjs — the harness sweep #8 terminal 11 re-runs its ledger with.
//
// WHY A HARNESS AND NOT A LIST OF SENTENCES. The rows this terminal inherited (T8.md sections A–N,
// P03501–P03999 and P18601–P19100) mostly name an exact assertion — "node: inr(107880.4) ===
// '₹1,07,880'". A sweep that re-reads those sentences and ticks them has not re-run anything, and
// that is precisely how five sweeps in a row failed to converge. So each one is implemented here,
// keyed by its own id, and `--only P03506` re-runs exactly that row for ever.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const require_ = createRequire(import.meta.url);
export const read = (p) => readFileSync(join(ROOT, p), "utf8");
export const BILLDOC = require_(join(ROOT, "public/panels/billdoc.js"));

/** Code with its comments removed — LINE comments first, then BLOCK comments.
 *  That order is not arbitrary: a "/*" sitting inside a "//" line hid 190 lines from two shipped
 *  guards in this repo. Used wherever a check must judge CODE and not an obituary, because "the
 *  panel still builds its own duplicate banner" and "a comment mentions the banner" look identical
 *  to a plain grep — and this harness reported exactly that as a fault on its first run. */
export const codeOnly = (src) =>
  String(src).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** Strip a rendered document down to the visible lines a person would read. */
export const visible = (html) =>
  String(html)
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "\n")
    .split("\n").map((s) => s.trim()).filter(Boolean);

/** The money rows above the TOTAL, as [label, amount] pairs, in the order they print. */
export const totalRows = (html) => {
  const i = html.indexOf('class="totals"');
  if (i < 0) return [];
  const block = html.slice(i, html.indexOf(">TOTAL<") + 1 > 0 ? html.indexOf(">TOTAL<") : undefined);
  return [...block.matchAll(/<div class="t[^"]*"><span>([^<]*)<\/span><span>([^<]*)<\/span>/g)]
    .map((m) => [m[1].trim(), m[2].trim()]);
};

/** A plain, valid bill — the baseline every render row varies from. */
export const baseBill = (over = {}) => ({
  name: "Test Cafe", addr: "12 Some Road", phone: "+91 90000 00000", gstin: "24ABCDE1234F1Z5",
  footer: "Thank you", invNo: "INV/2026-27/000001", tableDisp: "5", dateStr: "04/09/2026 01:00 pm",
  lines: [{ title: "Dal Makhani", qty: 2, price: 200 }],
  subtotal: 400, discount: 0, total: 420,
  taxRows: [{ label: "CGST", rate: 2.5, amt: 10 }, { label: "SGST", rate: 2.5, amt: 10 }],
  autoPrint: false, noBar: true, ...over,
});

// ── the runner ───────────────────────────────────────────────────────────────────────────────
const rows = [];
/** row(id, what, fn) — fn returns true for a pass, or a STRING saying what was actually seen. */
export const row = (id, what, fn) => rows.push({ id, what, fn });
/** Which ids are already registered. Two modules covering the same range need this: the generated
 *  bank yields the rows a hand-written module implements, rather than both filing the same id —
 *  which the duplicate check would (correctly) refuse to run at all. */
export const registered = () => new Set(rows.map((r) => r.id));
/** A row this run genuinely cannot execute. `why` is what a later session must do. */
export const skipRow = (id, what, why) => rows.push({ id, what, skip: why });

export async function run(label) {
  const argv = process.argv.slice(2);
  const onlyAt = argv.indexOf("--only");
  const only = onlyAt >= 0 && argv[onlyAt + 1] ? argv[onlyAt + 1] : null;
  const fromAt = argv.indexOf("--from");
  const from = fromAt >= 0 && argv[fromAt + 1] ? argv[fromAt + 1] : null;
  const quiet = argv.includes("--quiet");
  // A SUITE THAT FILTERS ITSELF OUT MUST NOT PRINT "all clean" (the argv.indexOf(-1)+1 scar).
  let picked = rows;
  if (only) picked = rows.filter((r) => r.id === only);
  // NUMERICALLY, NEVER AS TEXT. `r.id >= from` is a STRING compare, and the ledger's ids left the
  // five-digit space in September ("P100921"): "P18844" > "P100921" as text, so `--from P100921`
  // quietly ran eight hundred rows nobody asked for and would just as quietly SKIP rows if the
  // comparison fell the other way. A filter that silently picks the wrong set is the same class of
  // fault as a suite that filters itself out and still prints "all clean".
  else if (from) {
    const n = (x) => Number(String(x).replace(/^P/i, ""));
    const floor = n(from);
    if (!Number.isFinite(floor)) { console.log(`${label}: --from ${from} is not a phase id.`); process.exit(2); }
    picked = rows.filter((r) => n(r.id) >= floor);
  }
  if (!picked.length) {
    console.log(`\n${label}: NOTHING RAN — ${only || from || "(no filter)"} matched 0 of ${rows.length} rows.`);
    process.exit(2);
  }
  const dups = rows.map((r) => r.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dups.length) { console.log(`${label}: DUPLICATE ids: ${[...new Set(dups)].join(", ")}`); process.exit(2); }

  let pass = 0, fail = 0, skip = 0;
  const bad = [];
  // --json emits one record per row, so the LEDGER records exactly what was executed rather than
  // what somebody typed afterwards. That difference is the whole point of this harness.
  const json = argv.includes("--json");
  const records = [];
  for (const r of picked) {
    if (r.skip) { skip++; records.push({ id: r.id, what: r.what, result: "skip", note: r.skip }); if (!quiet && !json) console.log(`  ⏭  ${r.id}  ${r.what}  — ${r.skip}`); continue; }
    let verdict;
    try { verdict = await r.fn(); } catch (e) { verdict = `threw: ${e && e.message}`; }
    if (verdict === true) { pass++; records.push({ id: r.id, what: r.what, result: "pass", note: "" }); if (!quiet && !json) console.log(`  ✅ ${r.id}  ${r.what}`); }
    else {
      fail++;
      const why = verdict === false ? "(false)" : String(verdict);
      records.push({ id: r.id, what: r.what, result: "fail", note: why });
      bad.push(`${r.id} · ${r.what} → ${why}`);
      if (!json) console.log(`  ❌ ${r.id}  ${r.what}  → ${why}`);
    }
  }
  if (json) {
    // TO A FILE when asked. console.log of a very long string is TRUNCATED at ~64KB when stdout is
    // a pipe, which silently cut the record set in half and made a JSON parse fail look like a
    // suite problem. `--json-out <path>` writes the whole thing.
    const outAt = argv.indexOf("--json-out");
    const text = JSON.stringify(records);
    if (outAt >= 0 && argv[outAt + 1]) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(argv[outAt + 1], text);
      console.log(`${records.length} records written to ${argv[outAt + 1]}`);
    } else console.log(text);
    process.exit(fail ? 1 : 0);
  }
  console.log("─".repeat(78));
  console.log(`${label}: ${picked.length} rows · ${pass} passed · ${fail} failed · ${skip} skipped  (of ${rows.length} declared)`);
  if (bad.length) { console.log("\nwhat failed:"); for (const b of bad) console.log("  · " + b); }
  process.exit(fail ? 1 : 0);
}
