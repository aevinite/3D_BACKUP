// scripts/sweep/t10s10/run.mjs — sweep #10 terminal 10's 500 new checks, P179001–P180000.
//   node scripts/sweep/t10s10/run.mjs [--quiet] [--ledger] [--only P179123] [--block a|b|c|d|e|f|g]
// Blocks: g = the item guards, line by line · a = logins + restaurant separation, every endpoint ·
// b = the states a normal day never visits · c = money and compliance rules, driven ·
// d = the database functions this half calls · e = project-rule conformance · f = live + screens.
import { runAll } from "./lib.mjs";

const argv = process.argv.slice(2);
const pick = argv.includes("--block") ? argv[argv.indexOf("--block") + 1].split(",") : null;
for (const b of ["g", "a", "b", "c", "d", "e", "f", "r3"]) {
  if (pick && !pick.includes(b)) continue;
  try { await import(`./new-${b}.mjs`); } catch (e) { if (!/Cannot find module/.test(String(e && e.message))) throw e; }
}
const rows = await runAll({ ledger: argv.includes("--ledger"), quiet: argv.includes("--quiet"), bail: argv.includes("--bail"),
  only: argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null });
// A red check must FAIL the process — the mutation runner reads only the exit code. (Round 3 found
// this missing: 533 planted breaks all read as "survived" while their checks were in fact red.)
process.exitCode = rows.some((r) => r.mark === "❌") ? 1 : 0;
