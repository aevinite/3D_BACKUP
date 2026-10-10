// scripts/sweep/t18s10/r2/run.mjs — sweep #10 T18 round 2: every check, in a fixed order.
//
//   node --import ./scripts/sweep/t18s10/r2/hooks.mjs scripts/sweep/t18s10/r2/run.mjs [--only=a,b] [--bail] [--quiet] [--no-live]
//
// Blocks a–f run in memory against the REAL lib/*.ts (database client stubbed, network refused).
// Block g drives the real app on T18_BASE (default http://localhost:4418) and is skipped by --no-live.
// Results: node_modules/.cache/t18s10/r2.{json,md}. Writes nothing else.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { results, Bail, ROOT, QUIET } from "./core.mjs";

const only = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1]?.split(",");
const live = !process.argv.includes("--no-live");
const BLOCKS = ["a-tree", "b-model", "c-caps", "d-profile", "e-feat", "f-docs", "h-extra", "i-kill", "g-live"];
let bailed = null;
for (const b of BLOCKS) {
  if (only && !only.includes(b[0])) continue;
  if (b === "g-live" && !live) continue;
  try { await import(`./${b}.mjs`); }
  catch (e) {
    if (e instanceof Bail) { bailed = e.message; break; }
    if (e?.code === "ERR_MODULE_NOT_FOUND" && String(e.message).includes(`/${b}.mjs`)) continue;
    console.log(`❌ block ${b} crashed: ${e?.stack || e}`); bailed = `crash:${b}`; break;
  }
}
const n = (k) => results.filter((r) => r.result === k).length;
const dir = join(ROOT, "node_modules", ".cache", "t18s10"); mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "r2.json"), JSON.stringify(results, null, 1));
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
writeFileSync(join(dir, "r2.md"), results.map((r) => `| ${r.id} | \`${r.file}\` — ${esc(r.check)} | ${esc(r.how)} | ${r.result} | ${esc(r.note)} |`).join("\n") + "\n");
if (!QUIET || bailed) console.log(`r2: ${results.length} rows · ✅ ${n("✅")} · ❌ ${n("❌")} · ⏭ ${n("⏭")}${bailed ? ` · stopped at ${bailed}` : ""}`);
if (!QUIET) for (const r of results.filter((x) => x.result === "❌")) console.log(`  ❌ ${r.id} ${r.check} — ${r.note}`);
process.stdout.write("", () => process.exit(bailed || n("❌") ? 1 : 0));
