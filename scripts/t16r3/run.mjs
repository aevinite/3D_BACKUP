// scripts/t16r3/run.mjs — run the round-3 test of the shared panel plumbing.
//   node scripts/t16r3/run.mjs [--family A,B] [--only R3-A-001] [--json out.json] [--quiet] [--bail]
//   npm run verify:panel-plumbing-r3          (every family; no app, no database, its own server)
import { writeFileSync } from "node:fs";
import { runChecks } from "./lib.mjs";
const argv = process.argv.slice(2);
const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const FAMILIES = { A: "fa-queue-sequences", B: "fb-random-inputs", C: "fc-engines", D: "fd-access", E: "fe-layout", F: "ff-routes", G: "fg-faults", H: "fh-cost", I: "fi-offline", J: "fj-live", K: "fk-drawers", L: "fl-small", M: "fm-routes2", N: "fn-third-pass", O: "fo-mutation-aimed" };
const want = val("--family") ? val("--family").split(",") : Object.keys(FAMILIES);
const { existsSync } = await import("node:fs");
for (const f of want) { const p = new URL(`./${FAMILIES[f]}.mjs`, import.meta.url); if (existsSync(p)) await import(p.href); }
const server = await import("./server.mjs");
const rows = await runChecks({ families: new Set(want), only: val("--only") ? new Set(val("--only").split(",")) : null, quiet: argv.includes("--quiet"), bail: argv.includes("--bail") });
await server.shutdown();
const n = (m) => rows.filter((r) => r.mark === m).length;
const fam = {}; for (const r of rows) { fam[r.family] = fam[r.family] || { g: 0, r: 0, s: 0 }; fam[r.family][r.mark === "✅" ? "g" : r.mark === "❌" ? "r" : "s"]++; }
console.log(`\nverify:panel-plumbing-r3 — ${rows.length} checks: ${n("✅")} ✅ · ${n("❌")} ❌ · ${n("⏭")} ⏭   ` + Object.entries(fam).map(([k, v]) => `${k} ${v.g}/${v.g + v.r + v.s}`).join(" · "));
if (val("--json")) writeFileSync(val("--json"), JSON.stringify(rows, null, 1));
process.stdout.write("", () => process.exit(n("❌") ? 1 : 0));
