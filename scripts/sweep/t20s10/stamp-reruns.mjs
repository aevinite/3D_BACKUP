// Writes terminal 20's RE-RUN results into the ledger rows where they live, in place. Nothing is
// renumbered, moved, added or removed: the result cell gains ` · s10·T20 <mark>` and the note cell
// gains the dated re-run line. Idempotent — a row already carrying the stamp is left alone.
//
//   node scripts/sweep/t20s10/stamp-reruns.mjs <results.json> [--write]
//
// <results.json> is [{ id, ok: true|false|null, note }], assembled by collect-reruns.mjs from what the
// harnesses actually printed — never typed by hand.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const WRITE = process.argv.includes("--write");
const STAMP = "re-run 2026-10-16 (sweep #10, T20)";
const file = process.argv.slice(2).find((a) => a.endsWith(".json"));
const results = JSON.parse(readFileSync(file, "utf8"));
const dir = join(ROOT, ".claude/sweep/LEDGER");
const ledgers = readdirSync(dir).filter((f) => /^T.*\.md$/.test(f));
const texts = new Map(ledgers.map((f) => [f, readFileSync(join(dir, f), "utf8").split("\n")]));
const esc = (s) => String(s).replace(/\|/g, "¦").replace(/\n/g, " ");
let stamped = 0, already = 0, missing = 0;
const touched = new Set();
for (const r of results) {
  const hits = [];
  for (const [f, lines] of texts) { const i = lines.findIndex((l) => l.startsWith(`| ${r.id} |`)); if (i >= 0) hits.push([f, i]); }
  if (!hits.length) { missing++; console.log(`  not found: ${r.id}`); continue; }
  if (hits.length > 1) console.log(`  ${r.id} is in ${hits.map((h) => h[0]).join(" + ")} — stamping all`);
  for (const [f, i] of hits) {
    const lines = texts.get(f);
    if (lines[i].includes(STAMP)) { already++; continue; }
    const inner = lines[i].split(/(?<!\\)\|/).slice(1, -1);
    const resIdx = inner.findIndex((c, k) => k >= 2 && /✅|❌|⏭/.test(c));
    const mark = r.ok === null ? "⏭" : r.ok ? "✅" : "❌";
    if (resIdx >= 0 && resIdx < inner.length - 1) inner[resIdx] = ` ${inner[resIdx].trim()} · s10·T20 ${mark} `;
    const last = inner.length - 1;
    inner[last] = ` ${inner[last].trim()}${inner[last].trim() ? " · " : ""}**${STAMP}:** ${mark} ${esc(r.note)} `;
    lines[i] = `|${inner.join("|")}|`;
    stamped++; touched.add(f);
  }
}
if (WRITE) for (const f of touched) writeFileSync(join(dir, f), texts.get(f).join("\n"));
console.log(`${results.length} results · ${results.filter((r) => r.ok === true).length} ✅ · ${results.filter((r) => r.ok === false).length} ❌ · ${results.filter((r) => r.ok === null).length} ⏭`);
console.log(`${WRITE ? "stamped" : "would stamp"} ${stamped} row(s) in ${[...touched].join(", ") || "none"}; ${already} already stamped; ${missing} not found`);
