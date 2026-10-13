// scripts/sweep/t16s10/writeback.mjs — stamp a fresh re-run result onto EXISTING ledger rows, in
// place, under their original ids (sweep #10 T16). Never renumbers, never deletes, never touches a
// row it was not handed, never stamps one of this terminal's own new ids (those live in T16-S10.md).
// A row whose mark changed has its result cell rewritten and the old mark kept in the stamp, so a
// regression reads as one.
//   node scripts/sweep/t16s10/writeback.mjs <results.json> [<more.json> …]
//   results.json = [{ "id": "P04859", "mark": "✅", "note": "…" }, …]
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const DIR = join(ROOT, ".claude/sweep/LEDGER");
const STAMP = process.env.T16_STAMP || "↻ S10-T16 re-run 2026-10-12";
const want = new Map();
for (const f of process.argv.slice(2)) for (const r of JSON.parse(readFileSync(f, "utf8"))) {
  const n = Number(String(r.id).slice(1));
  if (n >= 185001 && n <= 186000) continue;     // this terminal's NEW rows — not an existing row
  if (!want.has(r.id) || r.mark !== "✅") want.set(r.id, r);   // a red from any source wins over a green
}
const done = new Set();
let changed = 0;
for (const f of readdirSync(DIR).filter((x) => /^T.*\.md$/.test(x) && x !== "T16-S10.md")) {
  const p = join(DIR, f);
  const lines = readFileSync(p, "utf8").split("\n");
  let dirty = false;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\| (P\d+) \|/);
    if (!m || !want.has(m[1])) continue;
    if (lines[i].includes(STAMP)) { done.add(m[1]); continue; }   // idempotent
    const r = want.get(m[1]);
    const cells = lines[i].split(/(?<!\\)\|/);
    if (cells.length < 6) continue;
    const resIdx = 4, noteIdx = cells.length - 2;
    const was = cells[resIdx].trim();
    const wasMark = (was.match(/✅|❌|⏭/g) || []).pop() || was;
    if (wasMark !== r.mark) { cells[resIdx] = ` ${r.mark} `; changed++; }
    const extra = `${STAMP}${wasMark !== r.mark ? ` (was ${wasMark})` : ""}${r.note ? ` — ${String(r.note).replace(/\|/g, "\\|").slice(0, 220)}` : ""}`;
    const cur = cells[noteIdx].trim();
    cells[noteIdx] = ` ${cur ? `${cur} ‖ ` : ""}${extra} `;
    lines[i] = cells.join("|");
    done.add(m[1]); dirty = true;
  }
  if (dirty) writeFileSync(p, lines.join("\n"));
}
const missing = [...want.keys()].filter((k) => !done.has(k));
console.log(`stamped ${done.size} row(s), ${changed} changed mark${missing.length ? ` · NOT FOUND in any ledger: ${missing.join(" ")}` : ""}`);
