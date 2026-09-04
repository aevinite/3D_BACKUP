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
  else if (from) picked = rows.filter((r) => r.id >= from);
  if (!picked.length) {
    console.log(`\n${label}: NOTHING RAN — ${only || from || "(no filter)"} matched 0 of ${rows.length} rows.`);
    process.exit(2);
  }
  const dups = rows.map((r) => r.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dups.length) { console.log(`${label}: DUPLICATE ids: ${[...new Set(dups)].join(", ")}`); process.exit(2); }

  let pass = 0, fail = 0, skip = 0;
  const bad = [];
  for (const r of picked) {
    if (r.skip) { skip++; if (!quiet) console.log(`  ⏭  ${r.id}  ${r.what}  — ${r.skip}`); continue; }
    let verdict;
    try { verdict = await r.fn(); } catch (e) { verdict = `threw: ${e && e.message}`; }
    if (verdict === true) { pass++; if (!quiet) console.log(`  ✅ ${r.id}  ${r.what}`); }
    else { fail++; const why = verdict === false ? "(false)" : String(verdict); bad.push(`${r.id} · ${r.what} → ${why}`); console.log(`  ❌ ${r.id}  ${r.what}  → ${why}`); }
  }
  console.log("─".repeat(78));
  console.log(`${label}: ${picked.length} rows · ${pass} passed · ${fail} failed · ${skip} skipped  (of ${rows.length} declared)`);
  if (bad.length) { console.log("\nwhat failed:"); for (const b of bad) console.log("  · " + b); }
  process.exit(fail ? 1 : 0);
}
