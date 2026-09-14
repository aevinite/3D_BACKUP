# SWEEP #9 — THE PLAN. 40 terminals · 50 new checks each · fix problems, LIST improvements.

Planned 2026-09-14 against `origin/main` **8e132881** (HEAD == origin/main, folder current).
Owner's instruction, in his words:

> *"it will be divided into forty terminals. You have to plan and give instruction to each terminal.
> They will plan the fifty phases test according to the instruction that you have given… They will
> test everything. They will do the fixes. They will not do the improvements. They will list that
> improvements. And if there is no fix and if there is no improvement, they don't have to do that…
> if everything is okay, they don't have to force to get the thing, but they should have to check
> everything. And if there is problem, they have to list that's must."*

## What this sweep IS — and the three ways it differs from #8

1. **50 new checks per terminal, not 500.** 2,000 new numbered checks total. The number is his. It
   is deliberate and it is not a thinner sweep: **the re-run of the existing ledger is the bulk of
   the work**, and 50 is the extension aimed at ground the ledger does not already stand on.
2. **Fix, do not improve.** A problem gets fixed, one commit per item. An improvement gets **listed
   in Part 4 of the chat report and never built.** Part 2 of the report is expected EMPTY, and the
   format file says so explicitly so no terminal treats it as a gap to fill.
3. **No quota, in the rules and in the format.** "This part is clean, here are the rows that prove
   it" is a complete result. Eight sweeps have re-filed the same deliberate designs as faults; the
   prompts point at the `Standing pre-empts` table and at `docs/REJECTED-IDEAS.md` before a terminal
   is allowed to list anything.

## Stage 0 — what the ledger said, and what was done about it

- `LEDGER/INDEX.md` read in full. **74,232 numbered checks across 44 files**
  (`cat .claude/sweep/LEDGER/ROW-COUNTS.json` — re-derived, not copied).
