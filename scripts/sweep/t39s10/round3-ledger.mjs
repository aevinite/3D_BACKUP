// scripts/sweep/t39s10/round3-ledger.mjs — append sweep #10 T39 ROUND 3 to .claude/sweep/LEDGER/T39-S10.md,
// ids from P164001 (the block claimed on main for round 3, P164001–P164999).
//
//   node scripts/sweep/t39s10/round3-ledger.mjs --K <rows.json> --L <rows.json> --M <rows.json>
//
// Bands, in id order: K (EVERY file under scripts/, tests/, .github/ — verify:every-script's rows), L
// (every old read-only tool that is no package entry, really run, and the ones not run with why), M
// (each round-3 fix and rule broken on purpose and seen to go red).
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const FIRST = 164001, LAST = 164999;
const LEDGER = join(ROOT, ".claude/sweep/LEDGER/T39-S10.md");
const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ").trim();
const load = (n) => JSON.parse(readFileSync(arg(n), "utf8"));
const all = [...load("--K"), ...load("--L"), ...load("--M")];
if (FIRST + all.length - 1 > LAST) { console.error(`${all.length} rows do not fit P${FIRST}–P${LAST} — claim more on main first`); process.exit(1); }
const ok = all.filter((r) => r.result === "✅").length;
const head = `

## ROUND 3 — 2026-10-10 · P${FIRST}–P${FIRST + all.length - 1} · the owner: "covering all the area within your boundaries like every single bit of area"

Round 2 gave rows to the 231 files behind a package entry and the 183 files it changed — not to the rest of the 639. Round 3 gives
EVERY file its own row (band K, ${load("--K").length} rows — now the standing guard \`verify:every-script\`, in CI), really runs every
old tool that only reads (band L), and breaks each new rule on purpose (band M). ${ok} of ${all.length} ✅.

| id | check | how to verify | result | note |
|---|---|---|---|---|
`;
const body = all.map((r, i) => `| P${FIRST + i} | ${cell(r.check)} | ${cell(r.how)} | ${r.result} | ${cell(r.note)} |`).join("\n");
const cur = readFileSync(LEDGER, "utf8");
if (cur.includes(`| P${FIRST} |`)) { console.error(`P${FIRST} is already in the ledger — refusing to write a second round 3`); process.exit(1); }
writeFileSync(LEDGER, cur.replace(/\s*$/, "") + head + body + "\n");
console.log(JSON.stringify({ rows: all.length, ok, first: `P${FIRST}`, last: `P${FIRST + all.length - 1}` }));
