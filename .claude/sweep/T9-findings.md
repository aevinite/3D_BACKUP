# T9 — SHARED PANEL PLUMBING · sweep #7 · problems found

Territory: the 15 small JS files every staff panel loads, `editor/inventory.js`, `public/panels/vendor/**`.
**518 existing rows re-run (none regressed) · 496 new rows (P19101–P19600) · 16 problems, all fixed
on this branch, one commit each, every one with a guard.**

Run against `origin/main` **b64951ad**, on port 4209, in `../wt-s7-t9`. Nothing merged, nothing
deployed, no deploy lock taken.

| # | severity | who loses | file | confirmed how |
|---|---|---|---|---|
| **13** | **high — money** | the guest and the owner: a bill settles at the full amount and the discount lands on a settled bill | `outbox.js` | **driven** |
| **1** | medium | every staff member: Sign out signs out the frame, not the person | `maint.js`, `outbox.js` | **driven** |
| 11 | medium | the waiter, on a phone: the 🔔 the owner asked for is unreachable | `guestbell.js` | **measured on screen** |
| 3 | medium | the manager: "next try in 5s", in red, about a change being sent right now | `outbox.js` | **driven** |
| 2 | low-med | the owner and the admin: an erased guest reads as `customer_erased` | `auditsort.js` | **driven** |
| 5 | low-med | the manager on a phone: Back throws away a voice note | `issue-raise.js` | **driven** |
| 15 | low-med | anyone closing the bell sheet: a 32px ✕ beside a row that opens a table | `guestbell.js` | **measured on screen** |
| 7 | low | whoever reads "→ N more": a wrong number, and a chip offering a swipe that does nothing | `swipehint.js` | **driven, 12 layouts** |
| 4 | low | the manager: Discard on a stock count does nothing and says nothing | `editor/inventory.js` | code-read |
| 6 | low | any staff member: a save that worked, reported as "Couldn't save" | `myprofile.js` | code-read |
| 9 | low | the manager: a clipped bill total with no way to read the rest | `fitnums.js` | **measured on screen** |
| 16 | low | anyone who asked for less motion: a scaling drawer and a flashing dot | `maint.js`, `issue-raise.js` | **measured, setting on and off** |
| 8 | very low | whoever reads the crash log: "· offline, N earlier" stacked on every attempt | `errlog.js` | **driven** |
| 12 | very low | the next person to read the file: a comment claiming four panels load it | `swipehint.js` | code-read |
| 10 | — (guard) | anyone running the guard: an invented failure from a stray flag | `verify-panel-plumbing.mjs` | reproduced |
| 14 | — (guard) | a parallel sweep: a hard-coded port, and a one-in-five flake | `verify-outbox-drain.mjs` | reproduced |

---

## 13 · a change told "queued behind" was sent anyway — and the bill settled at the full amount
**`outbox.js` · the most valuable thing in this run.**

`send()` spots a blocker in `failed`, answers `{ queued:true, why:"behind" }` — and then calls
`flush()`. `flush()` only ever walked `queued`. The blocker is in `failed`. So the very flush that
promised to hold the change put it straight on the wire.

Driven on the exact sequence `send()`'s own comment describes: a discount for table 5 with no
signal → the server refuses it until it runs out of automatic tries and moves to "Needs you" → the
waiter taps Mark paid on the same table → **`5/pay` goes out immediately.** The bill settles at the
FULL amount, and the discount the person is about to retry lands on an already-settled bill.

Sweep #6 found this sequence and fixed `retryOne`/`retryFailed` to re-sort — which fixed the order
*within* `queued` and left this half open, under a comment saying it was closed. **A green row is
not a working promise.**

**Fix:** the round stalls a table already owed something retryable, before the walk starts. Only a
RETRYABLE failure blocks — a clash is `retryable:false` and deliberately does not, because it can
never be sent and would block for ever. All five release paths driven: retry sends both in order,
dismiss releases, a clash does not block, another table is untouched, and the held change is
visible the whole time.

