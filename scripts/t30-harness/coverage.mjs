// scripts/t30-harness/coverage.mjs — which lines and branches of MY files did the suite never run?
//   node scripts/t30-harness/coverage.mjs [--strict]
// Runs cov.test.mjs under Node's built-in coverage (lcov), then reports, per territory file, line and
// branch coverage and every line / branch that never executed. --strict exits 1 unless every file is
// at 100% lines and 100% branches (the bar for "every bit of my files ran").
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { root } from "./hooks.mjs";
const FILES = ["lib/tax.ts", "lib/taxFiling.ts", "lib/paySplit.ts", "lib/payments.ts", "lib/discountCap.ts", "lib/clash.ts", "lib/clashCompare.ts", "lib/idempotency.ts", "lib/idempotencyRule.ts", "lib/dbRefusal.ts", "lib/readGuard.ts", "lib/money.ts", "lib/money.mjs", "lib/orderAllergies.ts"];
// Branches PROVEN unreachable, each by its own check in ./u-proofs.mjs (which fails the suite if the
// proof stops holding). Anything else that never runs is a gap.
// Matched by the LINE'S TEXT, not its number, so an edit above them cannot silently move the allowance
// onto some other line (a 4-line comment added in item 23 did exactly that to a by-number list).
const UNREACHABLE = {
  "lib/taxFiling.ts": [/for \(let k = order\.length - 1; left < 0/, /r\.parts\[j\] \?\? 0/],
  "lib/clash.ts": [/if \(isPlainObject\(v\)\) return "something different now";/],
  "lib/paySplit.ts": [/const name = String\(laterPart\.khataName \|\| ""\)/, /if \(!name\) return \{ ok: false, status: 400/, /const amount = Math\.round\(\(live \|\| \[\]\)/],
  "lib/discountCap.ts": [/const d = node \? Number\(defOf\(node\)\) : NaN;/, /return Number\.isFinite\(d\) && d > 0 \? d : null;/],
  "lib/idempotency.ts": [/update\(\{ done: true, result: result \?\? null \}\)/],
};
const lineText = (f, n) => (readFileSync(join(root, f), "utf8").split("\n")[n - 1] || "");
const out = join(root, "node_modules/.cache/t30-cov.info");
try {
  execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", "./scripts/t30-harness/hooks.mjs", "--experimental-test-coverage",
    "--test-reporter=lcov", `--test-reporter-destination=${out}`, "--test-reporter=dot", "--test-reporter-destination=stdout", "--test", "scripts/t30-harness/cov.test.mjs"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
} catch (e) { console.log(String(e.stdout || "").slice(-600)); console.log("the suite itself failed — fix that first"); process.exit(2); }
const info = readFileSync(out, "utf8").split("end_of_record");
let allFull = true;
for (const f of FILES) {
  const rec = info.find((r) => r.includes(`SF:${join(root, f)}\n`) || r.includes(`SF:${f}\n`));
  if (!rec) { console.log(`✗ ${f}: never loaded`); allFull = false; continue; }
  const num = (k) => Number((rec.match(new RegExp(`^${k}:(\\d+)`, "m")) || [])[1] || 0);
  const lines = [...rec.matchAll(/^DA:(\d+),0$/gm)].map((m) => Number(m[1]));
  const br = [...rec.matchAll(/^BRDA:(\d+),\d+,\d+,(0|-)$/gm)].map((m) => Number(m[1])).filter((l) => !(UNREACHABLE[f] || []).some((re) => re.test(lineText(f, l))));
  const full = !lines.length && !br.length;
  allFull &&= full;
  console.log(`${full ? "✓" : "✗"} ${f}: lines ${num("LH")}/${num("LF")} · branches ${num("BRH")}/${num("BRF")} · functions ${num("FNH")}/${num("FNF")}${lines.length ? ` · lines never run: ${lines.join(",")}` : ""}${br.length ? ` · branches never taken at lines: ${[...new Set(br)].join(",")}` : ""}`);
}
rmSync(out, { force: true });
console.log(allFull ? `\n✓ every line and every branch of the ${FILES.length} code files ran` : "\n✗ some code never ran (above)");
process.exit(process.argv.includes("--strict") && !allFull ? 1 : 0);
