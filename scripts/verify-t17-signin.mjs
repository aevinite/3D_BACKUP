#!/usr/bin/env node
// verify:t17-signin — sweep #10 T17 round 5's hermetic harness, kept so its checks can be RE-RUN (round 4's were lost
// when its scratch harness was deleted — the reason this exists).
//
// Every suite in scripts/t17-harness/ runs the REAL sign-in files (routes, gates, libraries, and the five screen files
// compiled on the fly by esbuild) against an in-memory database that can fail on purpose. Nothing leaves the machine:
// any fetch a check has not replaced is refused and recorded. No environment is read — the harness sets its own
// throwaway secrets. ~460 checks; the ledger rows are T17-S10.md round 5.
//
//   npm run verify:t17-signin              all suites
//   T17_SAVE=/some/dir npm run verify:t17-signin   also write each suite's rows as JSON there
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url)); const dir = join(here, "t17-harness"); const root = join(here, "..");
const suites = readdirSync(dir).filter((f) => /^u-.*\.mjs$/.test(f)).sort();
let total = 0, failed = 0; const bad = [];
for (const s of suites) {
  const r = spawnSync(process.execPath, ["--max-old-space-size=3072", join(dir, s)], { cwd: root, env: { ...process.env, T17_QUIET: "1" }, encoding: "utf8", timeout: 600000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const m = out.match(/(\d+) rows · (\d+) ✅ · (\d+) ❌/);
  const n = m ? +m[1] : 0, f = m ? +m[3] : 1;
  total += n; failed += f;
  if (r.status !== 0 || !m || f > 0) { bad.push(s); console.log(`✗ ${s} — ${m ? `${f} of ${n} failed` : `did not finish (exit ${r.status})`}`); for (const l of out.split("\n").filter((x) => x.startsWith("❌")).slice(0, 10)) console.log("   " + l); if (!m) console.log(out.split("\n").filter((x) => !/MODULE_TYPELESS|Reparsing|eliminate|trace-warnings/.test(x)).slice(-8).join("\n")); }
  else console.log(`✓ ${s} — ${n} checks`);
}
console.log(bad.length ? `\n✗ FAIL — ${failed} of ${total} checks failed in ${bad.length} suite(s)` : `\n✓ PASS — ${total} checks in ${suites.length} suites`);
process.exit(bad.length ? 1 : 0);
