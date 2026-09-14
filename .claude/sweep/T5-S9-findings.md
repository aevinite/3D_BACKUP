# Sweep #9 · Terminal 5 — findings

**Territory:** guest chrome, the offline layer, every language, and every remaining shared
component — 40 files (`public/sw.js`, `public/offline.html`, `lib/i18n.ts`, and all 37 top-level
`components/*.tsx` except the six owned by T1–T4).

**Branch** `sweep9/t5-guest-chrome-and-every-shared-component` · **worktree** `../wt-s9-t5` ·
**port** 4405 · **against `origin/main` b8d27f15**, on a production build.

## Result: this part is clean.

- **2,086 existing ledger rows re-run · 2,074 ✅ · 12 ⏭ · 0 ❌ · NO REGRESSION.**
- **50 new checks written and executed (`P102001`–`P102050`) · 46 ✅ · 0 ❌ · 4 ⏭.**
- **0 problems found, so 0 fixed.** No improvement was built — by the owner's instruction for this
  run, every idea is listed in the chat report instead.

The full breakdown, the re-run commands, the 50 rows and the honest list of what this run could
NOT reach live in `.claude/sweep/LEDGER/T5.md` under **"T5 — SWEEP #9"**.

## What this run changed in the repo

| file | why |
|---|---|
| `scripts/sweep/t5s9/lib.mjs` | shared reader/stripper/runner for the three new scripts |
| `scripts/sweep/t5s9/rerun-foreign.mjs` | re-runs the 259 rows that live in OTHER terminals' ledgers but are about this territory's files — nobody had ever run them from this side |
| `scripts/sweep/t5s9/rerun-t27-dictionary.mjs` | re-runs T27's 134 `lib/i18n.ts` rows, taking the key and the recorded value OUT OF THE LEDGER so it cannot drift from the rows it claims to re-run |
| `scripts/sweep/t5s9/new-static.mjs` | the 34 static rows of this run's 50 |
| `scripts/sweep/t5s9/new-live.mjs` | the 16 driven/looked-at rows |
| `scripts/sweep/t5s9/stamp.mjs` | writes the re-run result onto each row IN PLACE, in the file it lives in, inserting before the final UNESCAPED pipe |
| `package.json` | `npm run verify:t5s9` — so these scripts are reachable and cannot quietly rot |
| `.claude/sweep/LEDGER/*.md` | 394 rows stamped with this run's result; 50 new rows in `T5.md` |
| `.claude/sweep/shots/S9-T5/` | the three screenshots cited by `P102047`–`P102049` |

## One thing that was nearly filed as a fault, and was not

On the owner's phone the filter chips LOOK cut off behind the list/grid switch. Measured:
`.filter-row` is a horizontal scroller (scrollWidth 408, clientWidth 244) and the switch sits beside
it — scroll to the end and every chip is fully visible and hit-testable. A look, not a fault, and it
belongs to `components/MenuView.tsx` (T1's ground) either way. Carried to the owner as a decision.
