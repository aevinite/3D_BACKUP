// run.mjs — T28's round-2 five hundred.  npm run verify:t28-r2 -- --base http://localhost:4428
import { contexts, runBlocks, report, requireServer, cleanup } from "./harness.mjs";
await requireServer();
const only = (() => { const i = process.argv.indexOf("--only"); return i > -1 ? process.argv[i + 1] : null; })();
const all = [];
for (const [key, mod] of [["A", "./a-staff.mjs"], ["B", "./b-analytics.mjs"], ["C", "./c-ownerscope.mjs"],
  ["D", "./d-reports.mjs"], ["E", "./e-customers.mjs"], ["F", "./f-inventory.mjs"], ["G", "./g-settings.mjs"],
  ["H", "./h-small-doors.mjs"], ["I", "./i-platform.mjs"], ["J", "./j-rest.mjs"]]) {
  if (only && !only.split(",").includes(key)) continue;
  try { const m = await import(mod); all.push(m[key]); } catch (e) { if (!/Cannot find module/.test(String(e))) throw e; }
}
const ctx = await contexts();
let bad = 0;
try {
  const results = await runBlocks(all, ctx);
  bad = report(results, "T28 round 2");
} finally {
  await cleanup();
  await ctx.browser.close();
}
process.exit(bad ? 1 : 0);
