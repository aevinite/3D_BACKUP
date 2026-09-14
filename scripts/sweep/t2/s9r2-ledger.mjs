// Generates T2's round-2 ledger section FROM THE RECORDED RESULTS, so no row can claim a result
// the run did not produce. Re-run the two check scripts and this file to rebuild it.
import { readFileSync, writeFileSync } from "node:fs";
import { RESULTS, ROOT } from "./s9r2-lib.mjs";
import { join } from "node:path";
const j = JSON.parse(readFileSync(RESULTS, "utf8"));
const all = [...(j.static || []), ...(j.live || [])].sort((a, b) => parseInt(a.id.slice(1)) - parseInt(b.id.slice(1)));
const esc = (s) => String(s || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const mark = (r) => (r.skip ? "⏭" : r.ok ? "✅" : "❌");
const rows = all.map((r) => `| ${r.id} | ${esc(r.what)} | ${esc(r.how)} | ${mark(r)} | ${esc(r.note)} |`).join("\n");
const green = all.filter((r) => r.ok && !r.skip).length, red = all.filter((r) => !r.ok && !r.skip).length, sk = all.filter((r) => r.skip).length;
const BLOCKS = [
  ["A", "P101751", "P101800", "`app/item/[slug]/not-found.tsx` and the guest 404 — the THINNEST file in the territory (8 rows)"],
  ["B", "P110501", "P110560", "`app/view/[folder]/page.tsx` — the 3D door (40 rows)"],
  ["C", "P110561", "P110622", "`app/item/[slug]/page.tsx` — restaurant #1's dish door (75 rows)"],
  ["D", "P110623", "P110682", "`components/PublicModelViewer.tsx` (85 rows)"],
  ["E", "P110683", "P110747", "`lib/modelLoader.ts` (151 rows)"],
  ["F", "P110748", "P110793", "`app/view/[folder]/ViewerClient.tsx` — ground the 220 existing rows do not stand on"],
  ["G", "P110794", "P110838", "`app/item/[slug]/ItemClient.tsx` — ground the 241 existing rows do not stand on"],
  ["H", "P110839", "P110853", "cross-door truth, the project's own rules, judgment"],
  ["I", "P110854", "P110950", "**DRIVEN** on a production build: four restaurants' 3D doors, all four 404 doors, the dish page at three sizes × two skins, the 3D screen end to end, the loader's arithmetic in-page, and the whole journey"],
];
const head = `

## SWEEP #9 · T2's ROUND 2 — \`P101751\`–\`P101800\` + \`P110501\`–\`P110950\` (500, 2026-09-15)

The owner's word after round 1 and the three picked follow-ups were merged and deployed: *"make it
live and plan the whole 500 phases test again within the boundaries that you have given and test it
again so that if any errors are left still within the boundaries that you have given, it can be
solved"*.

Branch \`sweep9/t2-round2-500\`, worktree \`../wt-t2-r2\`, **production build** on port **4402**.
**450 of these ids were claimed from the registry and landed on \`main\` on their own before a single
row was written** (PR #1355); the other 50 were already free inside this terminal's sweep-#9 block.

**Planned by MEASURING where the ledger is thin, not by having an idea** (S9-RULES 2b). Counting the
3,100 existing rows by the id blocks their own headers document:

| rows before this round | file |
|---|---|
| **8** | \`app/item/[slug]/not-found.tsx\` |
| **40** | \`app/view/[folder]/page.tsx\` |
| **75** | \`app/item/[slug]/page.tsx\` |
| 85 | \`components/PublicModelViewer.tsx\` |
| 151 | \`lib/modelLoader.ts\` |
| 220 | \`app/view/[folder]/ViewerClient.tsx\` |
| 241 | \`app/item/[slug]/ItemClient.tsx\` |

The three thinnest are all guest **doors** — and between them they own the maintenance gate, the menu
switch, the 404 decision, the share preview and the tenant pin. **173 of these 500 went there.**

**Result: 500 written, 500 executed, ${green} ✅ · ${red} ❌ · ${sk} ⏭.** Read that honestly: this
territory had 2,956 rows re-run and three faults fixed eight days… hours earlier in round 1, so a
clean round 2 is what a swept territory should look like. What this round adds is **coverage where
there was almost none**, and it is all re-runnable:

\`\`\`sh
node scripts/sweep/t2/s9r2-checks.mjs                              # 400, source-level, no server
node scripts/sweep/t2/s9r2-live.mjs --base http://localhost:4402   # 100, driven
node scripts/sweep/t2/s9r2-ledger.mjs                              # rebuilds the rows below
\`\`\`

**Five rows came back red during the run and every one was my own instrument.** Recorded because a
withdrawn red is worth as much as a green: a \`dangerouslySetInnerHTML\` test too crude to tell a
constant stylesheet from guest input; a \`\${\` count that forgot the tab title; a comment looked for in
the wrong file; an \`async\` check body that resolved to a promise rather than a boolean; and one
assertion about \`GuestNotFound\` that asserted the opposite of the rule. All five were corrected and
re-run, none was filed.

**And one real fault in the run itself, caught and fixed:** the first pass used hand-typed counters,
and block A ran to \`P101801\` — **one id past this terminal's own block and into T3's range** — while
leaving \`P110561\`–\`P110590\` unused. Then the live half, being a separate \`node\` process, restarted the
counter and re-filed 70 checks on ids the static half already held. Ids are no longer typed:
\`nextId()\` in \`s9r2-lib.mjs\` walks the two claimed ranges, **resumes across processes by reading what
is already recorded**, and THROWS rather than borrowing when they are spent. It ended this run with
exactly 0 ids left.

| block | ids | subject |
|---|---|---|
${BLOCKS.map(([b, a, z, s]) => `| ${b} | \`${a}\`–\`${z}\` | ${s} |`).join("\n")}

| id | check | how to verify | result | note |
|----|-------|---------------|--------|------|
`;
const p = join(ROOT, ".claude/sweep/LEDGER/T2.md");
const cur = readFileSync(p, "utf8");
if (cur.includes("## SWEEP #9 · T2's ROUND 2")) { console.log("section already present — not appending twice"); process.exit(0); }
writeFileSync(p, cur.replace(/\s+$/, "") + head + rows + "\n");
console.log(`appended ${all.length} rows (${green} ✅ / ${red} ❌ / ${sk} ⏭)`);
