# SWEEP #10 · TERMINAL 7 — findings · the manager panel, middle third (`public/panels/editor/app.js`, `printZReport()` → the end of `openTakeOrder()`)

Run 2026-10-16 on port 4407 from worktree `wt-s10-t7`, signed in once as French House's manager. Nothing
was written to the database by any check: busy tables are an in-memory party, and every refusal / queue /
clash was driven by replacing `api()` for one check and putting it back.

## Re-run: 786 existing rows, in place
T7.md (sweep #8 T7, 370 in this third) · T6.md (sweep #8 T6, 174) · T5.md (232 — 191 text rows landing
here, 8 whose pattern moved, 33 driven screens) · T12 2 · T27 2 · T30 5 · T8 1. **784 ✅ · 1 ❌ · 0 ⏭**, plus
2 regressions found ❌ and fixed ✅. Runners: `scripts/sweep/t7s10/{inventory,rerun-t7s8,rerun-t6s8,rerun-t5,rerun-live,writeback}.mjs`.

**Regressions:** P99277 (✅ 2026-09-03) — the table popup's ✎ Edit button never drew (item 1). P61098
(✅ 2026-09-03) — a paid waiting ticket wore a ✕ Cancel the server refuses (item 2).
**The ❌:** P60534 — `unblock()` has had no caller since the floor's Blocked card left; not a product fault, listed.

## Problems fixed — one commit each
| # | where | what | guard |
|---|---|---|---|
| 1 | a table's bill popup | ✎ Edit never drew since 2026-09-17 (a per-row `allOut` shadowed the table-wide one) | verify:manager-behaviour L |
| 2 | a table's bill popup → the waiting ticket | ✕ Cancel offered on a PAID ticket the server always refuses | verify:manager-behaviour M |
| 3 | Audit & logs (list, removal story, older dates) | three clocks printed the viewer's time zone | verify:manager-behaviour I (middle third at zero) |
| 4 | Menu → a dish → 📷 Upload a photo | no deadline: 'Uploading…' for ever on a stalled network | verify:manager-behaviour N |
| 5 | a table's bill popup | the course order stayed OLD after categories were reordered / a dish moved | verify:manager-behaviour O |
| 6 | Menu → Tags ticks, and a dish's Save | a stale tag list could undo the kitchen's Sold out (no first-save-wins) | verify:clash-coverage + verify:manager-behaviour P |
| 7 | Audit & logs → Keep logs for | a refused change left the dropdown on the refused window | verify:manager-behaviour Q |
| 8 | Menu → Save, two managers at once | the loser read 'Save failed: clash_changed_elsewhere' | verify:manager-behaviour R |
| 9 | ＋ Take order, after a refusal | the kitchen note box came back empty but the note was still sent | verify:manager-behaviour S |
| 10 | the floor | a phantom 'Free' table above the plan that the waiter's floor did not draw (header 0/31) | verify:manager-behaviour T |

## Noticed OUTSIDE this third (left for its owner)
- **T6/T8's thirds** — six direct `fetch()` calls with no deadline (app.js ~1690, ~1856, ~2156, ~15453, ~20043, ~20051); verify:manager-behaviour N holds them at six by ratchet.
- **T8's third** — `bindTablePanel`'s unmerge and table-op catches print `e.message`; none of them sends an expectation, so no clash code can show — noted only.
- **style.css (T8)** — on a phone the take-order sheet's footer covers the cart lines until the sheet is scrolled.
- **The waiter tablet (T12)** — an unknown call note shows 🔔 there and 🙋 here.