- **Next free ID was `P101595`.** Sweep #9 claimed `P101601`–`P105600` **in the registry, by the
  planning session, before a single prompt was launched** — forty blocks of 100. No terminal claims
  its own; the prompts forbid touching that line. That closes both fault classes the file records:
  the six stale-mark collisions (#7) and the 3,005-row block overrun (#8).
- **Every prompt carries the re-run duty**, with the `grep -ln` command to find its own rows and the
  named ledger files most likely to hold them — inherited from the S8 prompts, which had already
  been mapped file-by-file.
- **Sweep #8 stopped at 25 of 40.** Its batch log ends 2026-09-06 with waves 4–5 launched;
  **T26–T40 never ran** — the admin server routes, every owner route, all five migration blocks,
  the money/compliance and access libraries, every other library, the LOOK, the WORDING, the repo's
  own guards, and the docs/odd-folders remainder. **That is half the product, and it is why the
  wave order below is not 1→40.**

## The territories — inherited, and honestly so

Sweep #8 cut 40 territories from a **full structural analysis** of the real file tree on 2026-09-01
and proved the fence: **1,328 tracked product files matched against all 40 definitions, 0 unowned,
0 owned twice.** Re-cutting that two weeks later would throw away a measured split to produce a
near-identical one. So sweep #9 keeps it, and closes the only hole it actually has:

**46 product files landed after 2026-09-01** and belong to no territory and no ledger row. Every one
is now assigned, in a `## 2b` block in the owning terminal's prompt, flagged as *the highest-value
new ground you have — nobody has checked it once*:

| terminal | files that landed since 2026-09-01 |
|---|---|
| T11 printing | `lib/printSetupCode.ts`, `public/panels/billcustomer.css` |
| T12 panel plumbing | `public/panels/netretry.js` |
| T17 owner shell | `components/owner/ownerRestaurantSort.ts` |
| T23 admin access & people | `app/aevinite/people/page.tsx`, `owners/route.ts`, `users/route.ts`, `components/admin/{Crumbs,ShowPassword,nav,useReveal}` |
| T27 admin API part B | `app/api/admin/reveal/route.ts`, `app/api/admin/reveal/password/route.ts` |
| T33 migrations 321→end | migrations **378, 379, 380, 381** |
| T35 access libraries | `lib/revealGate.ts` |
| T36 every other library | `lib/{adminJump,guestName,netRetry,phoneText,plainError,staleCode}.ts` |
| T39 the guards | every script added under `scripts/` since 2026-09-01 (re-derived by command) |
| T40 docs & remainder | `docs/RUNBOOK.md`, `docs/LOYALTY-PLAN.md`, `docs/capture/**` (22 new documents) |

**Inventory re-derived today, never copied** (the prompts carry the command, not the digit):
55 page routes · 86 API routes (51 admin · 13 owner · 22 other) · 388 migrations · 142 `lib/` files ·
88 components · 187 `verify-*.mjs` · 202 npm `verify:`/`test:` entries · 1,764 tracked files.

## The 40 terminals

| T | port | ID block | territory |
|---|---|---|---|
| 1 | 4401 | `P101601`–`P101700` | The guest menu and its THREE doors |
| 2 | 4402 | `P101701`–`P101800` | The dish page and the 3D viewer |
| 3 | 4403 | `P101801`–`P101900` | The basket and placing an order |
| 4 | 4404 | `P101901`–`P102000` | The table session — a table shows only its own party |
| 5 | 4405 | `P102001`–`P102100` | Guest chrome, offline, every language, remaining shared components |
| 6 | 4406 | `P102101`–`P102200` | Manager panel — first half of `editor/app.js` |
| 7 | 4407 | `P102201`–`P102300` | Manager panel — second half of `editor/app.js`, and inventory |
| 8 | 4408 | `P102301`–`P102400` | Manager panel's host page and shell |
| 9 | 4409 | `P102401`–`P102500` | The kitchen screen |
| 10 | 4410 | `P102501`–`P102600` | The waiter tablet |
| 11 | 4411 | `P102601`–`P102700` | Printing, the bill document and the numbers on it |
| 12 | 4412 | `P102701`–`P102800` | Shared panel plumbing — the helpers every panel loads |
| 13 | 4413 | `P102801`–`P102900` | The owner's home dashboard |
| 14 | 4414 | `P102901`–`P103000` | The owner's Reports and every chart |
| 15 | 4415 | `P103001`–`P103100` | The owner's Audit & logs, and the Team |
| 16 | 4416 | `P103101`–`P103200` | The owner's Customers, Pay Later, Inventory, Complaints |
| 17 | 4417 | `P103201`–`P103300` | The owner's Settings, Menu editor, Manager mode, console shell |
| 18 | 4418 | `P103301`–`P103400` | The admin's Repair and System health |
| 19 | 4419 | `P103401`–`P103500` | The admin's Restaurants and Owners |
| 20 | 4420 | `P103501`–`P103600` | The admin's Recycle bin, Billing and Usage |
| 21 | 4421 | `P103601`–`P103700` | The admin's Platform floor and Rate limits |
| 22 | 4422 | `P103701`–`P103800` | The admin's Logs and the bill ledger |
| 23 | 4423 | `P103801`–`P103900` | The admin's Access tree, people, and money view |
| 24 | 4424 | `P103901`–`P104000` | The manager panel's server route |
| 25 | 4425 | `P104001`–`P104100` | The panel login routes and the remaining panel APIs |
| 26 | 4426 | `P104101`–`P104200` | The admin server routes, first 25 |
| 27 | 4427 | `P104201`–`P104300` | The admin server routes, 26 to the end |
| 28 | 4428 | `P104301`–`P104400` | The owner server routes, and every remaining route |
| 29 | 4429 | `P104401`–`P104500` | Migrations at positions 1–80 |
| 30 | 4430 | `P104501`–`P104600` | Migrations at positions 81–160 |
| 31 | 4431 | `P104601`–`P104700` | Migrations at positions 161–240 |
| 32 | 4432 | `P104701`–`P104800` | Migrations at positions 241–320 |
| 33 | 4433 | `P104801`–`P104900` | Migrations at position 321 to the END |
| 34 | 4434 | `P104901`–`P105000` | The money and compliance libraries |
| 35 | 4435 | `P105001`–`P105100` | The access and permission libraries |
| 36 | 4436 | `P105101`–`P105200` | Every other shared library file |
| 37 | 4437 | `P105201`–`P105300` | THE LOOK — layout, colour, size, fit (one dimension only) |
| 38 | 4438 | `P105301`–`P105400` | EVERY WORD ON EVERY SCREEN (text only, fenced against T37) |
| 39 | 4439 | `P105401`–`P105500` | The repo's own guards — alive, honest, cleaning up? |
| 40 | 4440 | `P105501`–`P105600` | Docs, the odd top-level folders, and THE REMAINDER |

## Waves — 5 at a time, and the order is NOT 1→40

Five is the number the owner asked to start with, and 5 is what each batch stays at.

| wave | terminals | why this order |
|---|---|---|
| 1 | **T1–T5** | His ask — start at the front: the guest's whole journey, the part a paying customer touches. |
| 2 | T26–T30 | **First of the never-run half.** Admin + owner server routes and the first two migration blocks. |
| 3 | T31–T35 | The last three migration blocks, then money/compliance and access libraries. |
| 4 | T36–T40 | Every other library, the LOOK, the WORDING, the guards, the remainder. |
| 5 | T6–T10 | The manager panel, kitchen and tablet — ran in #8, re-run + 50 new. |
| 6 | T11–T15 | Printing, plumbing, owner dashboard, reports, activity. |
| 7 | T16–T20 | Owner customers/settings, admin repair/restaurants/recycle. |
| 8 | T21–T25 | Admin floor/logs/access, the editor route, the panel APIs. |

**Waves 2–4 are the priority after his wave 1**: those fifteen terminals cover ground that has not
been swept once since 2026-09-01, while waves 5–8 re-run territories sweep #8 already worked.

## How a terminal ends — and the honest reason it is not "PR only"

Sweep #8's prompts said *nothing merges*. **Twenty-five PRs merged themselves anyway**, because
`CLAUDE.md` and the project memory both say *"done means LIVE ON BACKUP, not a PR"* and that rule
outranks a per-run suspension written in a prompt. Pretending otherwise produced a rule that was
broken 25 times and a plan that did not describe reality. So sweep #9 says what will actually happen:

**push a PR → rebase on fresh `origin/main` → typecheck and your area's guards green → merge your
own PR.** Vercel deploys `main` by itself. **No terminal deploys, no terminal takes
`.claude/deploy.lock`, no terminal force-pushes `main`.** A rebase conflict a terminal cannot
resolve honestly leaves the PR open with the reason in its report.

**The trade-off, stated plainly:** 40 terminals merging their own work means fixes reach the backup
site the same day and the owner never has a PR backlog — and it means **nothing gates a bad fix but
that terminal's own typecheck and guards.** The alternative (PR-only) gates every change behind one
merge terminal and was proven unenforceable. If the owner wants the gate back, it needs a line in
`CLAUDE.md` itself, not in a prompt.

## Files this run owns

- `.claude/sweep/S9-RULES.md` — the rules every terminal obeys.
- `.claude/sweep/S9-REPORT-FORMAT.md` — the owner's fixed four-part report shape, amended so Part 2
  is expected empty.
- `.claude/sweep/S9-T<n>-PROMPT.md` × 40 · `.claude/sweep/run-S9-T<n>.sh` × 40.
- `.claude/sweep/STATE.md` — stage, wave log, and which windows are live.
- `LEDGER/` — **never deleted, never archived.** The rows are the product's permanent test record.
