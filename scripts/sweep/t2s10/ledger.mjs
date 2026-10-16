// scripts/sweep/t2s10/ledger.mjs — build .claude/sweep/LEDGER/T2-S10.md from this run's results.
//   node scripts/sweep/t2s10/ledger.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, OUT } from "./lib.mjs";
const J = (f) => JSON.parse(readFileSync(join(OUT, f), "utf8"));
const blocks = [
  ["S", "new-src.json", "SOURCE — the code as it is today, comments stripped first (`node scripts/sweep/t2s10/new-src.mjs`)"],
  ["U", "new-unit.json", "IN PROCESS — the real lib file bundled, only the network/database stood in (`new-unit.mjs`)"],
  ["D", "new-db.json", "FILES + DATA — the static configs, GLBs and dish photos byte by byte, served, and matched to the dish rows; read-only (`new-db.mjs --base`)"],
  ["L", "new-live.json", "DRIVEN — a production build on port 4402, three devices, both skins, two restaurants (`new-live.mjs --base`)"],
  ["R", "new-regress.json", "THIS RUN'S FIXES PROVED — each new guard broken once and restored; area guards; WebKit and Firefox (`new-regress.mjs --base`)"],
  ["V", "new-visual.json", "SEEN + JUDGMENT — screenshots taken, opened and looked at, then deleted; and the judgment calls"],
];
const prefix = J("prefix.json");
const esc = (s) => String(s ?? "").replace(/\|/g, "¦").replace(/\n/g, " ");
let rows = [], tally = { ok: 0, bad: 0, skip: 0, fixed: 0 };
for (const [k, f, title] of blocks) {
  const r = J(f);
  rows.push(`\n### Block ${k} — ${title} · ${r[0].id}–${r.at(-1).id} (${r.length})\n\n| id | check | how to verify | result | note |\n|----|-------|---------------|--------|------|`);
  for (const x of r) {
    let res = x.skip ? "⏭" : x.ok ? "✅" : "❌";
    let note = x.note;
    if (prefix[x.id] && x.ok) { res = "❌→✅"; note = `${prefix[x.id]} · AFTER: ${x.note || "pass"}`; tally.fixed++; }
    if (x.skip) tally.skip++; else if (x.ok) tally.ok++; else tally.bad++;
    rows.push(`| ${x.id} | \`${x.file}\` — ${esc(x.what)} | ${esc(x.how)} | ${res} | ${esc(note)} |`);
  }
}
const total = tally.ok + tally.bad + tally.skip;
const md = `# SWEEP #10 · TERMINAL 2 — THE DISH PAGE AND THE 3D VIEWER · ids P171001–P172000

**Territory:** \`app/item/[slug]/{ItemClient,page,not-found}.tsx\` · \`app/r/[restaurant]/item/[slug]/{page,not-found}.tsx\` ·
\`app/view/[folder]/{ViewerClient,page}.tsx\` · \`components/{PublicModelViewer,ModelToastHost}.tsx\` ·
\`lib/{modelLoader,modelWatchlist,mediaLinks}.ts\` · \`public/content/items/{Croissant,Waffle}/config.json\` ·
the four \`public/models/*.glb\` · the 41 \`public/dishes/french-house/*.webp\`.

**Branch** \`sweep10/t2-dish-page-and-the-3d\` · worktree \`../wt-s10-t2\` · **production build on port 4402** ·
against \`origin/main\` 624f2392. Ids from this terminal's pre-allocated block only; the *Next free ID* line was
neither read nor edited. **${total} new checks** (P171001–P171765, gaps between blocks left unused) ·
${tally.ok} ✅ (of which ${tally.fixed} ❌→✅, red on today's main and green after this run's fixes) · ${tally.bad} ❌ · ${tally.skip} ⏭.

## The re-run came first — 3,560 older rows, 0 regressions

Every older row whose subject is a file in this territory: **3,535 in \`T2.md\`** (sweeps #6–#9's T2; the
StarRating / InfinityLoader / Particles rows belong to another terminal now and were left alone) and **25 in eleven
other ledgers**, stamped in place \`· s10·T2 <mark>\` + \`**re-run 2026-10-16 (sweep #10, T2):** <evidence>\`.
How each was re-proved (\`scripts/sweep/t2s10/rerun.mjs\` builds the decisions, \`stamp.mjs\` writes them):

* **500** by sweep #9's own harness (\`scripts/sweep/t2/s9r2-{checks,live}.mjs\`, run from a copy pointed at this
  worktree): 497 green; the 3 reds were a file that grew by comment lines, a regex that named a field mig 418
  retired, and the harness's own race — each re-aimed with the measurement in its row.
* **the "break it and the guard notices" rows** by breaking each behaviour again today
  (\`scripts/sweep/t2s10/sabotage.mjs\`): first run 28 of 30 caught — one miss was my own mutation hitting a
  comment (re-aimed), the other a real hole: **the single-diet check could never fail** — fixed as item 6.
  Final run over the fixed tree: 31 of 31.
* **the driven families whose code moved** (mig 402 tags, AR at 40%, the reveal curtain, mig 418 "my review",
  the related label, the lightbox) re-driven by \`scripts/sweep/t2s10/redrive.mjs\` — 32 re-drives, all green —
  plus verify:guest --base (134/134), verify:cache, verify:slow-load and verify:notfound (28/28) on 4402.
* **the rest** by a mechanical test of the claim against today's code (\`classify.mjs\`): every backticked
  identifier a row names is located in the version of the file its last green stood on (6b8ae9dc) and checked
  against every hunk changed since; class/id rules, written-and-read fields and named decisions are re-tested
  against today's files.
* **found while re-running, recorded in the rows:** sweep #9 stamped four rows "still true" on 2026-09-14 whose
  subject (\`readTimedOut\`, \`retryNonce\`, the deadline branch) had been DELETED on 2026-09-02 — stamped
  ⏭ SUBJECT RETIRED now, with that said plainly. Two rows' subject was retired by the owner (AR no longer replays
  the reveal, R57) — ⏭ RETIRED. Three ⏭ rows that had waited up to three sweeps are closed: a real review was
  posted and removed by its key (P00763, P00815), and a second restaurant with real 3D dishes now exists (P52526).

Re-run tally: 3,541 ✅ · 12 ⏭ (deliberate or retired, each with its reason) · 2 ❌→✅ (the guard hole, item 6) ·
5 ❌ kept as written (ledger corrections and one standing fact). **Regressions: 0.**

## Why these ${total}, measured before writing one

Rows that NAME each file across every ledger (rows · rows that DROVE the app), 2026-10-16:
\`PublicModelViewer.tsx\` **0 · 0** · \`view/[folder]/page.tsx\` 2 · 0 · the dish 404 twins 3 · 0 ·
\`dishes/french-house/*.webp\` 6 · 4 · \`ModelToastHost.tsx\` 7 · 2 · \`mediaLinks.ts\` **7 · 0** · the two
\`config.json\` **8 · 0** · the GLBs 8 · 1 · \`r/[restaurant]/item/[slug]/page.tsx\` 9 · 3 · \`ItemClient.tsx\` 10 · 0 ·
\`modelWatchlist.ts\` 13 · 1 · \`modelLoader.ts\` 14 · 2 · \`item/[slug]/page.tsx\` 22 · 13 · \`ViewerClient.tsx\` 29 · 6.
(T2.md's own rows name their file through the block they sit in, not the row — this run names the file in EVERY row.)
And \`git log --since=2026-09-01\` over the territory: mig 402 (the tags moved to the dish row), AR at 40%, the
reveal curtain, mig 418 (my review), the related-row label, the lightbox keyboard — the least-checked code.
${rows.join("\n")}
`;
writeFileSync(join(ROOT, ".claude/sweep/LEDGER/T2-S10.md"), md);
console.log(`T2-S10.md: ${total} rows · ${tally.ok} ✅ (${tally.fixed} ❌→✅) · ${tally.bad} ❌ · ${tally.skip} ⏭`);
