// scripts/sweep/t3s10/r3/run.mjs — sweep #10 terminal 3, ROUND 3: the replanned in-memory suite.
//   node --import ./scripts/sweep/t3s10/r3/hooks.mjs scripts/sweep/t3s10/r3/run.mjs [--areas B,C] [--bail] [--quiet]
// (npm run sweep:t3r3 does exactly that.) The live half is ./live.mjs. See ./h.mjs for the plan.
import { runAll } from "./h.mjs";
const a = process.argv; const val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
const areas = (val("--areas") || "B,C,D,E,F,H").split(",");
const quietLog = console.error; const quietWarn = console.warn;
if (!a.includes("--noisy")) { console.error = () => {}; console.warn = () => {}; }
for (const [k, f] of [["B", "./b-queue.mjs"], ["C", "./c-doors.mjs"], ["D", "./d-status.mjs"], ["E", "./e-menu.mjs"], ["F", "./f-gaps.mjs"], ["H", "./h-dead.mjs"]])
  if (areas.includes(k)) await import(f).catch((e) => { if (!/Cannot find module/.test(String(e))) throw e; });
const r = await runAll({ areas, bail: a.includes("--bail"), quiet: a.includes("--quiet"), only: val("--only")?.split(",") || null });
console.error = quietLog; console.warn = quietWarn;
process.stdout.write("", () => process.exit(r.bad ? 1 : 0));
