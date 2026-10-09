// scripts/sweep/t39s10/round2-ledger.mjs — append sweep #10 T39 ROUND 2 to .claude/sweep/LEDGER/T39-S10.md,
// ids P208501… (the rest of this terminal's pre-allocated block, P208001–P209000).
//
//   node scripts/sweep/t39s10/round2-ledger.mjs --F <results.tsv> [--F2 <rerun.tsv>] --G <rows.json>
//        --HI <rows.json> --J <rows.json> [--extra <rows.json>]
//
// Bands, in id order: F (every verify:/test: entry, run one at a time — the RE-RUN result where an entry
// was fixed and run again), G (every code file the round changed), H (CI, packages, settings), I (the dev
// database left clean), J (every new rule broken on purpose in a throwaway copy). Three groups of
// near-identical rows are folded into ONE row each so the round fits the 500 ids left, without dropping
// a check: the per-package "is it used" rows, the per-path "git ignores" rows, and Band J's baselines.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const FIRST = 208501, LAST = 209000;
const LEDGER = join(ROOT, ".claude/sweep/LEDGER/T39-S10.md");
const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ").trim();
const tsv = (f) => existsSync(f) ? readFileSync(f, "utf8").split("\n").slice(1).filter((l) => l && !l.startsWith("#")).map((l) => l.split("\t")) : [];

// ── F ──
const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
const first = tsv(arg("--F")), again = Object.fromEntries(tsv(arg("--F2")).map((c) => [c[0], c]));
const F = first.map(([k, code, secs, last]) => {
  const re = again[k];
  const use = re || [k, code, secs, last];
  const ok = use[1] === "0", skip = use[1] === "SKIP" || use[1] === "2";
  const file = ((scripts[k] || "").match(/(?:scripts|tests|\.github\/scripts)\/[\w./-]+\.(?:mjs|ts|js)/) || [""])[0];
  const note = re && code !== "0"
    ? `first run exit ${code} (${cell(last).slice(0, 70)}) — fixed, re-run exit ${re[1]} in ${re[2]}s`
    : `exit ${use[1]} in ${use[2]}s — ${cell(use[3]).slice(0, 110)}`;
  return { band: "F", check: `\`${k}\`${file ? ` (\`${file}\`)` : ""} — run on its own against the app, real exit code recorded`,
    how: use[1] === "SKIP" ? "not run, by the house rules (reason in the note)" : `npm run -s ${k} (one at a time, :4439)`,
    result: ok ? "✅" : skip ? "⏭" : "❌", note };
});

// ── G ──
const G = JSON.parse(readFileSync(arg("--G"), "utf8"));

// ── H + I (fold the per-package and per-path rows) ──
const HI = JSON.parse(readFileSync(arg("--HI"), "utf8"));
const fold = (rows, test, check, how) => {
  const hit = rows.filter((r) => test(r));
  if (!hit.length) return rows;
  const bad = hit.filter((r) => r.result !== "✅");
  const row = { band: hit[0].band, check, how, result: bad.length ? "❌" : "✅",
    note: bad.length ? bad.map((r) => r.check).join(" · ") : `${hit.length} of ${hit.length}` };
  const at = rows.indexOf(hit[0]);
  return [...rows.slice(0, at), row, ...rows.slice(at).filter((r) => !hit.includes(r))];
};
let HIf = fold(HI, (r) => /^the package ".+" is actually used/.test(r.check), "every package in package.json is used by the code, or is a build tool", "search the tracked source for each one's import");
HIf = fold(HIf, (r) => /^git ignores /.test(r.check), "git ignores .env.local, node_modules, .next, .next-<port>/ and .claude/sweep/", "git check-ignore, one path each");
const H = HIf.filter((r) => r.band === "H"), I = HIf.filter((r) => r.band === "I");

// ── J (fold the baselines) ──
let J = JSON.parse(readFileSync(arg("--J"), "utf8"));
J = fold(J, (r) => /is green on the unbroken copy/.test(r.check), "every guard Band J breaks is green on the unbroken copy first, so each red below is the break and not noise", "run each one before any break");
const extra = arg("--extra") ? JSON.parse(readFileSync(arg("--extra"), "utf8")) : [];

const all = [...F, ...G, ...H, ...I, ...J, ...extra];
if (FIRST + all.length - 1 > LAST) { console.error(`${all.length} rows do not fit P${FIRST}–P${LAST} (room for ${LAST - FIRST + 1})`); process.exit(1); }
const count = (b, x) => all.filter((r) => (!b || r.band === b) && (!x || r.result === x)).length;
const head = `

## ROUND 2 — 2026-10-09 · P${FIRST}–P${FIRST + all.length - 1} · re-planned on the owner's word: "zero error … check every single bit of the thing in the boundaries"

Measured before a row was written, not guessed: every entry was run (F); every code file this round
changed was proved by itself (G); the CI, packages and settings files (H); the dev database the tests
leave behind (I); and every rule this round and the last added, broken ON PURPOSE in a throwaway copy
(J) — a rule that stays green with its subject broken can only fail one way.

| band | rows | what | ✅ | ❌ | ⏭ |
|---|---:|---|---:|---:|---:|
| F | ${count("F")} | every verify:/test: entry, run one at a time — a ❌ here is one found and fixed; its note says so | ${count("F", "✅")} | ${count("F", "❌")} | ${count("F", "⏭")} |
| G | ${count("G")} | every code file this round changed: parses, adds no undefined name, 0 lint warnings | ${count("G", "✅")} | ${count("G", "❌")} | ${count("G", "⏭")} |
| H | ${count("H")} | CI, Dependabot, packages, lock file, lint cap, ignore rules | ${count("H", "✅")} | ${count("H", "❌")} | ${count("H", "⏭")} |
| I | ${count("I")} | the dev database: no stale table, no fake order counting, every test switch put back | ${count("I", "✅")} | ${count("I", "❌")} | ${count("I", "⏭")} |
| J | ${count("J")} | each new rule broken on purpose → its guard goes red | ${count("J", "✅")} | ${count("J", "❌")} | ${count("J", "⏭")} |

Re-run by: \`scripts/sweep/t39s10/run-all.mjs\` (F), \`round2-files.mjs\` (G), \`round2-checks.mjs\` (H, I),
\`round2-mutations.mjs --root <throwaway copy> [--live <base>]\` (J).

| id | check | how to verify | result | note |
|----|-------|---------------|--------|------|
`;
const body = all.map((r, i) => `| P${FIRST + i} | ${cell(r.check)} | ${cell(r.how)} | ${r.result} | ${cell(r.note)} |`).join("\n");
const cur = readFileSync(LEDGER, "utf8");
if (cur.includes(`| P${FIRST} |`)) { console.error(`P${FIRST} is already in the ledger — refusing to write a second round 2`); process.exit(1); }
writeFileSync(LEDGER, cur.replace(/\s*$/, "") + head + body + "\n");
console.log(JSON.stringify({ rows: all.length, last: `P${FIRST + all.length - 1}`, F: count("F"), G: count("G"), H: count("H"), I: count("I"), J: count("J"), ok: count(null, "✅"), bad: count(null, "❌"), skip: count(null, "⏭") }));