## 1 · Sign out signed out the frame, not the person
**`maint.js` (the shared drawer every panel loads) + `outbox.js`'s 401 path.**
`/manager`, `/kitchen` and `/tablet` render the panel in an iframe, so `location.href = "/login"`
navigated the FRAME: the sign-in page loaded inside the panel with its top bar still around it, and
the page's own URL never changed. Signing in again nests a panel inside a panel. The kitchen and
tablet each fixed this for their OWN logout form on 2026-08-19; the shared drawer was missed — the
twin-panel drift shape, a fix that landed in two copies and not in the one place serving all of them.

## 11 · the 🔔 was invisible on the waiter tablet held as a phone
`guestbell.js` gives its button `class="theme-toggle lfh-bell"` to borrow the panel's button shape.
The tablet hides `.top-actions .theme-toggle` below 760px — a rule from 2026-08-06, before the bell
existed (2026-08-13). Measured at 390px: the top bar held the connection pill and Quick order and
nothing else, and the bell was not reachable at all, because unlike the theme toggle and 🚩 it has
no row in that panel's ☰ drawer. The owner asked for it there specifically: *"manager [and] tablet
panel, both"*. A count is not a preference, so it keeps its place on the bar and re-states its own
`display`. A drawer row would also be right and is reported for T7 (P19595).

## 3 · "next try in 5s", in red, about a change being sent right now
`syncing` is published when a round ENDS and was never published when one STARTED. With two or more
changes queued the first delivery covered it; with exactly ONE — the everyday case — every listener
held `syncing:false` for the whole round. Measured: red pill, "Waiting to send · next try in 5s",
and the countdown was for a timer the running round had already cleared.

## 2 · an erased guest showed up as the word "customer_erased"
It had a risk level and tags in the shared map but no words and no glyph, so the owner's Activity
and the admin's Logs printed the raw code — and because both build their type chips from
`Object.keys(KIND_LABEL)`, the row could not be filtered by type at all. `verify:audit` checked that
all three screens read the ONE map; it never checked the map was complete. It does now.

## 5 · the phone's Back button still threw away a voice note
The backdrop and Escape were taught to refuse mid-recording on 2026-08-17. Hardware Back was not —
and on a phone it is the likeliest of the three to be pressed by accident. Refusing needs one extra
step: backstack has already popped the layer, so the refusal re-arms it, or the next press leaves
the panel.

## 15 · a 32px ✕ next to a row that opens a table
The owner grew the top bar's ✕-sized controls to 44px on 2026-08-22; the bell sheet's was missed
because it lives inside the sheet. It matters MORE here: R40's reasoning for leaving the connection
pill small is that a mis-tap there costs nothing — true — but a miss beside THIS ✕ lands on a row,
and a row opens that table.

## 7 · "→ N more" counted against the wrong box
`offsetLeft` is measured from the nearest POSITIONED ancestor, and `countChip()` makes the row's
PARENT positioned. Any inset between the two put the count in a different coordinate system from
the `scrollLeft + clientWidth` it was compared against. With 40px of parent padding: "→ 7 more"
where six were off the edge, and "→ 1 more" at the END of the row with nothing left — a chip
promising a swipe that does nothing. Exact today only because the one row using it sits flush.

## 4 · Discard on a stock count could do nothing, and say nothing
`catch {}` swallowed every refusal and the sheet cleared regardless. A refused discard closed the
sheet with no message and then came back with every figure in it on the next read.

## 6 · a save that worked, reported as "Couldn't save"
The refresh that follows a successful save sat inside the save's own `try`, so a blip on that READ
told the person the save had failed. "Don't say saved when it isn't" has an other half.

