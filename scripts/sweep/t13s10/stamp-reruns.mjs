// scripts/sweep/t13s10/stamp-reruns.mjs — writes terminal 13's RE-RUN results into the ledger rows
// where they live, in place. Nothing is renumbered, nothing is moved, no row is added or removed:
// the result cell gains ` · s10·T13 <mark>` and the note cell gains the dated re-run line.
// Idempotent — a row already carrying today's T13 stamp is left alone.
//   node scripts/sweep/t13s10/stamp-reruns.mjs           (dry run: counts only)
//   node scripts/sweep/t13s10/stamp-reruns.mjs --write
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";
import { gridRows } from "./rerun-grid.mjs";
import { otherRows } from "./rerun-rows.mjs";

const WRITE = process.argv.includes("--write");
const STAMP = "re-run 2026-10-10 (sweep #10, T13)";
const results = [...gridRows(), ...(await otherRows())];
const byFile = new Map();
for (const r of results) { if (!byFile.has(r.ledger)) byFile.set(r.ledger, []); byFile.get(r.ledger).push(r); }
const esc = (s) => String(s).replace(/\|/g, "¦").replace(/\n/g, " ");
let stamped = 0, already = 0, missing = 0;
for (const [file, rs] of byFile) {
  const p = join(ROOT, ".claude/sweep/LEDGER", file);
  const lines = readFileSync(p, "utf8").split("\n");
  for (const r of rs) {
    const i = lines.findIndex((l) => l.startsWith(`| ${r.id} |`));
    if (i < 0) { missing++; console.log(`  not found: ${r.id} in ${file}`); continue; }
    if (lines[i].includes(STAMP)) { already++; continue; }
    const cells = lines[i].split(/(?<!\\)\|/);           // ['', ' id ', ..., ' note ', '']
    const inner = cells.slice(1, -1);
    const resIdx = inner.findIndex((c, k) => k >= 2 && /✅|❌|⏭/.test(c));
    const mark = r.ok === null ? "⏭" : r.ok ? "✅" : "❌";
    if (resIdx >= 0 && resIdx < inner.length - 1) inner[resIdx] = ` ${inner[resIdx].trim()} · s10·T13 ${mark} `;
    const last = inner.length - 1;
    inner[last] = ` ${inner[last].trim()}${inner[last].trim() ? " · " : ""}**${STAMP}:** ${mark} ${esc(r.note)} `;
    lines[i] = `|${inner.join("|")}|`;
    stamped++;
  }
  if (WRITE) writeFileSync(p, lines.join("\n"));
}
const bad = results.filter((r) => r.ok === false);
console.log(`${results.length} re-run results · ${results.filter((r) => r.ok).length} ✅ · ${bad.length} ❌ · ${results.filter((r) => r.ok === null).length} ⏭`);
console.log(`${WRITE ? "stamped" : "would stamp"} ${stamped} row(s) across ${byFile.size} ledger(s); ${already} already stamped; ${missing} not found`);
for (const b of bad) console.log(`  ❌ ${b.id} [${b.ledger}] ${b.what} — ${b.note}`);
process.exit(0);
