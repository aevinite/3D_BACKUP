# SWEEP #10 — 40 FRESH territories · 500 new checks each · FIX problems, LIST improvements · 2 at a time

**Stage: FIND-AND-FIX (one stage — his instruction: "they will find and solve issue in that").**
Planned 2026-10-08 against `origin/main` **dda906a6**. Rules `S10-RULES.md` · report shape
`S10-REPORT-FORMAT.md` · prompts `S10-T<n>-PROMPT.md` · launchers `run-S10-T<n>.sh`.

## What he asked for, in his words

> *"divide in 30 to 40 … make sure anything should not be left any kind of securtity error should not
> be left … or any like of vernablity of glich … we will start slow with 2 terminal at a time … you
> have to give the boundary they will find and solve issue in that … only plan and run 500 phases test
> within the boundary … list error unmerged and improve if anything there not for the sake of finding"*
> — and mid-planning: *"make sure you create new don't follow old data and also make sure everything
> should be covered"*.

## How each of those is honoured

| his ask | where it lives |
|---|---|
| 30–40 terminals | **40** — the measured ceiling; the three biggest files in the product (manager script 20k lines, manager route 6.7k, 51 admin routes) need two or three terminals each |
| a boundary each | every prompt names its exact files; a fresh cut over **1,658 tracked files, 0 unowned, 0 owned twice** (script-proven) |
| create new, don't follow old data | territories cut fresh from today's tree; old ledger results are NOT trusted until re-proven; the 500 checks are designed new per terminal |
| 500 phases each | 500 new checks per terminal, own 1,000-id block, own ledger file `T<n>-S10.md` |
| find AND solve | fix every problem, one commit each, a guard left behind, merged by the terminal, live on backup |
| no security gap, no glitch | §1b of every prompt (login + data separation, in product-correctness words) **plus** T36, a whole-product terminal on that one dimension |
| list errors · unmerged | four-part chat report; open PR **#1441** + branch `dependabot/…-bcd737bdc8` → T39 (wave 1, so later terminals test on the new versions); branch `docs/request-bill-screen-redesign` → T40 |
| improve only if real | improvements are LISTED in Part 4 for his pick — never built, never padded |
| 2 at a time | 20 waves of 2 |

## The 40 territories

