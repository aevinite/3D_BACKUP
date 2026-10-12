# SWEEP #10 · TERMINAL 6 — findings · the manager panel, first third (`public/panels/editor/app.js` lines 1 → end of `openZReport()`)

Run 2026-10-12 on port 4406 from worktree `wt-s10-t6`, signed in once as French House's manager (and,
for the screens a manager is not given, the admin's own view of French House — zero login requests).
Nothing was written to the database by any check: every state a normal day does not visit was driven
with `api()` replaced for one check and put back in a `finally`.

## Re-run: 1,173 existing rows, in place
T6.md (sweep #8 T6: 793 now in this third) · T5.md (231 text assertions landing here, 77 driven
screens, absences and deliberate changes) · 37 rows in T27, T8, T30, T30-S10, T26, T9, T21, T29, T28,
T9-S10. **1,170 ✅ · 2 ❌ · 1 ⏭.** Runners: `scripts/sweep/t6s10/{inventory,rerun-t6s8,rerun-t5,rerun-t5-live,rerun-other,writeback}.mjs`.

**Regression:** P02394 (✅ 2026-08-23) and P60553 (✅ 2026-09-03) — the receipt of a cancelled bill
listed priced dishes. Fixed (item 1).
**The two ❌:** P60350 / P60362 — `financialYear()` and `mrpTaxInside()` have had no caller since
2026-08-04 (#794); the earlier ✅ counted `LFH_BILLDOC.x` as a caller. Not a product fault; listed.

## Problems fixed — one commit each
| # | where | what | guard |
|---|---|---|---|
| 1 | Bills → Previous bills → the receipt | a cancelled bill listed its dishes WITH prices over Total ₹0 (the owner's 2026-07-03 screen, back since 2026-08-22) | verify:bills-screen §7 |
| 2 | any Print bill, with no signal | said "Sent to the printer", opened nothing, and left the send queued to print by itself later | verify:queued-truth D2 |
| 3 | Rating review | ✎ Note did nothing; every internal-note box sat open | verify:ui §16 (all panels) |
| 4 | Pay Later · On the house · Rating review · Dashboard · performance report | four clocks used the READER's time zone | verify:manager-behaviour I |
| 5 | Dashboard → Staff watch / Menu winners | "over last7" — the range key in a sentence | verify:manager-behaviour J |
| 6 | Dashboard → GST report | "No paid bills in this month." under "Covering today" (T9's P178707) | verify:manager-behaviour K |
| 7 | Bills → Previous bills, read failing | "Still reading…" for ever over bills the device already had | verify:bills-screen §8 |

## Noticed OUTSIDE this third (left for its owner)
- **T7's third** — `renderEditor()` still wires `[data-bill-open]`, `[data-bill-open-btn]`, `[data-bill-print]`, `[data-parcel-print]`, which nothing emits since the record cards were deleted (2026-09-03): dead wiring.
- **T7/T8's thirds** — two more unpinned clocks (app.js ~8314, ~8324) and two `d.toLocale…` / `x.toLocale…` (~8990, ~9125); the ratchet in verify:manager-behaviour I holds the first two.
- **T7/T8** — the banquet sheet's Print (`/print/send` kind banquet, ~19042) and the KOT reprint (~14735) read `r.queued` the same way item 2 fixed for the bill.
- **T12 (waiter tablet)** — `printBill`'s hand-off (`public/panels/tablet/app.js` ~905) has item 2's exact shape: offline it toasts "Sent to undefined".
- **style.css** — the gold `.bill-day-total b` measures 2.37:1 on the light skin; `.tp-bl` has no gap, so a long value touches its label ("GSTINnot set").
