// Build the T17 ledger rows FROM A REAL RUN of the three suites — never by hand. Every row's
// result column is the result the suite actually printed this run, so the ledger cannot drift
// from the checks it claims to record.
//
//   node scripts/sweep/t17/rows.mjs            → prints the markdown table rows
//   node scripts/sweep/t17/rows.mjs --write    → splices them into .claude/sweep/LEDGER/T17.md
import { execSync } from "node:child_process";
import fs from "node:fs";

const SUITES = [
  ["node scripts/verify-owner-shell.mjs", "`npm run verify:owner-shell` — static, comments stripped"],
  ["node scripts/sweep/t17/report-checks.mjs", "`node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder"],
  ["node scripts/sweep/t17/live.mjs", "`node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3"],
  ["node scripts/sweep/t17/interact.mjs", "`node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would"],
];
const rows = [];
for (const [cmd, how] of SUITES) {
  let out = "";
  try { out = execSync(cmd, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { out = String(e.stdout || "") + String(e.stderr || ""); }
  for (const line of out.split("\n")) {
    // "✅ P70701 what — note"  ·  "  ✅ §1 what"  (the guard numbers its sections, not its rows)
    const m = line.match(/^\s*(✅|❌)\s+(P\d{5,6})\s+(.*)$/);
    if (m) { const [, mark, id, rest] = m;
      const [what, note] = rest.split(/ — (?!.* — )/);
      rows.push([id, what.trim(), how, mark, (note || "").trim()]); continue; }
    const g = line.match(/^\s*(✅|❌)\s+(§[\d.]+)\s+(.*)$/);
    if (g) rows.push([null, `${g[2]} ${g[3]}`.trim(), how, g[1], ""]);
  }
}
// The guard prints §-numbered checks with no id of their own; give them ids from the front of the
// block, in the order they run, so a row is re-runnable by number like every other.
let n = 70701;
for (const r of rows) if (r[0] === null) r[0] = "P" + (n++);
const esc = (s) => String(s).replace(/\|/g, "\\|");
const table = rows.map((r) => `| ${r[0]} | ${esc(r[1])} | ${esc(r[2])} | ${r[3]} | ${esc(r[4])} |`).join("\n");
const green = rows.filter((r) => r[3] === "✅").length;
console.log(`# ${rows.length} rows (${green} ✅, ${rows.length - green} ❌)  ·  ids ${rows[0][0]}–${rows[rows.length - 1][0]}\n`);
console.log(table);
if (process.argv.includes("--write")) {
    // NOT `T17.md` — that file is sweep #6's ADMIN health/logs territory, 1,035 rows, and a
  // terminal NUMBER does not identify a territory any more. See this file's own header.
  const p = ".claude/sweep/LEDGER/T17-owner-console.md";
  const src = fs.readFileSync(p, "utf8");
  const A = "<!-- ROWS:START -->", B = "<!-- ROWS:END -->";
  if (!src.includes(A) || !src.includes(B)) { console.error(`refusing to write: ${p} has no ROWS markers`); process.exit(1); }
  const head = "| id | what it checks | how | result | note |\n|---|---|---|---|---|";
  fs.writeFileSync(p, src.slice(0, src.indexOf(A) + A.length) + "\n" + head + "\n" + table + "\n" + src.slice(src.indexOf(B)));
  console.log(`\nwrote ${rows.length} rows into ${p}`);
}