## 9 · a clipped bill total with no way to read the rest
The exact-money gate is right — a rounded total is a different document. But the tile that SHORTENS
gets a tooltip and the one that CLIPS got nothing. It carries the same title now; the digits on
screen are unchanged. Its early `return` became a `break`, or the tooltip would have been left
quoting a figure no longer on the tile — caught by driving it, not by reading it.

## 16 · motion nobody could turn off
`maint.js` scales its whole drawer in; `issue-raise.js` slides and scales its card and pulses the
recording dot. Neither honoured `prefers-reduced-motion` while `connbadge.js` and `undobar.js`
always have. The drawer still FADES and the dot stays VISIBLE and simply stops flashing — it is
what says a recording is running.

## 8 · "· offline, N min earlier" stacked on every attempt
A refused delivery re-stashes the row, and the row already carried the note, so each attempt
appended another — squeezing the code location towards the 120-character cut.

## 12 · a comment claiming four panels load it
`swipehint.js` is loaded by one. The claim is what makes the next person assume the tablet already
has the hint.

## 10 · a guard that invented a failure from a stray flag
`verify-panel-plumbing.mjs` took any argument as a checkout path, so `--verbose` pointed it at a
directory that does not exist and it reported real-sounding faults about it. I believed the charts
library had drifted for a minute. Exit 2 now, with a usage line.

## 14 · a guard that could not run twice, and flaked one run in five
`verify-outbox-drain.mjs` asked for port 4324 by name; with ten terminals on one machine the second
run drove the FIRST run's stub server and failed as a navigation timeout. And `fresh()`'s reload
races the page's own navigation. Port 0 now, and one retry.

---

## 🔗 HANDOFF — four faults in files this terminal may not edit

Recorded as phase rows so they are re-run rather than remembered.

| for | what | where | row |
|---|---|---|---|
| **T7** (waiter tablet) | the 🔔 needs a ☰ drawer row, the way 🚩 and the theme toggle have | `tablet/app.js` ~5466 | `P19595` |
| **T7** (waiter tablet) | four sideways-scrolling rows have no "more this way" hint — the thing the owner approved for the manager panel | `tablet/index.html` + `style.css` + `app.js` | `P19596` |
| **T5** (manager panel) | a second copy of the undo-card toast step-over, overridden by document order — dead code that looks live | `editor/style.css:669` | `P19597` |
| **T5** (manager panel) | one `LFH_BACK.layer(...)` call unguarded while every other in the file is guarded (cannot throw — load order saves it) | `editor/app.js:10152` | `P19598` |

## Looked at and deliberately NOT changed

- **The connection pill stays 24.5px.** The owner was shown both ways and chose to leave it (R40).
  A mis-tap opens an information popover — the cheapest miss on the screen.
- **`realtime.js`'s unused `debounce()` stays.** One line, no behaviour; deleting a helper costs a
  reviewer more attention than it saves. `P19599`, so the next sweep does not file it.
- **`.bill-amt` stays in the fit list** though it matches nothing: it is in the exact-money list, so
  if a panel ever grows that class its figure is protected from the first render. `P04259`, `P19543`.
- **The destination table of a pending move is not held behind it.** Holding it would let one
  table's stuck work stop another's, and the database refuses the move with a sentence rather than
  applying it wrongly. `P19315`.

---

# T9 — SECOND 500 (2026-08-30) · phases `P42501`–`P43000`

Same territory, different question. The first 500 read these files for the correctness of what they
DO. This run asked **what a person is TOLD when the answer never comes** — and every one of the five
faults below is the same shape: the app going quiet.

**500 new rows (436 driven/static + 64 judgment) · 1,014 existing rows re-run, none regressed ·
5 problems, all fixed on this branch, each with a guard proved RED first.**

Run against `origin/main` `b64951ad`+, in `../wt-t9b`, port 4235. Nothing written to the shared
database. AV live never touched, read or pointed at.

