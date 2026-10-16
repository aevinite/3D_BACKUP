// scripts/sweep/t2s10/stamp.mjs — write sweep #10 T2's re-run decisions INTO the old ledger rows, in
// place: the result column gains "· s10·T2 <mark>", the note gains "**re-run 2026-10-16 (sweep #10,
// T2):** <evidence>". A row already carrying the stamp is left alone. Same shape as t3s10's stamper.
//   node scripts/sweep/t2s10/stamp.mjs            — dry run
//   node scripts/sweep/t2s10/stamp.mjs --write    — stamp
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, OUT } from "./lib.mjs";
const WRITE = process.argv.includes("--write");
const STAMP = "re-run 2026-10-16 (sweep #10, T2)", MARK = "s10·T2";
const decisions = JSON.parse(readFileSync(join(OUT, "decisions.json"), "utf8"));
const esc = (s) => String(s).replace(/\|/g, "¦").replace(/\n/g, " ");
const byFile = new Map();
for (const d of decisions) { if (!byFile.has(d.ledger)) byFile.set(d.ledger, []); byFile.get(d.ledger).push(d); }
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
console.log(`${decisions.length} decisions · ${WRITE ? "stamped" : "would stamp"} ${stamped} across ${byFile.size} ledger(s); ${already} already; ${missing} not found`);
