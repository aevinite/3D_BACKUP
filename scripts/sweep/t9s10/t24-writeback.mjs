// scripts/sweep/t9s10/t24-writeback.mjs — write a fresh run of sweep #8 T24's checks back into the
// ledger rows they belong to (sweep #10 T9, 2026-10-09).
//
//   T24_BASE=http://127.0.0.1:<your port> node scripts/sweep/t24-sweep.mjs --ledger > /tmp/run.md
//   node scripts/sweep/t9s10/t24-writeback.mjs /tmp/run.md [--dry]
//
// WHY BY WORDING AND NOT BY ID. The runner hands out ids from one counter in load order, and its
// generated "one row per database statement" block is ordered by (table, n-th read). So the moment
// the route gains or loses a read, every id AFTER that block shifts — on 2026-10-09 by +6, after
// four deliberate commits moved the per-table counts. The LEDGER's ids are the permanent record and
// must never be renumbered, so a fresh result is matched to its row by the row's own words (the
// `what` column, consumed in order so two rows with the same words each get their own answer).
// Ids that are not the runner's own (P04940, P19788, P06459 … — rows from older sweeps that the
// T24 runner re-executes under their ORIGINAL ids) never move, so those are matched by id, in
// whichever ledger file holds them.
//
// A ledger row the run no longer produces is marked RETIRED in place, never deleted.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LEDGER_DIR = join(ROOT, ".claude/sweep/LEDGER");
const OWN = "T24-S8.md";
const STAMP = "↻ S10-T9 re-run 2026-10-09 (round 2)";
const [runFile] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DRY = process.argv.includes("--dry");
if (!runFile) { console.error("usage: t24-writeback.mjs <runner --ledger output>"); process.exit(2); }

// Split a markdown table row on UNESCAPED pipes, keeping the escapes inside the cells.
const cells = (line) => {
  const out = []; let cur = ""; let esc = false;
  for (const ch of line.trim().replace(/^\|/, "").replace(/\|$/, "")) {
    if (esc) { cur += ch; esc = false; continue; }
    if (ch === "\\") { cur += ch; esc = true; continue; }
    if (ch === "|") { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
};
const isRow = (l) => /^\| P\d+ \|/.test(l);
const run = readFileSync(runFile, "utf8").split("\n").filter(isRow).map(cells)
  .map(([id, what, how, mark, note]) => ({ id, what, how, mark, note: note || "" }));
if (!run.length) { console.error("no rows in the run file"); process.exit(2); }
const RUNNER_ID = (id) => { const n = Number(id.slice(1)); return n >= 77701 && n <= 78700; };

// The runner's own rows, queued by wording. Foreign rows, keyed by id.
const byWhat = new Map();
for (const r of run.filter((r) => RUNNER_ID(r.id))) {
  if (!byWhat.has(r.what)) byWhat.set(r.what, []);
  byWhat.get(r.what).push(r);
}
const foreign = new Map(run.filter((r) => !RUNNER_ID(r.id)).map((r) => [r.id, r]));
// Rows whose WORDS changed with this re-lock — the old wording maps to the new.
const RENAMED = new Map([
  ["the Platform board is refused only when BOTH modules are off",
    "the Platform board carries no refusal that can never fire (both of its modules are permanent)"],
  ["this half still holds exactly 96 database statements, and the same number of them per table",
    "this half still holds exactly 105 database statements, and the same number of them per table"],
]);

const fresh = (r) => `${r.note ? r.note + " · " : ""}${STAMP}`;
const rewrite = (line, r, retired) => {
  const c = cells(line);
  const oldMark = c[3] || "";
  c[3] = retired ? "⏭" : r.mark;
  // Every earlier segment carrying THIS stamp is replaced, wherever it sits in the cell — a second
  // run must leave one fresh result, not a pile of them (the first version only recognised a stamp
  // that followed a "‖", so a cell that BEGAN with one grew a copy on every run).
  const prev = (c[4] || "").split(/\s*‖\s*/).filter((seg) => seg && !seg.includes("S10-T9 re-run")).join(" ‖ ");
  const now = retired
    ? `RETIRED — the database statement this row counted left the route (deliberate: see the re-lock note in scripts/sweep/t24-new-a.mjs) · ${STAMP}`
    : `${fresh(r)}${oldMark && oldMark !== r.mark ? ` (was ${oldMark})` : ""}`;
  c[4] = prev ? `${prev} ‖ ${now}` : now;
  return `| ${c.join(" | ")} |`;
};

let updated = 0, retired = 0, regress = [];
const files = readdirSync(LEDGER_DIR).filter((f) => /^T.*\.md$/.test(f));
for (const f of files) {
  const path = join(LEDGER_DIR, f);
  const lines = readFileSync(path, "utf8").split("\n");
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    if (!isRow(lines[i])) continue;
    const c = cells(lines[i]);
    const id = c[0];
    let r = null, isRetired = false;
    // Only a run that CONTAINS the runner's own rows may retire one. A run of foreign rows alone
    // (rerun-other.mjs) says nothing about T24-S8's rows — and on 2026-10-09 the first version of
    // this line retired all 868 of them for exactly that reason.
    if (f === OWN && RUNNER_ID(id) && byWhat.size === 0) continue;
    if (f === OWN && RUNNER_ID(id)) {
      const key = RENAMED.get(c[1]) || c[1];
      const q = byWhat.get(key);
      if (q && q.length) r = q.shift(); else isRetired = true;
    } else if (foreign.has(id)) {
      r = foreign.get(id);
    } else continue;
    if (!isRetired && /✅/.test(c[3] || "") && r.mark === "❌") regress.push(`${f} ${id} ${c[1].slice(0, 90)}`);
    lines[i] = rewrite(lines[i], r, isRetired);
    if (isRetired) retired++; else updated++;
    changed = true;
  }
  if (changed && !DRY) writeFileSync(path, lines.join("\n"));
}
const leftover = [...byWhat.values()].flat();
console.log(`${updated} row(s) given a fresh result · ${retired} retired · ${leftover.length} run row(s) with no ledger row (new ground — they belong in a ledger of their own)`);
for (const r of leftover) console.log(`  new: ${r.what.slice(0, 110)}  [${r.mark}]`);
if (regress.length) { console.log(`\nREGRESSIONS (was ✅, now ❌):`); for (const x of regress) console.log("  " + x); }
