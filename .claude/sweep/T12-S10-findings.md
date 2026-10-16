# Sweep #10 · T12 · the waiter tablet screen — findings

Territory: `public/panels/tablet/app.js` · `public/panels/tablet/index.html` · `app/tablet/page.tsx` ·
`app/tablet/layout.tsx` · `app/r/[restaurant]/tablet/page.tsx`. Ledger: `LEDGER/T12-S10.md` (P181001–P181500).
Re-runnable: `node scripts/sweep/t12s10/run.mjs` (port 4412).

## Fixed on branch `sweep10/t12-waiter-tablet` — one commit each

| # | what was wrong | evidence | guard |
|---|---|---|---|
| 1 | **REGRESSION** — `verify:tablet-taps` was red on main: the R67 change (98a3cac6, 2026-10-11) rightly made the KOT ▾ Split row `splitBillOn() && tshow("tablet_mark_paid")`, and the guard still asked for the old shape. P208660 (T39-S10) was ✅ on 2026-10-08. | guard output, 1 of 124 red | the check now asks for both halves |
| 2 | **Print bill with no internet** said "Sent to undefined", opened nothing, and the saved request would have printed at the counter later. The device's queue answer `{queued:true, why}` was read as the printer's. | b-live P181333–P181334 | verify:tablet-taps (queue-answer + print) |
| 3 | Questions asked with no internet (the 🖨 "where?" probe, both loyalty look-ups) sat in "waiting to send" as changes nobody made. | b-live P181335–P181336 | verify:tablet-taps |
| 4 | A banquet bill saved offline was announced "created — total ₹0". | b-live P181337 | verify:tablet-taps |
| 5 | Tips: posted alongside the payment and without the manager PIN, so on a PIN-gated restaurant every tip was refused; a cancelled PIN left a tip on an unpaid bill; the split door wrote the tip early and the split screen then showed none; a merged child's tip found no ticket. | b-live P181339–P181342 (stand-in PIN gate), P181270 | verify:tip §6/§6b rewritten, verify:tablet-taps |

Sabotage: with origin/main's `app.js` put back, verify:tablet-taps fails 5 and verify:tip fails 5.

## Found, NOT fixed here — outside this territory

* **Back button drift** (`public/panels/backstack.js`, T16): a box closing and another opening straight after an
  await leaves the history count one too high; the next close that empties the stack leaves the panel (inside
  /tablet the whole page goes back). Reproduced: ↩ Mark unpaid → Yes → Cancel on the reason box. Reported to T16,
  who reproduced and fixed it on `sweep10/t16-shared-panel-plumbing-the-helpers` (907a9dcd, `verify:panel-backstack`).
  Row P181345 stays ❌ until that merges.
* **Two devices saving the same dish quantity in the same instant both win** (`lib/clash.ts` + the panel routes,
  T30's / T13's): both requests carry `expect: {qty: 1}` and both are answered 200, so the second silently replaces
  the first — the "first save wins, loser told" rule holds only when the two saves are a moment apart (P181165 ✅
  there). Row P181166 ❌. Needs the write itself to be conditional (e.g. `UPDATE … WHERE qty = <expected>`).

## Round 2 (2026-10-15) — the owner's "do all the things you listed", then a re-planned full test

| # | what | commit | guard |
|---|---|---|---|
| 6 | two notes in index.html / app.js described a load order and a phone band that are not the real ones | 28955a46 | — (wording) |
| 7 | "Your tables 1–500 · 500 tables" on a 30-table floor — the strip now counts only tables on the floor | c0fe2913 | verify:tablet-taps |
| 8 | a shared tablet opened Take order on the previous restaurant's saved dishes — the cache is per restaurant now, the old key removed | bbd9303c | verify:tablet-taps |
| 9 | back-button count drift — fixed by T16 (merged 2026-10-13), proved here by round 2 L6 | (T16) | verify:panel-backstack |
| 10 | two same-instant saves of one row both won — saves that carry an expectation now take a turn on the row (mig 422) | 6035aee3 | verify:edit-turns (new), verify:clash-coverage |
| 11 | the manager panel's banquet sheet printed offline said "Sent to the printer"; its KOT "where?" probe sat in the queue | 6fde5e4e | verify:queued-truth §D3 |
| 12 | on a phone a free table showed only its number — the state word now stays | 43be9da8 | verify:tablet-taps |
| R2-a | a dead `data-bill-print-btn` hook left on the Print bill label since R62 (found by G2) | 8d61ce33 | t12r2 G2 |
| R2-b | no box on the tablet was a dialog to a screen reader (found by L9) | 23c723ef | verify:tablet-taps |

Re-planned test: `scripts/sweep/t12r2/` — 452 rows, 452 ✅ on the final run (`LEDGER/T12-S10.md` → ROUND 2).

## Round 3 (2026-10-16) — the owner's "do it again … completely error free … every single bit", planned by MEASUREMENT

Plan: `scripts/sweep/t12r3/PLAN.md`. Rows: `LEDGER/T12-S10.md` → ROUND 3 (P213001–P213999, 529 rows, all ✅).
Rounds 1 + 2 ran 60.2% of app.js; round 3's fixture world, host pages, and the reruns bring it to **99.2%** (3,656 / 3,685).
Mutation testing: 340 distinct breaks over three fresh samples, about 306 caught (90%), every survivor shown unobservable.

| # | what was wrong | commit | guard |
|---|---|---|---|
| 1 | closing a table that is already free said "Couldn't check T5 just now — try again" (the read's success was not trusted) | d241bf65 | verify:tablet-taps |
| 2 | the pay sheet offered loyalty points below the restaurant's minimum | 6a5ce453 | verify:tablet-taps |
| 3 | "Use points" offline said "⭐ ₹0 off — undefined points used"; a refused one said nothing | cd3643f5 | verify:tablet-taps |
| 4 | a table type picked with no internet said "Marked 👑 VIP" | 6074a317 | verify:tablet-taps |
| 5 | a refused tip read "…switched off here.. Add it from the manager panel." | ed7f65cd | verify:tablet-taps |
| 6 | a tip typed on the pay sheet was lost on "Split this bill →" — round 2's item 5 was incomplete | 8846f276 | verify:tablet-taps |
| 7 | a dish edit saved with no internet said "Dish updated" | 2f6ce99d | verify:tablet-taps |
| 8 | banquet "Create the bill" with no plates was a disabled button that swallowed the tap | 5131480f | verify:tablet-taps |
| 9 | a sectioned waiter's guest bell listed other sections' calls — round 1's P181200 had matched the line's text | 0919c1f8 | verify:tablet-taps |
| 10 | the drawer's clock showed the tablet's time zone, not the restaurant's (New York device: 02:26 AM vs 11:56 am) | aee33dc0 | verify:tablet-taps |

Not re-run on the final code: round 1's block B (P181201–P181345) — it needs four free tables and French House held two in
eight tries (five binned-but-open sessions left by other terminals' scripts that insert cancelled+deleted orders directly,
plus their live runs). Not mine to clean. 145/145 ✅ on the morning's round-3 code; band F covers the same journeys offline.

Outside this territory, noted (no change made): the KOT ▾ menu's greyed rows (tablet AND manager, kept identical on
purpose) swallow a tap like item 8 did; the floor's 💳 sheet names no bill number where the table's own sheet says "#41";
the old full-screen ✕ (#tabletClose) is hidden under every popup today, its handler only reached through the phone's Back.
