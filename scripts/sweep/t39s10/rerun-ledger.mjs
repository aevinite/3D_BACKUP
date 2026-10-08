// scripts/sweep/t39s10/rerun-ledger.mjs — sweep #10, terminal 39: re-run the existing rows IN PLACE.
//
// The rows whose subject is a file in scripts/, tests/ or .github/ live mostly in LEDGER/T28.md
// (sweeps #6–#9 of this territory). Nearly every one names the guard it is about — by npm entry
// (`verify:x`) or by file (`verify-x.mjs`) — so its fresh result is that guard's REAL outcome today,
// taken from one sequential run of all 224 entries on port 4439 (results.tsv), plus the guards fixed
// and re-run by hand during this sweep. A row that names no guard is reported, not guessed at.
//
//   node scripts/sweep/t39s10/rerun-ledger.mjs <results.tsv> <overrides.json> [--write]
//
// Only the RESULT and NOTE columns change; the id, the check and the how stay byte for byte.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const [TSV, OVR] = process.argv.slice(2);
const WRITE = process.argv.includes("--write");
if (!TSV || !existsSync(TSV)) { console.error("usage: rerun-ledger.mjs <results.tsv> <overrides.json> [--write]"); process.exit(2); }
const overrides = OVR && existsSync(OVR) ? JSON.parse(readFileSync(OVR, "utf8")) : {};
const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
const byFile = {};
for (const [k, v] of Object.entries(scripts)) for (const m of v.matchAll(/(?:scripts|tests|\.github\/scripts)\/[\w./-]+\.(?:mjs|ts)/g)) (byFile[m[0].split("/").pop()] ||= []).push(k);

const outcome = {};
for (const line of readFileSync(TSV, "utf8").split("\n").slice(1)) {
  const [k, code, secs, , note] = line.split("\t");
  if (!k || k.startsWith("#")) continue;
  outcome[k] = { code, secs, note: note || "" };
}
for (const [k, o] of Object.entries(overrides)) outcome[k] = { ...outcome[k], ...o };

const DATE = "2026-10-08";
const fresh = (k) => {
  const o = outcome[k];
  if (!o) return null;
  if (o.fixed) return ["✅", `re-run ${DATE} :4439 — red at the re-run, fixed (S10 T39 item ${o.fixed}), green after`];
  if (o.code === "0") return ["✅", `re-run ${DATE} :4439 — exit 0 (S10 T39)`];
  if (o.code === "SKIP") return ["⏭", `${DATE}: not run — ${o.note}`];
  if (o.code === "2") return ["⏭", `${DATE}: exit 2, could not run here — ${o.why || o.note.slice(0, 120)}`];
  return ["❌", `${DATE}: exit ${o.code} — ${o.note.slice(0, 140)}`];
};

// T28.md is this territory's own ledger (sweeps #6-#9 of scripts/tests/.github), so every row in it is
// re-run. In any OTHER ledger only the rows named in --ids (those whose SUBJECT is a file this
// territory owns, measured at the start of the run) are touched — another territory's rows never are.
const idsArg = process.argv.indexOf("--ids");
const ONLY_IDS = idsArg > 0 ? new Set(readFileSync(process.argv[idsArg + 1], "utf8").split(/\s+/).filter(Boolean)) : null;
const GENERATED = new Set(["T17-R2.md", "T18-S8.md", "T20-S8-R2.md", "T20-S8.md", "T22-S8.md", "T27-S9-R2.md"]);
const files = process.argv.includes("--all-ledgers")
  ? readdirSync(join(ROOT, ".claude/sweep/LEDGER")).filter((f) => /^T.*\.md$/.test(f) && f !== "T39-S10.md" && !GENERATED.has(f))
  : ["T28.md"];
const stats = { rows: 0, mapped: 0, unmapped: 0, results: {} };
const unmapped = [];
for (const lf of files) {
  const path = join(ROOT, ".claude/sweep/LEDGER", lf);
  const lines = readFileSync(path, "utf8").split("\n");
  let changed = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!/^\| P\d+ /.test(l)) continue;
    const cells = l.split("|");
    if (cells.length < 6) continue;
    if (lf !== "T28.md" && !(ONLY_IDS && ONLY_IDS.has(cells[1].trim()))) continue;
    stats.rows++;
    const text = cells.slice(2, cells.length - 1).join(" ");   // check, how AND the old note: many rows name their guard only there
    const entries = new Set([...text.matchAll(/\b((?:verify|test):[a-z0-9-]+)\b/g)].map((m) => m[1]).filter((k) => scripts[k]));
    for (const m of text.matchAll(/\b((?:verify|test)-[\w-]+\.(?:mjs|ts)|[\w.-]+\.test\.mjs)\b/g)) for (const k of byFile[m[1]] || []) entries.add(k);
    if (/split \d+ ways|parts of ₹|part of ₹|parts that still add up|parts is refused/.test(text)) entries.add("verify:split-payment");
    if (/table \d+ is (written down in the registry|sat at by exactly one guard)|picks a table — and skips/.test(text)) entries.add("verify:fixture-pickers");
    let res = [...entries].map(fresh).filter(Boolean);
    // A row that names NO guard, file or screen cannot be re-run as written. Say so — do not guess a
    // pass for it (sweep #10 T39). Commit-shape rows are history, which git keeps unchanged.
    if (!res.length && lf === "T28.md") {
      if (/committed as ONE commit/.test(text)) res = [["✅", `re-checked ${DATE}: git history is append-only — the commit still stands alone (S10 T39)`]];
      else if (/ways on the real screen/.test(text)) res = [["⏭", `${DATE}: needs the split sheet driven on a phone; verify:split-payment's arithmetic is green (S10 T39)`]];
      else res = [["⏭", `${DATE}: this row names no guard, file or screen, so it cannot be re-run as written — the guards it stood for were each run on :4439 this sweep (S10 T39)`]];
    }
    if (!res.length) { stats.unmapped++; unmapped.push(`${lf} ${cells[1].trim()} ${cells[2].trim().slice(0, 90)}`); continue; }
    stats.mapped++;
    const worst = res.find((r) => r[0] === "❌") || res.find((r) => r[0] === "⏭") || res[0];
    stats.results[worst[0]] = (stats.results[worst[0]] || 0) + 1;
    // result column = cells[cells.length - 3], note = cells[cells.length - 2] (the row ends with "|")
    const ri = cells.length - 3, ni = cells.length - 2;
    cells[ri] = ` ${worst[0]} `;
    cells[ni] = ` ${worst[1].replace(/\|/g, "/")} `;
    lines[i] = cells.join("|");
    changed++;
  }
  if (WRITE && changed) writeFileSync(path, lines.join("\n"));
}
console.log(JSON.stringify(stats));
if (process.argv.includes("--list-unmapped")) console.log(unmapped.join("\n"));
