// scripts/sweep/t12s10/run.mjs — sweep #10 T12 · the waiter tablet screen · every block, one runner.
//   node scripts/sweep/t12s10/run.mjs [--base http://localhost:4412] [--blocks A,B,C,D,E] [--ledger out.md] [--quiet]
// --ledger writes the block's rows as ledger table lines (the shape of .claude/sweep/LEDGER/T12-S10.md).
import { writeFileSync } from "node:fs";
import { makeRunner, ledgerLine, closeBrowser } from "./lib.mjs";
import { blockA } from "./a-page.mjs";
import { blockB } from "./b-live.mjs";
import { blockC } from "./c-look.mjs";
import { blockD } from "./d-src.mjs";
import { blockE } from "./e-cross.mjs";

const want = (() => { const i = process.argv.indexOf("--blocks"); return new Set((i > 0 ? process.argv[i + 1] : "A,B,C,D,E").split(",")); })();
const R = makeRunner("T12 sweep #10 — the waiter tablet screen");
const order = [["A", blockA], ["E", blockE], ["B", blockB], ["C", blockC], ["D", blockD]];
for (const [k, fn] of order) {
  if (!want.has(k)) continue;
  try { await fn(R); } catch (e) { console.log(`block ${k} stopped: ${String(e.message || e).slice(0, 200)}`); }
}
const { rows } = R.done();
await closeBrowser();
const i = process.argv.indexOf("--ledger");
if (i > 0) writeFileSync(process.argv[i + 1], rows.slice().sort((a, b) => a.id.localeCompare(b.id)).map(ledgerLine).join("\n") + "\n");
