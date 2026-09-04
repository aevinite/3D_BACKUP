# T11 of sweep #8 — printing, the bill document and the numbers on it

**Branch** `sweep8/t11-printing-and-the-bill-document` · **worktree** `../wt-s8-t11` · **port** 4311
**Ledger** `LEDGER/T8.md` sections A–J, re-run in place · `LEDGER/T11.md`, 531 new rows
**Ran** 2026-09-04 against `origin/main` 7c154754

Every item below is one commit, with its number in the message, so any single one can be dropped
without unpicking the rest. The four-part report went to the terminal window, as sweep #8 requires.

## Re-run first: no regressions

297 inherited rows re-executed BY ID (not re-read): **295 ✅ · 0 ❌ · 2 ⏭.**
Plus `verify:printing-sweep` 490 phases (486 ✅ · 0 ❌ · 4 ⏭, the four need real CUPS virtual
printers) and six print guards green. **This territory had no regressions.**

## Found and fixed — 13

| # | what was wrong | where a person would see it |
|---|---|---|
| 1 | a discount under 50 paise printed **"Discount − ₹0"** over "Taxable value ₹200", and lost its percentage too. Reachable from the discount modal's own 5% option: 5% of a ₹9 chai is ₹0.45 | the guest's printed bill |
| 2 | the screen's first sentence said "the toggle below picks one" — that toggle was deleted 2026-08-31 | Admin → Printing, the subheading |
| 3 | three "go to step N" sentences named the wrong step; one sent you to the step you were reading | Admin → Printing, steps 2 and 3 |
| 4 | a **green tick** claimed kitchen slips print while they were switched off, four rows above the grey line saying they do not | Admin → Printing → 4 · The kitchen screen |
| 5 | the print log timestamped every job in the reader's clock, not the restaurant's | Admin → Printing → 5 · What has printed |
| 6 | a **bill or banquet sheet that gave up after five tries told nobody** — no floor strip, no ping. Only kitchen slips did | manager's notification bell, and the owner's phone — by their absence |
| 8 | the deleted backup printer still had a live sentence on the kitchen screen, off a field nothing ever set | kitchen screen → ☰ → 🖨 Printing |
| 10 | the kitchen-printing record described **three controls that no longer exist**, and numbered its checklist 1,2,3,4,5,6,6 | `docs/KITCHEN-PRINT-SETUP.md` |
| 11 | the page a RESTAURANT reads taught the same three deleted controls, as one of "four things that decide whether a ticket comes out" | `/print-setup.html` |
| 12 | the **Windows helper could never install the PDF printer it needs** — a checksum compared a value cmd.exe expands before the block runs, so it always mismatched and deleted the download | a Windows shop: nothing prints, ever |
| 13 | on Linux the helper reported **no paper size** and half the model name ("Zijiang", not "Zijiang ZJ-80") | Admin → Printing → step 3's dropdown |
| 14 | the Windows and Linux print-station files had no one-at-a-time guard and wrote no log; Windows made a log folder it never used | a second Chrome raising itself in front of somebody's work |
| 15 | at 360px the **↻ Refresh button sat entirely off screen** (381→480 in a 360px viewport) with no scroll to reach it | Admin → Printing on a phone |

## Improvements — 4

| # | what |
|---|---|
| 7 | `verify:printing-sweep` had the WRONG STEP NUMBER pinned inside it, so it stayed green over item 3 and only went red when item 3 fixed it. Re-pinned to the rule, plus a new phase that checks every "step N" against `printBoardWords.ts` |
| 9 | `verify:print-helper` exempted `backupFor` "because a helper file already installed on a restaurant's PC reads that field". **No helper has ever read it** — `git log -S` over the whole history of the generated scripts is empty. The exemption was keeping a dead field alive on an unsourced premise |
| 18 | `verify:printing-sweep` phase 187 failed on a WORD IN A COMMENT — the third time that phase has been too broad, by its own record. Narrowed to executable lines; sabotage-checked |
| 19 | a harness (`scripts/sweep/t11/`) that makes 297 inherited rows and 531 new ones **re-runnable by id** — `--only P03506` — so the next sweep can converge instead of re-inventing |

## Reported, NOT fixed — 2, and both need a Windows machine

- **16** — the Windows helper reports a ticket **PRINTED** when the printer is switched off: it trusts
  SumatraPDF's exit code, while the Mac and Linux paths follow the CUPS job to completion (measured
  and fixed there on 2026-08-20). Needs `Get-PrintJob` and a Windows machine to test.
- **17** — the Windows print-station has no one-at-a-time guard. A batch file cannot hold a lock
  across its own exit, so the honest guard is "is a Chrome already on this profile?" — untestable
  from macOS.

Ledger rows `P64784`, `P64787` and `P64762` report these rather than passing, each naming its item.

## Every fix left a guard behind

`verify:print-paper` §3o (item 1, both directions, sabotage-checked) · `verify:printing-sweep`'s four
new driven bill-parking phases (item 6) and its "every step N names the step that holds it" phase
(items 3 and 7) · `verify:print-helper` block 8j, which walks both Windows templates for the
same-block `%VAR%` class (item 12) · bank A's four DRIVEN printer-discovery rows (item 13) · bank D's
scroller-aware 360px reachability row (item 15) · `verify:print-helper`'s replacement check for
item 9. Every one was sabotage-tested: broken, seen to go red, restored, seen to go green.

## What I did not cover, plainly

T8's sections K–N and its sweep-#7 block (`P03801`–`P03999`, `P18601`–`P19100`) were not re-executed
row by row — they are the browser/screenshot/cross-panel/judgment rows. A lot of that ground was
covered by driving the real app this run, but that is not the same as re-running those ids. They are
the first thing for the next session to pick up.
