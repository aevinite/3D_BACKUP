// scripts/sweep/t12r2/run.mjs — sweep #10 T12 ROUND 2 · the waiter tablet, re-planned from nothing.
//   node scripts/sweep/t12r2/run.mjs [--base http://localhost:4412] [--ledger out.md] [--quiet]
// Order: G (generated: every function, attribute, toast) → P (every asset, id, host page, payload)
// → L (every state round 1 never visited). Ids run on from P181501 and must stay inside P182000.
import { writeFileSync } from "node:fs";
import { makeRunner, ledgerLine, closeBrowser } from "../t12s10/lib.mjs";
import { blockG, laterToasts } from "./g-every-bit.mjs";
import { blockP } from "./p-pages.mjs";
import { blockL } from "./l-journeys.mjs";

const R = makeRunner("T12 round 2 — the waiter tablet, every bit");
let next = 181501;
for (const [k, fn] of [["G", blockG], ["P", blockP], ["L", blockL]]) {
  try { const r = await fn(R, next); next = r.next; } catch (e) { console.log(`block ${k} stopped: ${String(e.message || e).split("\n")[0].slice(0, 220)}`); next = Math.max(next, 181501 + R.rows.length); }
}
// Rows for things the panel gained after round 2 was filed come LAST, so round 2's numbers never move.
try { await laterToasts(R, next); } catch (e) { console.log(`later rows stopped: ${String(e.message || e).split("\n")[0]}`); }
const { rows, counts } = R.done();
await closeBrowser();
if (next - 1 > 182000) console.log(`⚠ ids ran past the block: last id P${next - 1}`);
const i = process.argv.indexOf("--ledger");
if (i > 0) writeFileSync(process.argv[i + 1], rows.map(ledgerLine).join("\n") + "\n");
process.stdout.write("", () => process.exit(counts["❌"] ? 1 : 0));
