// scripts/sweep/t10s10/run.mjs — sweep #10 terminal 10's 500 new checks, P179001–P180000.
//   node scripts/sweep/t10s10/run.mjs [--quiet] [--ledger] [--only P179123] [--block a|b|c|d|e|f|g]
// Blocks: g = the item guards, line by line · a = logins + restaurant separation, every endpoint ·
// b = the states a normal day never visits · c = money and compliance rules, driven ·
// d = the database functions this half calls · e = project-rule conformance · f = live + screens.
import { runAll } from "./lib.mjs";

const argv = process.argv.slice(2);
const pick = argv.includes("--block") ? argv[argv.indexOf("--block") + 1] : null;
for (const b of ["g", "a", "b", "c", "d", "e", "f"]) {
  if (pick && pick !== b) continue;
  try { await import(`./new-${b}.mjs`); } catch (e) { if (!/Cannot find module/.test(String(e && e.message))) throw e; }
}
await runAll({ ledger: argv.includes("--ledger"), quiet: argv.includes("--quiet"),
  only: argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null });
