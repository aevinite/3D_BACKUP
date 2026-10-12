// node scripts/sweep/t15s10/run.mjs [--banks a,b,…] [--ids P184001,P184002]
// Sweep #10 · terminal 15 — the print queue and the print helper. Every bank, then one report.
import { report, runFinishers } from "./lib.mjs";
const all = ["a-setup-code", "b-station", "c-helper-file", "d-queue", "e-helpers", "f-agent-door", "g-owner-route", "h-admin-board", "i-setup-guide", "j-docs"];
const i = process.argv.indexOf("--banks");
const pick = i > 0 ? all.filter((b) => process.argv[i + 1].split(",").some((x) => b.startsWith(x))) : all;
try { for (const b of pick) await import(`./${b}.mjs`); }
finally { await runFinishers(); try { (await import("./env.mjs")).closeBrowser(); } catch {} }
const r = report("t15s10");
process.exit(r.fail ? 1 : 0);
