// scripts/sweep/t16s10/run.mjs — run sweep #10 T16's re-run (and later, new) suites.
//   node scripts/sweep/t16s10/run.mjs --suite static [--only P19309,P19310] [--json out.json] [--base http://localhost:4416]
import { writeFileSync } from "node:fs";
import { runAll } from "./lib.mjs";
const argv = process.argv.slice(2);
const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const suites = (val("--suite") || "static").split(",");
for (const s of suites) await import(`./${s.startsWith("new") ? s : "rerun-" + s}.mjs`);
const only = val("--only") ? new Set(val("--only").split(",")) : null;
const rows = await runAll({ only, quiet: argv.includes("--quiet"), file: val("--file"), bail: argv.includes("--bail") });
if (process.env.T16_COV) { const b = await import("./browser.mjs"); await b.closeBrowser(); }   // writes the last pages' coverage
const n = (m) => rows.filter((r) => r.mark === m).length;
console.log(`\nt16s10 ${suites.join("+")} — ${rows.length} rows: ${n("✅")} ✅ · ${n("❌")} ❌ · ${n("⏭")} ⏭`);
if (val("--json")) writeFileSync(val("--json"), JSON.stringify(rows, null, 1));
if (argv.includes("--browser-close")) process.exit(n("❌") ? 1 : 0);
process.exitCode = n("❌") ? 1 : 0;