| T | port | ID block | territory | files |
|---|---|---|---|---|
| 1 | 4401 | `P170001`–`P171000` | The guest menu and its three doors | 44 |
| 2 | 4402 | `P171001`–`P172000` | The dish page and the 3D viewer | 59 |
| 3 | 4403 | `P172001`–`P173000` | Ordering — the basket, placing an order, calling staff, rating | 14 |
| 4 | 4404 | `P173001`–`P174000` | The table session — a table shows only its own party | 24 |
| 5 | 4405 | `P174001`–`P175000` | App shell, offline, realtime and the small shared components | 22 |
| 6 | 4406 | `P175001`–`P176000` | Manager panel — editor/app.js, part 1 of 3 | 1 |
| 7 | 4407 | `P176001`–`P177000` | Manager panel — editor/app.js, part 2 of 3 | 1 |
| 8 | 4408 | `P177001`–`P178000` | Manager panel — editor/app.js part 3 of 3, the host page and inventory | 13 |
| 9 | 4409 | `P178001`–`P179000` | The manager panel's server route, part 1 of 2 | 1 |
| 10 | 4410 | `P179001`–`P180000` | The manager panel's server route, part 2 of 2 | 1 |
| 11 | 4411 | `P180001`–`P181000` | The kitchen screen | 6 |
| 12 | 4412 | `P181001`–`P182000` | The waiter tablet screen | 5 |
| 13 | 4413 | `P182001`–`P183000` | The waiter tablet's server route, and the shared floor logic | 7 |
| 14 | 4414 | `P183001`–`P184000` | The bill and KOT document | 10 |
| 15 | 4415 | `P184001`–`P185000` | The print queue and the print helper | 12 |
| 16 | 4416 | `P185001`–`P186000` | Shared panel plumbing — the helpers every panel loads | 23 |
| 17 | 4417 | `P186001`–`P187000` | Logins, sign-outs and the gates every request passes | 32 |
| 18 | 4418 | `P187001`–`P188000` | The access and permission model | 15 |
| 19 | 4419 | `P188001`–`P189000` | The admin's Access screens and people | 105 |
| 20 | 4420 | `P189001`–`P190000` | The owner's home dashboard | 11 |
| 21 | 4421 | `P190001`–`P191000` | The owner's Reports, every chart, and the analytics behind them | 20 |
| 22 | 4422 | `P191001`–`P192000` | The owner's Audit & logs, and the Team | 13 |
| 23 | 4423 | `P192001`–`P193000` | The owner's Customers, Pay Later, Loyalty, Inventory, Complaints and Ratings | 14 |
| 24 | 4424 | `P193001`–`P194000` | The owner's Settings, Menu editor, Manager mode and the console shell | 13 |
| 25 | 4425 | `P194001`–`P195000` | The admin console's home, shell, Repair and System health | 32 |
| 26 | 4426 | `P195001`–`P196000` | The admin's Restaurants and Owners | 9 |
| 27 | 4427 | `P196001`–`P197000` | The admin's Recycle bin, Billing, Usage, Rate limits, Platform floor, Logs and Bill ledger | 13 |
| 28 | 4428 | `P197001`–`P198000` | The admin server routes, part 1 | 26 |
| 29 | 4429 | `P198001`–`P199000` | The admin server routes, part 2 | 25 |
| 30 | 4430 | `P199001`–`P200000` | The money and compliance libraries | 20 |
| 31 | 4431 | `P200001`–`P201000` | Every remaining shared library — the data-reading helpers | 10 |
| 32 | 4432 | `P201001`–`P202000` | The database — migrations at positions 1–105 | 105 |
| 33 | 4433 | `P202001`–`P203000` | The database — migrations at positions 106–210 | 105 |
| 34 | 4434 | `P203001`–`P204000` | The database — migrations at positions 211–315 | 105 |
| 35 | 4435 | `P204001`–`P205000` | The database — migrations at positions 316–END | 103 |
| 36 | 4436 | `P205001`–`P206000` | LOGIN AND DATA-SEPARATION CORRECTNESS, EVERYWHERE (one dimension only) | 2 |
| 37 | 4437 | `P206001`–`P207000` | THE LOOK — layout, colour, size, fit (one dimension only) | 14 |
| 38 | 4438 | `P207001`–`P208000` | EVERY WORD ON EVERY SCREEN (one dimension only) | 5 |
| 39 | 4439 | `P208001`–`P209000` | THE REPO'S OWN GUARDS, CI, AND THE DEPENDENCIES | 532 |
| 40 | 4440 | `P209001`–`P210000` | Docs, root config, the odd folders, and THE REMAINDER | 89 |

## Waves — 2 at a time. Order = logins and money first, the whole-product dimensions last.

| wave | terminals | status |
|---|---|---|
| 1 | T17 + T39 | **LAUNCHED 2026-10-08** |
| 2 | T9 + T30 | not launched |
| 3 | T10 + T18 | not launched |
| 4 | T13 + T28 | not launched |
| 5 | T29 + T3 | not launched |
| 6 | T6 + T14 | not launched |
| 7 | T7 + T15 | not launched |
| 8 | T8 + T11 | not launched |
| 9 | T12 + T16 | not launched |
| 10 | T36 + T4 | not launched |
| 11 | T1 + T20 | not launched |
| 12 | T2 + T21 | not launched |
| 13 | T5 + T22 | not launched |
| 14 | T23 + T24 | not launched |
| 15 | T25 + T19 | not launched |
| 16 | T26 + T27 | not launched |
| 17 | T31 + T32 | not launched |
| 18 | T33 + T34 | not launched |
| 19 | T35 + T37 | not launched |
| 20 | T38 + T40 | not launched |

## Batch log

- **2026-10-08** — Stage 0: `LEDGER/INDEX.md` read; `verify:ledger-index` green (80,575 rows, no
  collisions); highest id on disk `P160958`. `P170001`–`P210000` pre-allocated in INDEX's new sweep-#10
  table, mark moved to `P210001`. Fresh 40-territory cut, prompts, launchers, rules and format written.
  Sweep-#9 paperwork (`S9-*`, `S8-STATE.md`, old `SWEEP-RULES.md`) deleted — that sweep ended at wave 3
  on 2026-09-17 and no worktree of it survives. **Wave 1 (T17 + T39) launched.**
