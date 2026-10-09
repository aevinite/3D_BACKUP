// scripts/sweep/t9s10/run.mjs — sweep #10 terminal 9's 500 new checks, in one command.
//   node scripts/sweep/t9s10/run.mjs              # everything
//   node scripts/sweep/t9s10/run.mjs --quiet      # only the failures
//   node scripts/sweep/t9s10/run.mjs --ledger     # the rows for .claude/sweep/LEDGER/T9-S10.md
//   node scripts/sweep/t9s10/run.mjs --only P178123
//   node scripts/sweep/t9s10/run.mjs --block a    # one block (a, b, c, d)
// LIVE rows need this terminal's own dev server (T9_BASE, default http://127.0.0.1:4409).
import { runAll } from "./lib.mjs";
const A = process.argv.slice(2);
const only = A.includes("--only") ? A[A.indexOf("--only") + 1] : null;
const block = A.includes("--block") ? A[A.indexOf("--block") + 1] : null;
for (const b of ["a", "b", "c", "d"]) {
  if (block && block !== b) continue;
  const f = { a: "./new-a-gates.mjs", b: "./new-b-states.mjs", c: "./new-c-live.mjs", d: "./new-d-rules.mjs" }[b];
  try { await import(f); } catch (e) { if (e.code === "ERR_MODULE_NOT_FOUND" && String(e.message).includes(f.slice(2))) continue; throw e; }
}
const rows = await runAll({ ledger: A.includes("--ledger"), quiet: A.includes("--quiet"), only });
process.exit(rows.some((r) => r.mark === "❌") ? 1 : 0);