| # | severity | who loses | file | confirmed how |
|---|---|---|---|---|
| **3** | **high — the guard itself** | anyone trusting this guard: 16 checks printed a tick while asserting nothing | `verify-panel-plumbing.mjs` | reproduced, then proved awake by sabotage |
| **2** | **high** | the whole restaurant: live updates stop for ever and the screen still looks current | `realtime.js` | **driven** |
| **1** | medium-high | the manager: the guest-menu switch sends nothing, moves nothing, says nothing | `maint.js`, `myprofile.js` | **driven** |
| 4 | medium | the manager: a control that never resolves — the button stuck on "…" all session | `maint.js`, `myprofile.js` | **driven** |
| 5 | low-med | the manager: a second line can never be added to a purchase bill | `editor/inventory.js` | read + fixed with #1's card |

---

## 1 · the guest-menu switch did nothing, and said nothing

`maint.js` — the settings drawer EVERY staff panel loads — asked "Take the guest menu OFFLINE?"
with `confirm()`, and reported a refusal with `alert()`. `myprofile.js` used `alert()` for the two
messages that matter most on that screen: "saved on this device only" and "not saved".

A staff device is the one place those cannot be trusted. A kiosk browser, an embedded webview, and
Chrome after somebody ticks *"prevent this page from creating additional dialogs"* all answer
`confirm()` with **false** and return from `alert()` having shown nothing. Driven with dialogs
suppressed:

```
the switch reads:               "🟢 Take guest menu offline"
dialogs raised (and dismissed):  confirm
POSTs to /api/maintenance:       0
the switch now reads:           "🟢 Take guest menu offline"
anything on screen saying why:   NO
```

Two more reasons the panel's own card wins: a native dialog freezes the page's whole thread, so the
write queue stops draining while it is up; and hardware BACK cannot close it, because backstack
never sees it.

`maint.js` now publishes **`LFH_ASK`** — a card in the drawer's own style, on its own scrim,
registered with the back-button manager. A scrim tap and a BACK press both answer a QUESTION as
**No**; a stray tap can never take the guest menu offline. Both answers are 46px: Cancel measured
**30px** on the first pass, because the ghost style is a footnote style and here Cancel is one of
two answers.

## 2 · live updates could stop for ever, with everything on screen still looking current

`realtime.js` handles a REFUSED boot — the rejection drops the memo and the next wake re-boots. A
**hang** was different. `fetch` has no timeout of its own, so on a captive portal that promise stays
pending for the life of the page, and because it is memoised **every later call is handed that same
pending promise and makes no request at all.**

```
requests the panel made for its live-update settings: 1
{ "statusAfter12s": "weak", "everConnected": false, "statusAfterWake": "weak" }
```

One request in the whole run; still "Connecting…" twelve seconds later; waking the panel changed
nothing. An 8s `AbortSignal.timeout` now — the deadline this app already uses for a read a person
waits behind. It REJECTS, which is the point: the existing memo-drop then does its job.

## 3 · …and the guard that was supposed to be watching all of that was asleep

`verify-panel-plumbing.mjs` read a hand-written list of **eight** files and returned SILENTLY for
anything else, while its checks name **thirteen**. So **sixteen checks asserted nothing**:

- **`realtime.js` was never in the list** — all TEN of its checks were dead. Every promise this
  guard makes about live updates was a promise it was not checking.
- **`errlog.js` and `theme.js`** were loaded by an ad-hoc `files[x] = read(x)` further down the
  file, placed AFTER some of their own checks — four errlog checks and two theme checks ran against
  `undefined`.

It printed `✓ all checks pass` throughout. Files are read **on demand** now, so a check for a new
file cannot silently do nothing, and the four ad-hoc top-ups are gone rather than left as an
invitation to add a fifth. Proved awake by sabotaging each of the three files in turn.

> **This is the finding worth keeping.** Five product fixes are worth having; ten checks that print
> a tick while asserting nothing would have gone on hiding the next fault too. `verify:guards-alive`
> missed it because the guard as a WHOLE was alive and only part of it was dead — worth a check of
> its own, for whoever owns that guard.

