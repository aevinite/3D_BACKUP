// scripts/sweep/t3s10/stamp-reruns.mjs — write sweep #10 T3's re-run results INTO the old ledger rows,
// in place: the result column gains "· s10·T3 <mark>", the note gains "**re-run 2026-10-11 (sweep #10, T3):** …".
//   node scripts/sweep/t3s10/stamp-reruns.mjs <decisions.json>            — dry run
//   node scripts/sweep/t3s10/stamp-reruns.mjs <decisions.json> --write    — stamp
// decisions.json = [{ ledger, id, mark, note }]. A row already carrying the stamp is left alone.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";
const WRITE = process.argv.includes("--write");
// The label is per round, so round 1's result stays readable beside round 2's.
const STAMP = process.env.T3_STAMP || "re-run 2026-10-11 (sweep #10, T3)";
const MARK = process.env.T3_MARK || "s10·T3";
const decisions = JSON.parse(readFileSync(process.argv[2], "utf8"));
const byFile = new Map();
for (const d of decisions) { if (!byFile.has(d.ledger)) byFile.set(d.ledger, []); byFile.get(d.ledger).push(d); }
const esc = (s) => String(s).replace(/\|/g, "¦").replace(/\n/g, " ");
let stamped = 0, already = 0, missing = 0;
for (const [file, ds] of byFile) {
  const p = join(ROOT, ".claude/sweep/LEDGER", file);
  const lines = readFileSync(p, "utf8").split("\n");
  for (const d of ds) {
    const i = lines.findIndex((l) => l.startsWith(`| ${d.id} |`));
    if (i < 0) { missing++; console.log(`  not found: ${d.id} in ${file}`); continue; }
    if (lines[i].includes(STAMP)) { already++; continue; }
    const inner = lines[i].split(/(?<!\\)\|/).slice(1, -1);
    const resIdx = inner.findIndex((c, k) => k >= 2 && /✅|❌|⏭/.test(c));
    if (resIdx >= 0 && resIdx < inner.length - 1) inner[resIdx] = ` ${inner[resIdx].trim()} · ${MARK} ${d.mark} `;
    const last = inner.length - 1;
    inner[last] = ` ${inner[last].trim()}${inner[last].trim() ? " · " : ""}**${STAMP}:** ${d.mark} ${esc(d.note)} `;
    lines[i] = `|${inner.join("|")}|`;
    stamped++;
  }
  if (WRITE) writeFileSync(p, lines.join("\n"));
}
const c = {}; for (const d of decisions) c[d.mark] = (c[d.mark] || 0) + 1;
console.log(`${decisions.length} decisions · ${JSON.stringify(c)} · ${WRITE ? "stamped" : "would stamp"} ${stamped} across ${byFile.size} ledger(s); ${already} already; ${missing} not found`);
