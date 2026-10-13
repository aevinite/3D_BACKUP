// scripts/sweep/t12s10/inventory.mjs — sweep #10 · terminal 12 · the waiter tablet SCREEN.
// Lists every existing ledger row whose SUBJECT is one of this territory's five files:
//   app/r/[restaurant]/tablet/page.tsx · app/tablet/layout.tsx · app/tablet/page.tsx ·
//   public/panels/tablet/app.js · public/panels/tablet/index.html
// Subject rule (written down so the next terminal can argue with it):
//   1. any row, in any ledger, that names one of the five paths;
//   2. every row in T7.md ABOVE the sweep-#8 divider (sweep #6/#7's waiter-tablet ledger), minus
//      rows that name only style.css (sweep #10 T37's file) or only the tablet ROUTE (T13's);
//   3. every row in T10.md's sweep-#8 "THE WAITER TABLET" sections that does not carry T13's
//      sweep-#10 stamp (those are the route's rows and T13 re-ran them on 2026-10-10).
//   node scripts/sweep/t12s10/inventory.mjs [--json out.json]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = process.env.LEDGER_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const L = join(ROOT, ".claude/sweep/LEDGER");
const MINE = /panels\/tablet\/(app\.js|index\.html)|app\/tablet\/(page|layout)\.tsx|r\/\[restaurant\]\/tablet\/page\.tsx|\btablet\/(page|layout)\.tsx/;
const ROUTE_ONLY = /api\/tablet|tablet route|tabletPerm|dispatcher/i;
const CSS_ONLY = /style\.css/;
const rows = [];
for (const f of readdirSync(L).filter((n) => /^T.*\.md$/.test(n) && !/S10/.test(n) || n === "T13-S10.md" || n === "T17-S10.md" || n === "T30-S10.md" || n === "T18-S10.md")) {
  const lines = readFileSync(join(L, f), "utf8").split("\n");
  let div = Infinity, t10a = -1;
  if (f === "T7.md") div = lines.findIndex((l) => /SWEEP #8 · TERMINAL 7 — THE MANAGER PANEL/.test(l));
  if (f === "T10.md") t10a = lines.findIndex((l) => /^# SWEEP #8 · TERMINAL 10 — THE WAITER TABLET/.test(l));
  lines.forEach((l, i) => {
    const m = l.match(/^\| (P\d+) \|/);
    if (!m) return;
    let why = "";
    if (MINE.test(l)) why = "names-path";
    else if (f === "T7.md" && i < div && !(CSS_ONLY.test(l) && !/app\.js|index\.html/.test(l))) why = "t7-tablet";
    else if (f === "T10.md" && t10a >= 0 && i > t10a && !/s10·T13/.test(l) && !ROUTE_ONLY.test(l.split("|")[2] || "")) why = "t10-s8-panel";
    if (!why) return;
    if (/s10·T13/.test(l) && why !== "names-path") return;
    const cells = l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    rows.push({ ledger: f, line: i + 1, id: m[1], why, cells });
  });
}
const by = {}; for (const r of rows) by[r.ledger] = (by[r.ledger] || 0) + 1;
console.log(rows.length, JSON.stringify(by));
const k = process.argv.indexOf("--json"); if (k > 0) writeFileSync(process.argv[k + 1], JSON.stringify(rows, null, 1));
