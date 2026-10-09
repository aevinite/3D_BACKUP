// scripts/sweep/t39s10/round2-files.mjs — sweep #10 T39 round 2, Band G: one row for EVERY code file
// this round changed. Each must (1) parse, (2) use no name it does not define — counted against the
// same file at the round's starting commit, so a pre-existing browser global is not blamed on today —
// and (3) carry zero lint warnings.
//
//   node scripts/sweep/t39s10/round2-files.mjs --since <commit> --out <rows.json>
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const require = createRequire(join(ROOT, "package.json"));
const { Linter, ESLint } = require("eslint");
const globals = require("globals");
const argv = process.argv.slice(2);
const SINCE = argv[argv.indexOf("--since") + 1];
const OUT = argv[argv.indexOf("--out") + 1];
const files = execFileSync("git", ["diff", "--name-only", "--diff-filter=AM", SINCE, "HEAD"], { cwd: ROOT, encoding: "utf8" })
  .split("\n").filter((f) => /\.(mjs|js|cjs)$/.test(f));
const linter = new Linter();
const cfg = [{ languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node, ...globals.browser, ...globals.es2021 } }, rules: { "no-undef": "error" } }];
const undef = (src, f) => linter.verify(src, cfg, { filename: f }).filter((m) => m.ruleId === "no-undef").map((m) => m.message);
const eslint = new ESLint({ cwd: ROOT });
const lintRes = await eslint.lintFiles(files);
const warnOf = Object.fromEntries(lintRes.map((r) => [r.filePath.slice(ROOT.length + 1), r.warningCount + r.errorCount]));
const rows = [];
for (const f of files) {
  const parse = spawnSync(process.execPath, ["--check", f], { cwd: ROOT }).status === 0;
  const now = undef(readFileSync(join(ROOT, f), "utf8"), f);
  let before = [];
  try { before = undef(execFileSync("git", ["show", `${SINCE}:${f}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 }), f); } catch { /* new file */ }
  const added = now.length > before.length ? now.filter((m) => !before.includes(m)) : [];
  const w = warnOf[f] ?? 0;
  const ok = parse && !added.length && w === 0;
  rows.push({ band: "G", file: f, check: `\`${f}\` — parses, uses no name it does not define, and carries no lint warning`,
    how: "node --check · eslint no-undef against its own pre-round version · eslint", result: ok ? "✅" : "❌",
    note: ok ? `0 warnings · ${now.length} pre-existing global(s) unchanged` : `${parse ? "" : "does not parse · "}${added.length ? "new undefined: " + [...new Set(added)].join("; ") + " · " : ""}${w ? w + " lint warning(s)" : ""}` });
}
writeFileSync(OUT, JSON.stringify(rows, null, 1));
console.log(JSON.stringify({ G: rows.length, bad: rows.filter((r) => r.result === "❌").length }));
for (const r of rows.filter((x) => x.result === "❌")) console.log("❌", r.file, "—", r.note);
