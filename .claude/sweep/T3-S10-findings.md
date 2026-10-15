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

---

# Round 2 — 2026-10-12 (the owner: "do all the things that you have listed … check every single bit")

Owner's answers to round 1's list: **5 — NO** (reduce-motion stars; recorded as R69 + code comment),
**9 — "you decide"** → dining sessions stay OFF (the factory default; commit 1eedf685 says so) and the
old runners switch French House ON only around their gate sections (item 8), **6, 7, 8, 10 — do them**.
Every fix is one commit, guarded in `verify:guest-doors` §13 and reverted once to see the guard go red.

| item | screen | what was wrong | guard / rows |
|---|---|---|---|
| 6 | dish popup → Add to Order | stopped at 99 in silence (bill and dish card both say "Maximum 99 per dish") | §13 · P172576–P172577 · P172983–P172984 |
| 7 | backend only | "which restaurant is this table code" lived twice, copied; "I've left" had none — one helper now (`lib/guestTokenRestaurant.ts`) | §13 · P172551–P172562 |
| 8 | backend only (sweep tools) | old runners crashed at the join gate (sessions OFF), taking every later row down | §13 · blocks 3a/3b/5 green again |
| 10 | owner's phone alerts | a QR table hitting its waiter-call limit never pinged the owner | §13 · P172947–P172948 |
| 11 | bill → Live status | **5-second database poll**: 7 `get_order_dishes` reads in 30 s for one live order; now nudge + 60 s backstop, only while the cards show | §13 · P172980–P172982 |
| 12 | none (tidy) | an unused leftover in the bill's line loop | lint |
| 13 | none (speed) | five menu lookups walked the whole menu per line per redraw | §13 · P172567–P172568 |
| 14 | backend only | a body the database cannot read was answered "busy" and retried for ~4 minutes | §13 · block I |
| 15 | "On this phone" list | after a reload one saved row could be listed as BOTH waiting and couldn't-send | §13 · P172800–P172801 |
| 16 | dish page → Rate | the page's redraw lit the stars 5 ms after the tap, before their dive; now 654/787/904 ms | §13 · P172986–P172989 |
| 17 | bell (QR) | a restaurant that did not ANSWER got "please try again" — now saved like no signal | §13 · P172950–P172953 |
| 18 | basket pill | counted a corrupted saved quantity raw (150 items over a bill of 99) | §13 · P172985 |
| 19 | "On this phone" list | saved bell taps at two restaurants merged into one | §13 · P172798–P172799 |
| 20 | backend only | a JSON body of `null` crashed all four guest doors with a 500 | §13 · P172990–P172999 |
| 21 | bell (QR) | any unknown answer read "Already sent · staff are on the way" | §13 · P172949 |
| 22 | backend only | the limit beacon read a list as a function name | §13 · P172714 · P173000 |
| 23 | order strip | **on Chrome, a dropped connection marked a cooking order CANCELLED** ("Order cancelled · Please ask a member of staff") | §13 · P172977–P172978 |
| 24 | order strip (phone) | the fixed bell covered the strip's end — "Table 2" for table 28, drag handle hidden | §13 · P172607–P172611 |

**Own slips found and corrected this round:** round 1 stamped five old rows ✅ from a run taken BEFORE its
own fixes (P16124, P56940, P57608, P57609, P110096) — they had gone stale; re-pointed and re-stamped. Round 1
also read "no star picker" as "ratings off" — French House has ratings ON, behind the dish page's Rate tab.
Item 23's commit left item 17's guard line red for three commits; fixed in `8ad4beff`.
Item 8 missed two blocks — s7b-live's shared-table-bill block and s7c-live's elapsed-line gate block — both
now switch sessions ON around themselves. And the old runners' forced tap on a dish's + landed on the
floating waiter bell whenever Playwright scrolled that + to the bottom edge (it opened the bell's popup, so
P16427–P16429 read "no gate"): round 2 had filed those as T4's — they were this terminal's runner. They tap
the button itself now (s7-live, s7b-live, s7c-live, s7-shots, s7b-shots) and all three live runners are green
(62/0 · 70/0 · 70/0). Checked the product side too: at the bottom of both menus every + scrolls clear of the
bell, so the bell covers a dish only mid-scroll — not a fault. `stars-live.mjs` (new) closes P00932/P00935.

