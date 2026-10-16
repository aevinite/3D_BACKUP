# Sweep #10 · T11 — the kitchen screen · problems found and FIXED

Six problems, one commit each (the item number is in the message), each leaving a guard in
`npm run verify:kitchen` that was sabotage-tested once. No regression: every existing row that was green
is green again today. Improvement ideas are in the terminal's chat report only, not here.

| # | what was wrong | where | proof | guard |
|---|---|---|---|---|
| 1 | A late ✓, take-back or ALL READY (a screen a second behind the waiter, or a tap replayed from the offline queue) un-served a served dish and rolled the order back to `preparing`, so the floor and the waiter's tablet said the table was cooking again | `app/api/kitchen/[...path]/route.ts` — `/orders/:id/ready`, `/accept`, `/items/:id/status` | driven in memory (route, stub DB) and LIVE on :4411 with a real ticket: 409 "already been served", the dish and order stay served (P180462–P180464) | P180001–P180010 |
| 2 | The kitchen's server also accepted MANAGER and OWNER logins (roleSatisfies). An owner's session was answered with the restaurant on their staff row (a shared "home" namespace, not always one they own — 1 of 21 dev owners); a manager whose "Mark as sold out" was switched off could still 86 a dish here | the route's `gate()` | read the code + driven in memory (manager/owner → 403, kitchen + admin pass) | P180011–P180018 |
| 3 | A refused manual print (cancelled / deleted KOT, cancelled delivery) toasted `toast(e.message, "err")` — the second argument is the UNDO callback, so an UNDO button appeared and tapping it threw "undoFn is not a function" into the Everything Log | `public/panels/kitchen/app.js` — `reprintOrder`, `reprintPlatform` | watched on the running board before/after | P180021–P180026 |
| 4 | The admin's STOP on Printing (`modules.printing.paused`) did not hold the kitchen screen — the default printer for kitchen slips — so Stop changed nothing in most kitchens, and the 🖨 sheet kept saying "ON · this screen" (its own "printing is stopped" words were unreachable) | the route's board read, `print-jobs/claim`, `print-station/take`; ⚙️ Settings in app.js | driven in memory: paused → no jobs, no auto rows, claim refused, take refused, `printRefused: "paused"`; Settings screenshot looked at | P180027–P180036 |
| 5 | After a ✓ on a multi-dish ticket, a later "back to cooking" from another screen left the card saying "ready" with no ✓ (a stale change-check stamp after the in-place edit) | `markItemReady` in app.js | watched on the running board; fixed and sabotaged both ways (P180489–P180490) | P180037–P180040 |
| 6 | The first tap of the shift unlocked sound on pointer-down; the "Tap to enable sound" row folded and the board jumped ~45px under the finger — a mouse tap vanished, a TOUCH tap marked the dish BELOW the one tapped | `primeAudio` / the first-gesture listener in app.js | driven with mouse and touch before/after; the sabotaged panel marked the wrong dish again (P180491–P180493) | P180561–P180566 |

## Round 2 — 2026-10-16 · the decisions taken, the outside bugs, and what the re-planned test found

| # | what was wrong | where | proof | guard |
|---|---|---|---|---|
| 7 | The kitchen route still had the old /accept door and took 'served' as a dish status — the waiter accepts and serves | kitchen route | read + driven | P180002, P180004, P180010, P99802–P99804 |
| 8 | MY CALL, no code change: a cook's own 🖨 keeps printing while the admin has printing stopped (Stop is about paper nobody asked for) | comment above `reprintOrder` | — | the comment names the lever |
| 9 | The waiter tablet's server accepted manager/owner logins | tablet route | hermetic | P180572–P180573 |
| 10 | An owner on the manager route with no ?rid got the restaurant on their staff row | editor route | hermetic | P180574 |
| 11 | 🚫 drawer: SOLD OUT unreadable in the light skin; a long dish name squeezed its toggle | kitchen style.css | screenshot | P180575–P180576 |
| 12 | Three guards red on main for the wrong reason + stale rows | tests | guard runs | (the guards themselves) |
| 13 | A step that failed on the kitchen's server (ALL READY's dish write, the ✓'s pre-reads and rollup, the delivery accept-gate) answered { ok: true } or a false 403 | kitchen route | hermetic, failure played on cue | P180777–P180786, P180834–P180836 |
| 14 | `act()` — dead since 2026-07-07 | app.js | coverage | P02620–P02621 |
| 15 | OUTSIDE the territory: verify:guards-alive red on main twice for wrong reasons; 19 files in the shared folder still CRLF from June (made P02793 red there only) | admin guards, guest-menu guard, the shared folder | guard runs | P181000 |
| 16 | A late kitchen tap (offline queue, a screen behind) could bring a CANCELLED delivery back as "ready", or pull a handed-over one back to "accepted" | kitchen route → platform status | hermetic, red on the old code | P180853–P180856, P180859 |
| 17 | The kitchen's 'print here instead / stop printing here' doors had no caller since 2026-08-29, and a duplicate printing vote decided nothing | kitchen route | mutation run + grep of every screen | P62937–P62945, P99823–P99828, P180213–P180217 |
| 18 | A refused ✓ / ALL READY kept saying "ready" when the follow-up board read also failed | app.js markItemReady / markOrderReady | panel, red on the old code; live P180984 | P180889, P180896, P180911 |
| 19 | A queued ticket whose print call failed was reported PRINTED — the server closed the job and never offered it again | app.js processPrintJobs / printKot | panel (a printer that throws), red on the old code | P180923, P180969 |

The test was re-planned from nothing: the real route under an in-memory database (100% of its lines, then broken 240
ways twice: 184 → 218 noticed, the rest closed or shown harmless), and the real screen in Chromium with every server
answer played on cue (99% of app.js run), then the real app on :4411 with one cleaned-up test ticket and three devices
looked at. Ledger: `.claude/sweep/LEDGER/T11-S10.md` → "ROUND 2".
