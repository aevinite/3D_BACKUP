// scripts/sweep/t10s10/writeback.mjs — stamp a fresh re-run result onto existing ledger rows, IN
// PLACE, under their original ids (sweep #10 T10). Never renumbers, never deletes, never touches a
// row whose id it was not handed. A row whose result changed has its result cell rewritten and the
// old mark kept in the stamp, so a regression is visible as one.
//
//   node scripts/sweep/t10s10/writeback.mjs <results.json>
//   results.json = [{ "id": "P04859", "mark": "✅", "note": "…" }, …]
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const DIR = join(ROOT, ".claude/sweep/LEDGER");
const STAMP = "↻ S10-T10 re-run 2026-10-09";
const results = JSON.parse(readFileSync(process.argv[2], "utf8"));
const want = new Map(results.map((r) => [r.id, r]));
const done = new Set();
for (const f of readdirSync(DIR).filter((x) => /^T.*\.md$/.test(x))) {
  const p = join(DIR, f);
  const lines = readFileSync(p, "utf8").split("\n");
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\| (P\d+) \|/);
    if (!m || !want.has(m[1]) || done.has(m[1])) continue;
    if (lines[i].includes(STAMP)) { done.add(m[1]); continue; }  // idempotent
    const r = want.get(m[1]);
    const cells = lines[i].split(/(?<!\\)\|/);           // ["", id, what, how, result, note…, ""]
    if (cells.length < 6) continue;
    const resIdx = 4, noteIdx = cells.length - 2;
    const was = cells[resIdx].trim();
    const wasMark = (was.match(/✅|❌|⏭/g) || []).pop() || was;
    if (wasMark !== r.mark) cells[resIdx] = ` ${r.mark} `;
    const extra = `${STAMP}${wasMark !== r.mark ? ` (was ${wasMark})` : ""}${r.note ? ` — ${String(r.note).replace(/\|/g, "\\|")}` : ""}`;
    const cur = cells[noteIdx].trim();
    cells[noteIdx] = ` ${cur ? `${cur} ‖ ` : ""}${extra} `;
    lines[i] = cells.join("|");
    done.add(m[1]); changed = true;
  }
  if (changed) writeFileSync(p, lines.join("\n"));
}
const missing = [...want.keys()].filter((k) => !done.has(k));
console.log(`stamped ${done.size} row(s)${missing.length ? ` · NOT FOUND: ${missing.join(" ")}` : ""}`);
if (missing.length) process.exit(1);
