// scripts/sweep/t6s10/writeback.mjs — write the re-run results back INTO the rows where they live,
// under their original ids. Each row's result column becomes today's mark, and its note gains one
// "re-run 2026-10-12 (sweep #10, T6)" clause. Nothing else in any row is touched.
//
//   node scripts/sweep/t6s10/writeback.mjs <t6s8.json> <t5.json> <t5live.json> <other.json> [--dry]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const [f6, f5, f5l, fo] = process.argv.slice(2);
const dry = process.argv.includes("--dry");
const J = (f) => JSON.parse(readFileSync(f, "utf8"));
const TAG = "re-run 2026-10-12 (sweep #10, T6)";
const updates = new Map();            // "file|id" → { mark, note }
const put = (file, id, mark, note) => updates.set(`${file}|${id}`, { mark, note });

// Regressions and corrected measurements, said in full where they happened.
const SPECIAL = {
  P02394: ["✅", "REGRESSION found today (❌) — the receipt of a cancelled bill listed its dishes WITH prices over Total ₹0 (since the 2026-08-22 redesign). FIXED, item 1 — now 0 priced lines and the sentence 'This bill was cancelled — no charge.'"],
  P60553: ["✅", "REGRESSION found today (❌) — 'shows no priced lines' had never been checked by this row's runner; the pane drew them. FIXED, item 1; the runner now asserts both halves"],
  P60350: ["❌", "NOT a product fault: financialYear() has had no caller since 2026-08-04 (#794 moved printing into billdoc.js); the earlier ✅ counted LFH_BILLDOC.financialYear as a caller. A one-line dead wrapper — listed for the owner, not deleted (an improvement)"],
  P60362: ["❌", "NOT a product fault: mrpTaxInside() has had no caller since 2026-08-04 (#794); the earlier ✅ counted LFH_BILLDOC.mrpTaxInside as a caller. A one-line dead wrapper — listed for the owner, not deleted (an improvement)"],
};
for (const r of J(f6)) if (r.owner === "mine") put("T6.md", r.id, r.mark, r.note);
const DELIB5 = {
  P02155: "deliberate — the PARCEL badge lived on parcelRecordCardHtml, deleted 2026-09-03; a parcel now reads '🥡 Parcel' on its line and receipt",
  P17214: "deliberate — same: the parcel line and receipt say '🥡 Parcel'",
  P02184: "deliberate — R67 (owner, 2026-10-11): the card no longer tells a manager what is kept from them; names and seats are plain facts",
  P17353: "deliberate — R67 (owner, 2026-10-11), as P02184",
  P02267: "deliberate — dashReachAllowsYesterday() became dashReachDays(), the four-rung reach (owner, 2026-09-23); the server clamps to it",
  P17411: "deliberate — as P02267",
  P17139: "still true, wider: (b.invVoided || b.invReopens) ? \"reopened voided retired\" — a bill reopened and put back is findable too (mig 407)",
  P17466: "deliberate — STATUS_META was deleted 2026-09-03 (it labelled nothing); the shared-word rule lives in verify:manager-behaviour and P14666",
};
for (const r of J(f5)) {
  if (r.kind !== "dsl") continue;
  if (r.owner === "mine") put("T5.md", r.id, r.ok ? "✅" : "❌", r.ok ? `pattern still lands in my half (line ${r.at})` : `pattern lands in my half but the assertion FAILS${r.err ? " — " + r.err : ""}`);
  else if (r.owner === "nowhere" && r.ok) put("T5.md", r.id, "✅", "an absence the whole file must keep — still absent (part 1's share of a whole-file row)");
  else if (r.owner === "nowhere" && DELIB5[r.id]) put("T5.md", r.id, "✅", DELIB5[r.id]);
}
for (const [id, x] of Object.entries(J(f5l))) put("T5.md", id, x.ok === "skip" ? "⏭" : x.ok ? "✅" : "❌", x.note);
for (const [id, x] of Object.entries(J(fo))) put(x.file, id, x.ok === "skip" ? "⏭" : x.ok ? "✅" : "❌", x.note);
for (const [id, [mark, note]] of Object.entries(SPECIAL)) { for (const k of [...updates.keys()]) if (k.endsWith("|" + id)) updates.set(k, { mark, note }); }

const byFile = new Map();
for (const [k, v] of updates) { const [file, id] = k.split("|"); if (!byFile.has(file)) byFile.set(file, new Map()); byFile.get(file).set(id, v); }
let total = 0;
const tally = {};
for (const [file, ids] of byFile) {
  const path = join(ROOT, ".claude/sweep/LEDGER", file);
  const lines = readFileSync(path, "utf8").split("\n");
  const left = new Set(ids.keys());
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\| (P\d{5,6}) \|/);
    if (!m || !ids.has(m[1]) || !left.has(m[1])) continue;
    const { mark, note } = ids.get(m[1]);
    const cells = lines[i].split(/(?<!\\)\|/);
    if (cells.length < 6) continue;
    if (lines[i].includes(TAG)) { left.delete(m[1]); continue; }          // already written back once
    cells[4] = ` ${mark} `;
    const clause = `**${TAG}: ${mark}${note ? " — " + String(note).replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 400) : ""}**`;
    const last = cells.length - 2;                                          // the final real cell before the trailing ""
    cells[last] = `${cells[last].trimEnd()}${cells[last].trim() ? " · " : " "}${clause} `;
    lines[i] = cells.join("|");
    left.delete(m[1]); total++; tally[mark] = (tally[mark] || 0) + 1;
  }
  if (left.size) console.log(`  ${file}: ${left.size} id(s) not found as rows: ${[...left].slice(0, 6).join(" ")}`);
  if (!dry) writeFileSync(path, lines.join("\n"));
  console.log(`${file}: ${ids.size - left.size} row(s) written back`);
}
console.log(`TOTAL ${total} rows · ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(" · ")}${dry ? " (dry run — nothing written)" : ""}`);
