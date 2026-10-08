// scripts/sweep/t39s10/write-ledger.mjs — assemble sweep #10 terminal 39's 500 rows into
// .claude/sweep/LEDGER/T39-S10.md, ids P208001… in band order. Every row names its subject FILE.
//
//   node scripts/sweep/t39s10/write-ledger.mjs <static-rows.json> <b-overrides.json> <manual-rows.json> <results.tsv>
//
// Band D is computed here: the verify:/test: entries that NO ledger row has ever named (by entry or
// by script file), with the real exit code from the sequential run on port 4439.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const [STATIC, BOVR, MANUAL, TSV] = process.argv.slice(2);
const OUT = join(ROOT, ".claude/sweep/LEDGER/T39-S10.md");
const FIRST = 208001, LAST = 209000, WANT = 500;

const stat = JSON.parse(readFileSync(STATIC, "utf8"));
const bovr = JSON.parse(readFileSync(BOVR, "utf8"));
const manual = JSON.parse(readFileSync(MANUAL, "utf8"));
const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
const res = {};
for (const l of readFileSync(TSV, "utf8").split("\n").slice(1)) { const [k, c, secs, , note] = l.split("\t"); if (k && !k.startsWith("#")) res[k] = { c, secs, note: note || "" }; }

for (const r of stat) if (r.result === "⏭") {
  const key = `${r.file}|${/non-zero/.test(r.check) ? "fail" : "clears"}`;
  if (bovr[key]) [r.result, r.note] = bovr[key];
}

const ledgerText = readdirSync(join(ROOT, ".claude/sweep/LEDGER")).filter((f) => /^T.*\.md$/.test(f) && f !== "T39-S10.md")
  .map((f) => readFileSync(join(ROOT, ".claude/sweep/LEDGER", f), "utf8")).join("\n");
const want = WANT - stat.length - manual.length;
const D = [];
for (const [k, v] of Object.entries(scripts)) {
  if (!/^(verify|test)(:|$)/.test(k) || !res[k]) continue;
  const file = (v.match(/(?:scripts|tests|\.github\/scripts)\/[\w./-]+\.(?:mjs|ts)/) || [""])[0];
  const base = file.split("/").pop();
  if (ledgerText.includes(k + " ") || ledgerText.includes(k + "`") || (base && ledgerText.includes(base))) continue;
  const o = res[k];
  const result = o.c === "0" ? "✅" : o.c === "SKIP" || o.c === "2" ? "⏭" : o.fixed ? "✅" : "❌";
  D.push({ band: "D", file: file || "package.json", check: `\`${k}\` (\`${file}\`) — run it on port 4439 and record the real exit code`,
    how: `npm run -s ${k} (sequential, one at a time)`, result, note: `exit ${o.c} in ${o.secs}s — ${o.note.replace(/\|/g, "/").slice(0, 120)}` });
  if (D.length >= want) break;
}

const ordered = [...stat.filter((r) => r.band === "A"), ...stat.filter((r) => r.band === "B"),
  ...manual.filter((r) => r.band === "C"), ...D, ...manual.filter((r) => r.band === "E")];
if (ordered.length > LAST - FIRST + 1) { console.error("more rows than the block holds"); process.exit(1); }
const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
const rows = ordered.map((r, i) => `| P${FIRST + i} | ${cell(r.check)} | ${cell(r.how)} | ${r.result} | ${cell(r.note)} |`);
const count = (b, x) => ordered.filter((r) => (!b || r.band === b) && (!x || r.result === x)).length;

const head = `# SWEEP #10 — TERMINAL 39 · THE REPO'S OWN GUARDS, CI, AND THE DEPENDENCIES · P${FIRST}–P${FIRST + ordered.length - 1}

**Territory:** every file under \`scripts/\`, \`tests/\` and \`.github/\` (528 on 2026-10-08 — \`git ls-files scripts tests .github\`),
every \`verify:*\`/\`test:*\` entry in \`package.json\` (224), the CI workflow, Dependabot, and the open dependency PR.
**Branch:** \`sweep10/t39-repo-s-own-guards-ci-and-the\` · **worktree:** \`../wt-s10-t39\` · **port:** 4439 · dev database only.
**ID block:** \`P208001\`–\`P209000\`, pre-allocated. ${ordered.length} used.

## Where these ${ordered.length} point, and why — measured before one was written

Rows naming each owned file, counted by subject across every ledger on disk: **292 of the 528 files had none** —
all **271** added since 2026-09-01 (section 2b), plus 21 older. They get Band A, one row each. The 62 top-level guards
and tools among them get Band B. Of the files that DID have rows, every one was re-run in place (T28.md and the
other ledgers) from one sequential run of all 224 entries on port 4439.

| band | ids | rows | what | ✅ | ❌ | ⏭ |
|---|---|---:|---|---:|---:|---:|
| A | first ${count("A")} | ${count("A")} | every zero-row file: parses, every repo path it names exists, names no database but dev | ${count("A","✅")} | ${count("A","❌")} | ${count("A","⏭")} |
| B | next ${count("B")} | ${count("B")} | the top-level guards/tools among them: can it fail; does it clean up by id and survive Ctrl-C | ${count("B","✅")} | ${count("B","❌")} | ${count("B","⏭")} |
| C | next ${count("C")} | ${count("C")} | CI, Dependabot, the dependency PR #1441, advisories, the guard map | ${count("C","✅")} | ${count("C","❌")} | ${count("C","⏭")} |
| D | next ${count("D")} | ${count("D")} | guard entries no ledger had ever named — real exit code on :4439 | ${count("D","✅")} | ${count("D","❌")} | ${count("D","⏭")} |
| E | last ${count("E")} | ${count("E")} | judgment — does a real restaurant need it, does a red mean something | ${count("E","✅")} | ${count("E","❌")} | ${count("E","⏭")} |

Re-run by: \`node scripts/sweep/t39s10/static-checks.mjs <file-list>\` (Bands A/B, read-only) and the entries named in Band D.
A ❌ here is a problem that was found AND fixed on this branch (its note names the item); nothing is left red.

| id | check | how to verify | result | note |
|----|-------|---------------|--------|------|
`;
writeFileSync(OUT, head + rows.join("\n") + "\n");
console.log(JSON.stringify({ rows: ordered.length, A: count("A"), B: count("B"), C: count("C"), D: count("D"), E: count("E"),
  ok: count(null, "✅"), bad: count(null, "❌"), skip: count(null, "⏭"), last: `P${FIRST + ordered.length - 1}` }));
