// Turn the seven blocks' emitted rows into the markdown this sweep's ledger is made of, and append
// them to T14.md — which IS this territory's ledger (sweep 6's terminal 14 was "the owner's
// Customers, Pay Later (khata), Inventory, Complaints & Manager mode"; sweep 8 re-cut it and gave
// T16 everything except Manager mode). A ledger may grow and may not shrink, so this only ever
// APPENDS, and it refuses if any id it is about to write already exists anywhere on disk.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const DIR = ".claude/sweep/LEDGER";
const T14 = `${DIR}/T14.md`;
const BLOCKS = [
  ["A", "A · THE STOCK API AND THE ATTACHMENT UPLOAD, READ LINE BY LINE (P69701–P69900)",
   "Static assertions over `app/api/inventory/[...path]/route.ts` and `app/api/issue-media/route.ts`, run as code against the files AS THEY ARE TODAY, with comments stripped first so a rule cannot pass on the sentence explaining its own fix. No key, no server, no login — so the whole band re-runs in under a second, for ever. Re-run: `node scripts/sweep/t16/blockA.mjs`"],
  ["B", "B · THE FOUR OWNER SCREENS AND THE INVENTORY EMBED, READ (P69901–P70060)",
   "The same method over the five files that draw something: Customers, Pay Later, Feedback & complaints, the Inventory door and the Inventory screen. Re-run: `node scripts/sweep/t16/blockB.mjs`"],
  ["C", "C · DRIVEN, HEADLESS — 1280×900, A35 360×780 dpr3, BOTH SKINS (P70061–P70180)",
   "ONE owner sign-in for the whole band (`scripts/sweep/login.mjs` caches it). Every context is created with `serviceWorkers: \"block\"`, or the panel's own service worker answers the fetch and a crafted reply never reaches the page. Assertions are on the RENDERED thing — visible text, element counts, computed styles, bounding boxes — never on the source. Re-run: `node scripts/sweep/t16/blockC.mjs`"],
  ["D", "D · THE INVENTORY SCREENS, WHICH NEED THE MODULE SWITCHED ON (P70181–P70260)",
   "The admin's inventory entitlement is OFF for French House, so this band switches it on, drives both views for one restaurant AND the estate screen for a two-restaurant owner (`diagmulti`), and PUTS IT BACK — in a `finally` and on `SIGINT`/`SIGTERM`, re-reading the row and asserting it is back. Aangan is never touched. Re-run: `node --env-file=.env.local scripts/sweep/t16/blockD.mjs`"],
  ["E", "E · CRAFTED REPLIES — THE STATES THE SHARED DEV DATABASE CANNOT MAKE (P70261–P70340)",
   "A failed read, a withheld entitlement, a partial read, a list at its cap, a rating outside 1–5, a blank name, an unreadable date, an attachment that is not an http address. Each is forced INSIDE the browser by answering the page's own request differently (`route.fulfill`), so the REAL page, the REAL stylesheet and the REAL branch render while nothing at all is written and no other terminal can be affected. Re-run: `node scripts/sweep/t16/blockE.mjs`"],
  ["F", "F · THE STOCK API ASKED REAL QUESTIONS, AS A REAL MANAGER (P70341–P70425)",
   "ONE manager sign-in. Every read path, every refusal path, and exactly one successful write — an expense, struck out and then removed BY ITS OWN ID in the same run. The five write paths that would post a movement into the append-only stock ledger are `⏭` with the reason and the pattern a later session should use. Re-run: `node --env-file=.env.local scripts/sweep/t16/blockF.mjs`"],
  ["G", "G · CROSS-PANEL TRUTH, AND MY OWN JUDGMENT (P70426–P70485)",
   "Does a change reach every panel that must show it and no panel that must not — traced by reading page → route → RPC → the panel at the other end. Then the questions a checklist cannot ask. Re-run: `node scripts/sweep/t16/blockG.mjs`"],
];

// Every id already on disk, so a collision is impossible rather than unlikely.
const taken = new Set();
for (const f of readdirSync(DIR).filter((x) => /^T\d+.*\.md$/.test(x))) {
  for (const m of readFileSync(`${DIR}/${f}`, "utf8").matchAll(/^\|\s*(P\d{5,6})\s*\|/gm)) taken.add(m[1]);
}

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
let out = "";
let n = 0, greens = 0, skips = 0;
const clashes = [];
for (const [key, heading, blurb] of BLOCKS) {
  const rows = JSON.parse(readFileSync(`.claude/sweep/t16-rows/${key}.json`, "utf8"));
  out += `\n## ${heading}\n\n${blurb}\n\n| id | check | result | note |\n|----|-------|--------|------|\n`;
  for (const r of rows) {
    if (taken.has(r.id)) clashes.push(r.id);
    n++;
    if (r.res === "✅") greens++; else if (r.res === "⏭") skips++;
    out += `| ${r.id} | ${esc(r.what)} | ${esc(r.res)} | ${esc(r.note)} |\n`;
  }
}
if (clashes.length) {
  console.error(`REFUSING TO WRITE — ${clashes.length} id(s) already exist on disk: ${clashes.slice(0, 8).join(", ")}`);
  process.exit(1);
}

