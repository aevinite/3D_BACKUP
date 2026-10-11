# Sweep #10 · Terminal 3 — findings (ordering: the basket, placing an order, calling staff, rating)

Ledger: `LEDGER/T3-S10.md` (508 new rows) · re-run stamps `re-run 2026-10-11 (sweep #10, T3)` on 2,249 earlier rows.
Regressions: **0**. Problems found: **4**, all fixed, one commit each, each guarded in `npm run verify:guest-doors` §10
(every guard broken on purpose once and seen red).

| item | screen | what was wrong | commit | guard / rows |
|---|---|---|---|---|
| 1 | Guest menu → bell → "Need something?" (QR door, sessions off) | When the restaurant's own waiter-call limit refused the call (`lfh_call_waiter_table` answers `{ok:true, reason:"rate_limited"}` and creates no call), the popup said **"On our way! · staff notified"**. Nobody was told. The saved-call queue already treated it as a refusal (sweep #9 item 4); the live door did not. Old row P01185 had checked four branches and missed it. | `fix(guest bell): item 1` | §10 item 1 · P172384 · P172540 |
| 2 | Guest menu → "N orders waiting to send" chip → "On this phone" list | A saved order's total was printed with the MENU-price formatter (`formatPrice`, snaps to .00/.50/.99 first), not the bill's. Seen on screen: bill **₹470**, list **₹471**. 1 in 4 stored totals differed by ₹1; up to half by a cent in AED/SAR/QAR. | `fix(saved orders): item 2` | §10 item 2 · P172394 · P172440–P172445 · P172475 |
| 3 | Guest menu → order strip → drag onto the ✕ | The toast said the order was **"still in Previous orders"** — a tab removed on 2026-06-17. It is now "still in Live status on your bill". | `fix(order strip): item 3` | §10 item 3 · P172415 · P172488 |
| 4 | Guest menu → bill → Live status card total (and the tracker's copy of every order) | The stored order total used float rounding of the grossed-up figure; the bill rounds the GST to the paisa first. 7,353 of 240,000 basket/rate pairs a paisa apart; a cent apart on screen for a diner reading in $ / € / AED. | `fix(bill): item 4` | §10 item 4 · P172451 · P172482 |

## Looked like faults, are not (recorded so nobody files them)

- **French House and Aangan both have dining sessions OFF today.** Every old runner step that expects the join-a-table gate on
  French House fails on the fixture, not the product (P01332, P01352, P16427, block 5). Those rows belong to the table-session
  territory this sweep; mine that need sessions are ⏭ with that reason.
- **The bell will not take a robot's click** — it floats on purpose (R29, the owner's 12px idle float), so it is never "stable".
  The bell is the element under a finger at its centre (P172491). Not a fault; do not "fix" the float.
- **A dish "+" covered at the moment an order is saved offline** — it sits under the red offline strip (another terminal's) at
  that scroll position and is reachable by scrolling; the same pattern P16490 measured three ways and withdrew.
- **Old checks that went red because the subject moved on purpose:** "2x" vs "2×" (ticket redesign, R58), newest-first vs
  not-done-first (owner 2026-09-20), POLL_MS deleted (owner 2026-09-18), table 31 refused one step earlier (sweep #9 item 10),
  `continue` → `break` after unmount. All re-asked against today's behaviour and green.