**For other terminals (not changed here):** the dev database cancelled the menu page's settings read on its
statement timeout three times during the run (menu page, T1) · `app/globals.css` holds two conflicting
`.sr-wrap` / `.sr-score-pill` rules that hide the star score pill on a phone (THE LOOK, T37) · in light skin
the bill's line prices are pale gold on cream (T37) · `lfh_call_waiter_table` accepts a table number above the
floor plan from a direct QR call (the database, T35) · `lib/dbRefusal.ts` does not know Chrome's
"Failed to fetch" either (shared plumbing, T16). · the dish page's cyan button runs an endless shine that animates
`left` (`.btn-cyan::before` → `@keyframes shimmer`, defined twice in `app/globals.css`, ~line 2289 and ~2882):
the browser re-lays the page out every frame and counts ~0.07 layout shift per 8 s on the dish page — the
same look on `transform: translateX(…)` costs no layout (dish page / THE LOOK) · French House's join gate
said "tables 1–13" during one run while `settings.table_count` is 30 (floor plan, T4).

## Round 3 (2026-10-15) — owner picked 25–31; the full re-test found 32–39

Owner's words: *"do 25,26,27,28 and for 29 … the table which are not there they shouldn't be able to call …
solve the 30th one also … solve 31 … do a full bug test … Replan whole test. Don't use the previous one."*

| # | Where | What was wrong | Status |
|---|---|---|---|
| 25 | dish page → cyan buttons | the shine moved by `left`, re-laying the page out every frame | fixed — `transform`, one keyframe |
| 26 | dish page → Rate tab | two sets of star rules; the later one hid the "3 / 5" pill | fixed — one set, pill shows |
| 27 | bill, dish popup, saved list (light skin) | 23 pieces of text below the readable line (line prices 2.2:1) | fixed — all 200 measured pass |
| 28 | backend only | Chrome's "Failed to fetch" not read as "database down" | checked, NOT changed — a phone with no bars would read as the restaurant down; comment in `lib/dbRefusal.ts` |
| 29 | menu → bell popup | a table that does not exist could call a waiter (phantom tile on every floor) | fixed — migration 423, the popup names the real tables |
| 30 | backend only (test tools) | T27's admin suite left French House on 12 tables for minutes | fixed — each phase puts back what it touched |
| 31 | bill + guest error screen | a failed settings read printed a guessed 5% GST as fact; "Try again" re-drew the same failure | fixed — "+ any tax"; error screen re-asks and retries 3× |
| 32 | "On this phone" list | the queue handed out its live rows | fixed |
| 33 | backend only | cancelling the last saved item left the retry timer ticking | fixed |
| 34 | order strip | two writers of the live-order list | fixed — one writer |
| 35 | order strip | a damaged saved list was trusted as read | fixed — cleaned on read |
| 36 | menu → place order | an order for table "04", " 4" or no table was accepted | fixed — both doors + migration 424 |
| 37 | backend only | leave reported success when the database did nothing | fixed |
| 38 | bill, dish popup, saved list | 12 controls under 44 px | fixed — invisible tap areas (bin ≈ 26 px, above 24 px floor) |
| 39 | backend only | 17 dead style rules | removed with obituary comments |

**Test, re-planned from zero:** 145 in-memory checks · 19 live on a production build behind a fault proxy
(`scripts/sweep/t3s10/r3/`) · coverage 674/674 lines in the 7 code files · mutation 525 breaks, 499 caught,
26 equivalent · old suites still green (934 · 52 · 31 · 62 · 70 · 70 · 2 · static 300/330/370/430/320/380).

**Own slips this round:** an offline-then-online contrast run sent 6 real orders to French House table 4
(cancelled, archived, stamped, session closed; memory written) · L601 first passed on the previous run's
order (now counts only orders made after it starts) · block F reds came from running on the dev server,
which has no service worker (green on the production build).

**For other terminals:** migrations 423/424 are on the dev DB only — AV live needs the ask-first release.
Hook failures seen in the shared folder belong to other terminals' work (t27r2 retired admin routes,
verify-guest-menu-switch preflight, t11s10 run.mjs exit).