const header = `

---

# ✦ SWEEP #8 · TERMINAL 16 — A FRESHLY PLANNED 785, \`P69701\`–\`P70485\`

**T14.md IS this territory's ledger, and that is why these rows are here.** Sweep 6's terminal 14
was *"the owner's Customers, Pay Later (khata), Inventory, Complaints & Manager mode"*; sweep 8
re-cut the territories from the real file structure and gave **T16** everything except Manager
mode, plus \`app/api/inventory/**\` and \`app/api/issue-media/**\` from T10. Filing a fourth round
anywhere else would mean *"re-run row P06501"* stopped being a sentence that points at one place.
(\`T16.md\` beside this file is a DIFFERENT territory — sweep 6's admin restaurants/owners/billing —
and is not touched.)

**Branch \`sweep8/t16-owner-customers-khata-inventory\`, worktree \`../wt-s8-t16\`, port 4316,
against \`origin/main\` 7c154754.** Block \`P69701\`–\`P70700\` was **pre-allocated in the prompt**, so
nothing was claimed from \`INDEX.md\`'s *Next free ID* line and that line was not edited — the single
cause of all six id collisions this sweep has recorded. **785 of the 1,000 used; \`P70486\`–\`P70700\`
are free.**

Restaurants written to: **French House** (the inventory entitlement, switched on and verified back;
one expense row, created and removed by its own id) and **Pizza Palace** (the same entitlement — it
was already on, so nothing changed). **Aangan was never touched. AV live was never read.** One owner
sign-in, one multi-restaurant owner sign-in and one manager sign-in for the whole run, all cached.
No deploy lock taken, no merge, no deploy.

## The 785

| band | what it asks | rows |
|---|---|---|
| A | the stock API and the attachment upload, read line by line | 200 |
| B | the four owner screens and the Inventory embed, read | 160 |
| C | driven headless at 1280×900 and 360×780 dpr3, in both skins | 120 |
| D | the Inventory screens, with the module switched on and put back | 80 |
| E | crafted replies — the states the shared dev database cannot make | 80 |
| F | the stock API asked real questions, as a real manager | 85 |
| G | cross-panel truth, and my own judgment | 60 |
| | **total** | **785** |

**${greens} ✅ · ${skips} ⏭ · 0 ❌ at the end of the run.** Seven problems were found and fixed on this
branch (items 1–7 of the report), and the rows that assert each fix are in the bands above.

## ↻ AND THE 2,022 ROWS ALREADY HERE WERE RE-RUN FIRST

**Regressions found: 1, and it is a guard, not the product.** \`verify:panel-api\` had been RED on
clean \`main\` since 2026-08-31 — the duplicate-ingredient rule demanded the literal
\`confirmDialog\`/\`window.confirm\` inside one handler, and on that date the whole dialog chain moved
out into a shared \`askYesNo()\` in the same file. A non-zero exit takes all 77 of that file's
assertions down with it, including the ones about \`app/api/inventory/[...path]/route.ts\`. Re-pinned
to the rule rather than the shape and sabotage-tested three ways (report item 1).

**How the 2,022 were re-executed** — \`node scripts/sweep/t16/rerun.mjs\` does the mechanical half and
prints this breakdown itself, so it is re-runnable rather than a claim:

| how | rows |
|---|---|
| a span the row QUOTES, asserted still present in the file it names — verbatim | 27 |
| …and on a whitespace/quote-normalised match (a row quotes a paraphrase) | 4 |
| a NEGATIVE claim ("must not", "no longer", "removed") re-checked and still satisfied | 18 |
| a span that lives in ANOTHER file, re-executed against the file it is really in | 28 |
| a span now found only in a COMMENT — the code moved, the explanation stayed | 5 |
| read by hand, because it was none of the above | 3 |
| re-run by the 20 standing guards of this territory + the 785 driven/static rows above | 1,937 |

**The one thing this pass paid for, and it is the ledger's own lesson arriving again.** The first
honest mechanical run reported **228 regressions**, and the first thirty were every one of them the
detector: it was extracting backticked spans from the *how to verify* and *note* columns as well as
the claim, so it was asserting that shell commands (\`git diff --name-only origin/main\`,
\`lsof -ti:4114\`), measured colour values (\`rgb(245,166,35)\`), fixture values a previous run typed
in (\`acknowledged_by: "Ravi"\`) and quoted FILE PATHS were all present inside the source. Restricted
to the claim column, and with the four meanings of "gone" told apart, it comes to **3** rows that
needed a human — and all three were fine. **A ledger row is prose, so a purely mechanical replay is
a SCREEN, not a verdict**; that is exactly why the table above categorises rather than asserts.

**The 20 guards of this territory, all green in this worktree:** \`verify:owner-money\` (55 rules —
seven added this run) · \`verify:owner-territory\` (49) · \`verify:owner-s7\` (300) ·
\`verify:owner-screen\` (114) · \`verify:owner-panel\` (75) · \`verify:owner-reports\` (153) ·
\`verify:owner-clash\` (11) · \`verify:owner-home\` · \`verify:customers\` (65) ·
\`verify:customer-erase\` (15) · \`verify:personal-data\` (16) · \`verify:panel-api\` (77, after item 1) ·
\`verify:panel-scope\` (8) · \`verify:panel-dialogs\` · \`verify:taps\` (33) · \`verify:busy\` (37) ·
\`verify:grants\` (175 functions) · \`verify:clash-coverage\` · \`verify:rejected\` (27 citations) ·
\`verify:server-only\` (113 client files) · \`verify:settings-columns\` · \`verify:wording\` ·
\`verify:guards-alive\` (9) · \`verify:ledger-index\` (60,959 rows, no collisions) · \`npm run typecheck\`.
\`verify:everything\` was NOT run: it is pid-locked and belongs to the merge terminal.

**Rows whose quoted code MOVED because this run changed it, updated in place, claim unchanged:**
\`P06598\` (Pay Later's mobile now goes through the shared \`showPhone\`, report item 5).
`;

const cur = readFileSync(T14, "utf8");
writeFileSync(T14, cur.replace(/\s*$/, "") + "\n" + header + out);
console.log(`appended ${n} rows to ${T14}  (${greens} ✅ · ${skips} ⏭)`);
