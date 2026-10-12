// scripts/sweep/t6s10/run.mjs — sweep #10 terminal 6's 500 new checks, in one command.
//   node scripts/sweep/t6s10/run.mjs              # everything
//   node scripts/sweep/t6s10/run.mjs --quiet      # only what is not green
//   node scripts/sweep/t6s10/run.mjs --ledger     # the rows for .claude/sweep/LEDGER/T6-S10.md
//   node scripts/sweep/t6s10/run.mjs --block a,b  # some blocks
//   node scripts/sweep/t6s10/run.mjs --only P175012
// LIVE rows need this terminal's own dev server (T6_BASE, default http://localhost:4406).
import { runAll, closeLive } from "./lib.mjs";
const A = process.argv.slice(2);
const arg = (k) => (A.includes(k) ? A[A.indexOf(k) + 1] : null);
const block = arg("--block");
const FILES = { a: "./new-a-gates.mjs", b: "./new-b-money.mjs", c: "./new-c-states.mjs", d: "./new-d-screens.mjs", e: "./new-e-builders.mjs", f: "./new-f-rules.mjs", g: "./new-g-judgment.mjs" };
for (const [b, f] of Object.entries(FILES)) {
  if (block && !block.split(",").includes(b)) continue;
  try { await import(f); } catch (e) { if (e.code === "ERR_MODULE_NOT_FOUND" && String(e.message).includes(f.slice(2))) continue; throw e; }
}
const rows = await runAll({ ledger: A.includes("--ledger"), quiet: A.includes("--quiet"), only: arg("--only"), json: arg("--json") });
await closeLive();
process.stdout.write("", () => process.exit(rows.some((r) => r.mark === "❌") ? 1 : 0));
