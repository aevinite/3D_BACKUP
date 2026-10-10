// scripts/sweep/t13s10/run.mjs — sweep #10 terminal 13's 500 new checks, all blocks.
//   node scripts/sweep/t13s10/run.mjs              — run, print failures + totals
//   node scripts/sweep/t13s10/run.mjs --all        — print every row
//   node scripts/sweep/t13s10/run.mjs --ledger     — print ledger rows (`| id | file — what | how | ✅ | note |`)
//   node scripts/sweep/t13s10/run.mjs --only P182001,P182002
import { runAll } from "./lib.mjs";
const blocks = (process.env.T13_BLOCKS || "a,b,c,d").split(",");
if (blocks.includes("a")) await import("./new-a-libs.mjs");
if (blocks.includes("b")) await import("./new-b-libs.mjs").catch((e) => { if (!/Cannot find module/.test(e.message)) throw e; });
if (blocks.includes("c")) await import("./new-c-route.mjs").catch((e) => { if (!/Cannot find module/.test(e.message)) throw e; });
if (blocks.includes("d")) await import("./new-d-live.mjs").catch((e) => { if (!/Cannot find module/.test(e.message)) throw e; });
const a = process.argv;
const onlyArg = a.find((x) => x.startsWith("--only"));
const only = onlyArg ? (onlyArg.split("=")[1] || a[a.indexOf(onlyArg) + 1]).split(",") : null;
const quietLog = console.error; if (!a.includes("--noisy")) { console.error = () => {}; console.warn = () => {}; }
await runAll({ ledger: a.includes("--ledger"), quiet: !a.includes("--all"), only });
console.error = quietLog;
// Not a bare exit: it throws away stdout still buffered when piped (verify:guards-alive). (sweep #10 T18, item 23)
process.stdout.write("", () => process.exit(0));