## 4 · nothing in the drawer had a deadline

Every `fetch` in the shared drawer was open-ended. A server that hangs left the guest-menu button on
`…` for the whole session, left a write with the switch pointing the wrong way and nothing said, and
left ⚙ Settings opening on nothing. 8s, one shared helper, and — because a deadline has to speak
English — `"the server didn't answer in time"` instead of the browser's own `"signal timed out"`,
which is what the manager was shown on the first pass of this fix.

## 5 · a second line could never be added to a purchase bill

`editor/inventory.js` fell back to `window.confirm` for "already on this bill — add another line?".
On a device that hides dialogs the answer is always No, so the manager was told *"Not added"* every
single time. It is a VISIBLE refusal rather than a silent one — which is why this is the third fault
of its kind here and not the first — but a dead end is a dead end. `LFH_ASK` now sits between the
editor's own dialog and the browser's.

---

## Eleven of sixteen red rows were MY CHECK being wrong

Recorded because a sweep that reports only the product's faults is not a record of the sweep. Each
was re-aimed at what the rule actually protects, not deleted:

- **every empty catch** → only one around a WRITE → finally, the *set* of two that were read and
  found deliberate (a logger must not throw while reporting a crash; sign-out reaches `/login`
  either way).
- **"every file that writes markup needs an escaper"** → the six named files write fixed templates
  or clear a node; the rule became the *set* of interpolation sites.
- **"no repeating timer under five seconds"** → all three are scoped and cleared; the rule became
  "a fast timer you cannot turn off".
- **"every fetch needs a deadline"** → the crash report is fire-and-forget with `keepalive`, where
  an abort would defeat the point; the rule became "every AWAITED fetch".
- **`KIND_LABEL` has no `order_tip`** → that map is the *removals* vocabulary. Adding the tip there
  would have filed it as a kind of removal. The tip reads correctly in both action maps, and the
  row now checks those two agree.
- plus the group counts, the history arithmetic (`history.go` never shortens a history), a 60px
  box that turned out to fit, a `C()` call missing an argument, a `tax_rate` of 5 meaning 500%,
  order fixtures with no `subtotal`, and a test page with no viewport tag.

## Looked at and deliberately NOT changed

- **`maint.js` stays CRLF.** Converting it is a 671-line diff that hides whatever ships with it.
  Both guards now assert the line endings.
- **`billdoc.js`'s 15 empty catches stay.** Every one wraps a cosmetic side-effect inside the
  printed document; a bill window that throws is a blank page in front of a guest.
- **`errlog.js` keeps its deadline-free request.** `keepalive: true` exists so it outlives the page
  closing; an abort signal would defeat it.
- **The connection panel still does not say WHY each change is waiting.** Raised by sweep #6, left
  open by the first 500, still the weakest thing here — and still a feature, not a fault. `P42911`.

## 🔗 HANDOFF

| for | what | row |
|---|---|---|
| whoever owns the panels outside `public/panels/*.js` | they still ask with a browser dialog; `LFH_ASK` is now on every panel page and `verify:panel-dialogs` widens in one line | `P42986` |
| whoever owns `verify:guards-alive` | it cannot see a guard that runs 300 checks and silently skips 16 — the tell is a check naming a file the guard never read | `P42991` |
| **T7** (waiter tablet) | the 🔔 still has no ☰ drawer row | `P19595`, re-stated `P42987` |
| **T7** (waiter tablet) | four sideways rows still have no swipe hint — the module is now proven across five layouts, so it is pure wiring | `P19596`, re-stated `P42988` |
| **T5** (manager panel) | the duplicate undo-toast rule in the panel stylesheet | `P19597`, re-stated `P42989` |
| **T5** (manager panel) | one unguarded back-layer call | `P19598`, re-stated `P42990` |
