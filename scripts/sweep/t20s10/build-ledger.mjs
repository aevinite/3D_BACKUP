// Builds .claude/sweep/LEDGER/T20-S10.md from the JSON the seven bands wrote — so the result column
// is exactly what ran, never typed.
//
//   node scripts/sweep/t20s10/build-ledger.mjs --bands=<dir>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, arg } from "./lib.mjs";

const dir = arg("bands", "");
const BANDS = [
  ["a", "Band A — the docket, driven in four setups (desktop dark + light, A35 phone, iPad with two restaurants)", "P189001–P189180"],
  ["b", "Band B — the docket and the tiles in the states nobody visits (two days of trade, nothing paid, one restaurant withheld, a failed food read, more paid out than taken)", "P189181–P189240 + P189501–P189503"],
  ["c", "Band C — the four libraries and the number parser, EXECUTED", "P189241–P189340"],
  ["d", "Band D — /api/owner/overview, driven as three real callers", "P189341–P189390"],
  ["e", "Band E — the owner panel's door and the two Coming-soon pages", "P189391–P189430"],
  ["f", "Band F — the dashboard itself: eight periods, picker, table, drawer, dish drill, phone", "P189431–P189480"],
  ["g", "Band G — the project's rules on this territory", "P189481–P189500"],
];
// The measurement table is COMPUTED, never typed: rows per owned file by subject (column 3) across every
// other ledger, how many of those drove the real app (their "how" column), and how many this run adds.
import { readdirSync } from "node:fs";
const FILES = ["components/owner/TileDocket.tsx", "lib/ownerSnap.ts", "components/owner/AnimatedNumber.tsx", "app/owner/page.tsx", "lib/ownerHome.ts",
  "lib/ownerOverviewCache.ts", "lib/dashRange.ts", "app/owner/marketing/page.tsx", "app/owner/online/page.tsx", "app/owner/layout.tsx", "app/api/owner/overview/route.ts"];
const LED = join(ROOT, ".claude/sweep/LEDGER");
const others = readdirSync(LED).filter((f) => /^T.*\.md$/.test(f) && f !== "T20-S10.md").flatMap((f) => readFileSync(join(LED, f), "utf8").split("\n").filter((l) => /^\| P\d+ /.test(l)));
const DRIVE = /driv|live|headless|port \d|:4\d\d\d|browser|playwright|fresh browser|signed in/i;
const mine = [];
for (const k of "abcdefg") { const p = join(arg("bands", ""), `band-${k}.json`); if (existsSync(p)) mine.push(...JSON.parse(readFileSync(p, "utf8"))); }
const measureRows = FILES.map((f) => {
  const hit = others.filter((l) => (l.split("|")[2] || "").includes(f));
  const driven = hit.filter((l) => DRIVE.test(l.split("|")[3] || "")).length;
  return `| \`${f}\` | ${hit.length} | ${driven} | ${mine.filter((r) => r.file === f).length} |`;
});
const measure = ["| file | rows naming it before this run | of those, driven | this run adds |", "|---|---|---|---|", ...measureRows].join("\n");
const esc = (t) => String(t ?? "").replace(/\|/g, "¦").replace(/\n/g, " ");
let rows = 0, okN = 0, bad = 0, sk = 0;
const sections = [];
for (const [k, title, range] of BANDS) {
  const p = join(dir, `band-${k}.json`);
  if (!existsSync(p)) throw new Error(`missing ${p} — run the band with --json first`);
  const rs = JSON.parse(readFileSync(p, "utf8"));
  const lines = [`## ${title} — ${range}`, "", "| id | check | how to verify | result | note |", "|----|-------|---------------|--------|------|"];
  for (const r of rs) {
    const mark = r.pass === true ? "✅" : r.pass === false ? "❌" : "⏭";
    rows++; if (r.pass === true) okN++; else if (r.pass === false) bad++; else sk++;
    lines.push(`| ${r.id} | \`${r.file}\` — ${esc(r.what)} | ${esc(r.how)} | ${mark} | ${esc(r.why)} |`);
  }
  sections.push(lines.join("\n"));
}
const head = `# T20 (sweep #10) — the owner's home dashboard · phases P189001–P189500

**Territory** (sweep #10's fresh cut, 2026-10-08): \`app/api/owner/overview/route.ts\` · \`app/owner/layout.tsx\` ·
\`app/owner/marketing/page.tsx\` · \`app/owner/online/page.tsx\` · \`app/owner/page.tsx\` · \`components/owner/AnimatedNumber.tsx\` ·
\`components/owner/TileDocket.tsx\` · \`lib/dashRange.ts\` · \`lib/ownerHome.ts\` · \`lib/ownerOverviewCache.ts\` · \`lib/ownerSnap.ts\`.

**Stack:** worktree \`../wt-s10-t20\`, branch \`sweep10/t20-owner-s-home\`, dev server port **4420** (proved mine with \`lsof\`
before anything on it was trusted). Signed in ONCE per role through \`scripts/sweep/login.mjs\`: the one-restaurant diag owner
(\`diago1\`, French House), the two-restaurant \`diagmulti\`, the five-restaurant \`diagestate\` (sweep #8's fixture, made for
this run and removed and VERIFIED gone after it), and the admin console's own session. Nothing here writes to the shared
database; the unusual states are produced by answering the page's own requests differently in the browser.

\`result\` column: ✅ pass · ❌ a real problem (fixed in this run, items 1–8, unless the note says otherwise) · ⏭ skipped, with why.

## How the 500 were aimed — measured, not imagined

Rows per owned file **by subject** across every ledger on disk before this run (the S10-RULES rule-3 loop), and how many of
them had ever DRIVEN the real app:

${measure}

**Re-run first.** Every existing row about these files was re-run before a single new id was written: T12.md (rounds 1–3),
T13-S8.md (bands A, C, D, E, F — band B is the analytics route, T21's), T13-S8-R2.md (bands H–O), and the rows in
T17-S10, T20, T25, T30, T29, T28-S9-R2, T11, T30-S10, T22, T14, T27, T18-S10 and T13-S10 whose subject is one of these files.
Results are stamped IN PLACE in each row (\`· s10·T20 <mark>\` + a dated note). Sweep #8's harness (\`scripts/sweep/t13/\`)
still looked for the tile pop-up the docket replaced on 2026-10-04 — every click after it hit the sheet — so its selectors were
moved to the docket's (\`.tdk\`); a row whose old detector was pinned to a shape the owner changed on purpose was re-proved on
today's code by \`reprove-static.mjs\` / \`reprove-live.mjs\` and says which.

Re-run harness: \`scripts/sweep/t20s10/\` — \`collect-reruns.mjs\` assembles the results from what the scripts printed,
\`stamp-reruns.mjs\` writes them into the rows. New bands: \`band-a…g\`; this file is built by \`build-ledger.mjs\`.

**Totals (this file):** ${rows} rows · ${okN} ✅ · ${bad} ❌ · ${sk} ⏭.

---
`;
writeFileSync(join(ROOT, ".claude/sweep/LEDGER/T20-S10.md"), head + "\n" + sections.join("\n\n") + "\n");
console.log(`T20-S10.md: ${rows} rows · ${okN} ✅ · ${bad} ❌ · ${sk} ⏭`);
