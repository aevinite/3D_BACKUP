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
