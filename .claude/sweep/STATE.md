# SWEEP #9 — 40 terminals · 50 new checks each · FIX problems, LIST improvements

**Stage: FIND-AND-FIX (one stage, his instruction). Wave 1 = T1–T5, launched 2026-09-14.**
Plan: `.claude/sweep/S9-PLAN.md` · Rules: `S9-RULES.md` · Report shape: `S9-REPORT-FORMAT.md`.
Planned against `origin/main` **8e132881**. Sweep #8's own state is kept as `S8-STATE.md` (history).

## The three rules that define this run

1. **50 new checks each** (his number) — on top of **re-running the existing ledger rows that cover
   each terminal's own files**. The ledger is 74,232 rows across 44 files; the re-run is the bulk.
2. **Fix problems. Do not build improvements.** Improvements are LISTED in Part 4 of the chat report
   and nowhere else. **Part 2 of every report is expected EMPTY.**
3. **No quota.** "This part is clean, here are the rows that prove it" is a complete result. Nothing
   is forced. But checking everything in the territory is mandatory.

## ID allocation — claimed by the PLANNING session, not by terminals

`P101601`–`P105600`, forty blocks of 100. `LEDGER/INDEX.md`'s *Next free ID* is now `P105601`, landed
on `main` before any terminal started. **Every prompt forbids reading or editing that line.** This
closes both recorded fault classes: #7's six stale-mark collisions and #8's 3,005-row block overrun.

## Sweep #8, honestly: it stopped at 25 of 40

Its batch log ends 2026-09-06. **T26–T40 never ran** — admin + owner server routes, all five
migration blocks, money/compliance and access libraries, every other library, the LOOK, the WORDING,
the repo's own guards, the docs/remainder. Wave order below puts those fifteen first after his wave 1.

## Wave log

| wave | terminals | status |
|---|---|---|
| 1 | **T1–T5** | **LAUNCHED 2026-09-14** — five Terminal windows, the owner owns and closes them |
| 2 | T26–T30 | not launched — say `next` |
| 3 | T31–T35 | not launched |
| 4 | T36–T40 | not launched |
| 5 | T6–T10 | not launched |
| 6 | T11–T15 | not launched |
| 7 | T16–T20 | not launched |
| 8 | T21–T25 | not launched |

## Terminal status

| T | port | ID block | branch | status |
|---|---|---|---|---|
| 1 | 4401 | `P101601`–`P101700` | `sweep9/t1-guest-menu-and-three-doors` | LAUNCHED |
| 2 | 4402 | `P101701`–`P101800` | `sweep9/t2-dish-page-and-3d` | LAUNCHED |
| 3 | 4403 | `P101801`–`P101900` | `sweep9/t3-basket-and-placing-an-order` | LAUNCHED |
| 4 | 4404 | `P101901`–`P102000` | `sweep9/t4-table-session-and-who-you-are` | LAUNCHED |
| 5 | 4405 | `P102001`–`P102100` | `sweep9/t5-guest-chrome-and-every-shared-component` | LAUNCHED |
| 6–40 | 4406–4440 | `P102101`–`P105600` | `sweep9/t<n>-…` | waiting |

## How a terminal ends

PR → rebase on fresh `origin/main` → typecheck + its area's guards green → **merges its own PR**.
Vercel deploys `main` by itself. No terminal deploys, takes `.claude/deploy.lock`, or force-pushes
`main`. Full reasoning, and the trade-off it accepts: `S9-PLAN.md` → *How a terminal ends*.

## Batch log

- **2026-09-14** — Stage 0 done: `LEDGER/INDEX.md` read in full, row counts re-derived (74,232 across
  44 files), ID range `P101601`–`P105600` claimed in the registry by the planning session. Territories
  inherited from sweep #8's measured cut (0 unowned / 0 owned twice on 2026-09-01) with **46 files
  that landed after that date newly assigned** across T11, T12, T17, T23, T27, T33, T35, T36, T39, T40.
  `S9-RULES.md`, `S9-REPORT-FORMAT.md`, `S9-PLAN.md`, **all 40 prompts + 40 launchers** written.
  **Wave 1 (T1–T5) launched.**
