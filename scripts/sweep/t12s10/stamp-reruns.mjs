// scripts/sweep/t12s10/stamp-reruns.mjs — write sweep #10 T12's re-run results INTO the old ledger rows,
// in place: the result cell gains "· s10·T12 <mark>", the note gains "**re-run 2026-10-12 (sweep #10,
// T12):** <mark> <why>". A row already carrying the stamp is left alone. Decisions come from rerun.mjs.
//   node scripts/sweep/t12s10/stamp-reruns.mjs            — dry run
//   node scripts/sweep/t12s10/stamp-reruns.mjs --write    — stamp
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./lib.mjs";

const WRITE = process.argv.includes("--write");
const STAMP = "re-run 2026-10-12 (sweep #10, T12)";
execFileSync("node", [join(ROOT, "scripts/sweep/t12s10/rerun.mjs"), "--json", "/tmp/t12s10-rerun.json"], { cwd: ROOT, stdio: "ignore" });
const { decisions, review } = JSON.parse(readFileSync("/tmp/t12s10-rerun.json", "utf8"));
if (review.length) { console.error(`${review.length} rows still need a person — run rerun.mjs --review first`); process.exit(1); }
// Short form of the evidence, so 3,400 stamps do not double the ledgers' size.
const short = (n) => n
  .replace(/re-proven by theme: /, "by theme · ")
  .replace(/ \(the behaviour re-driven; this row's own figure was not re-measured one-for-one\)/, " (behaviour re-driven, not this row's own figure)")
  .replace(/behaviour re-driven by /, "re-driven by ")
  .replace(/block /g, "t12s10 ");
const esc = (s) => String(s).replace(/\|/g, "¦").replace(/\n/g, " ");
const byFile = new Map();
for (const d of decisions) { if (!byFile.has(d.ledger)) byFile.set(d.ledger, []); byFile.get(d.ledger).push(d); }
let stamped = 0, already = 0, missing = 0;
for (const [file, ds] of byFile) {
  const p = join(ROOT, ".claude/sweep/LEDGER", file);
  const lines = readFileSync(p, "utf8").split("\n");
  const at = new Map(); lines.forEach((l, i) => { const m = l.match(/^\| (P\d+) \|/); if (m && !at.has(m[1])) at.set(m[1], i); });
  for (const d of ds) {
    const i = at.get(d.id);
    if (i == null) { missing++; continue; }
    if (lines[i].includes(STAMP)) { already++; continue; }
    const inner = lines[i].split(/(?<!\\)\|/).slice(1, -1);
    const resIdx = inner.findIndex((c, k) => k >= 2 && /✅|❌|⏭/.test(c));
    if (resIdx >= 0 && resIdx < inner.length - 1) inner[resIdx] = ` ${inner[resIdx].trim()} · s10·T12 ${d.mark} `;
    const last = inner.length - 1;
    inner[last] = ` ${inner[last].trim()}${inner[last].trim() ? " · " : ""}**${STAMP}:** ${d.mark} ${esc(short(d.note))} `;
    lines[i] = `|${inner.join("|")}|`;
    stamped++;
  }
  if (WRITE) writeFileSync(p, lines.join("\n"));
}
const c = {}; for (const d of decisions) c[d.mark] = (c[d.mark] || 0) + 1;
console.log(`${decisions.length} decisions · ${JSON.stringify(c)} · ${WRITE ? "stamped" : "would stamp"} ${stamped} across ${byFile.size} ledger(s); ${already} already; ${missing} not found`);
