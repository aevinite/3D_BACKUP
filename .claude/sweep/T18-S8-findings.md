# SWEEP #8 · TERMINAL 18 — the admin's Repair & System health

> Filed as `T18-S8-findings.md`, NOT `T18-findings.md`. Sweep #8 re-cut the territories, so the
> "T18" of sweeps #6 and #7 was the admin's MONEY view (Revenue / Analytics / Customers / the bill
> ledger) and its findings file is a different record that must survive. Same reason the ledger
> rows below live in `T18-S8.md` rather than `T18.md`.

**Territory:** `app/aevinite/repair/page.tsx` (1,699) · `app/aevinite/health/page.tsx` (632) ·
`app/aevinite/attention/page.tsx` (7) · `app/aevinite/issues/page.tsx` (8).
**Branch** `sweep8/t18-admin-repair-and-health` · **worktree** `../wt-s8-t18` · **port 4318**.
**ID block** `P71701`–`P72700` (pre-allocated; `P71701`–`P71730` are the new guard assertions,
`P71731`–`P72342` the freshly planned sweep).

Every number below was measured on this stack, not estimated. This run wrote **nothing** to any
database, signed in **zero** times (it presents the admin cookie the gate already accepts), never
touched Aangan's switches, and never read or named AV live.

## What was re-run

| | |
|---|---|
| Existing ledger rows covering a file I own, re-run and updated in place | **451** across 7 ledger files |
| …green again | **449** |
| …**REGRESSIONS** (green last time, red now) | **2** — `P08242` and `P08253`, one cause |
| New checks planned, executed and recorded | **612** (`P71731`–`P72342`) |
| …green | **611** · **0 failed** · **1 honestly unanswered** (`P72195`) |
| `verify:admin-sweep` (T17-R2's 527 rows, the whole admin console) | **527 / 527 green** |
| Problems found | **12** |
| Fixed in this branch | **12** |

## THE REGRESSION — `P08242` + `P08253`, and it is NOT in my files

`ONE NAME · a rate limit reads the same on the Repair hub as on the Rate limits page` was `✅` in
sweeps #6 and #7. It is now false, observed on screen at :4318:

* the Repair hub prints **"Admin login"**;
* `/aevinite/rate-limits` prints the **raw database key `admin_login`**.

Cause: that page's `labelFor = (key) => rules.find((r) => r.key === key)?.label || key` has no
fallback, and the admin-password wall **deliberately has no rule row** to read a label from (the
page says so itself, in its own words). So the one live alert on this platform is the exact case
the fallback was needed for.

`lib/plainError.ts` already holds the answer — `RATE_LABELS`, whose own header calls it *"THE ONE
LIST"* — and neither screen was reading it. T18 made the Repair side read it (item 11).

**HANDOFF — `app/aevinite/rate-limits/page.tsx` is not this terminal's file.** One line:
`|| RATE_LABELS[key] || key.replace(/_/g, " ")`. Reported, not edited.

## The twelve problems found and fixed

Each is its own commit with its number in the message, and each left an assertion behind in
`scripts/verify-admin-health-logs.mjs` (`P71701`–`P71730`). All 21 sabotage tests of those
assertions were caught.

| # | what was wrong | where |
|---|---|---|
| 1 | the one live limit alert read **"3 / 0 per 0h"** — `rlPer(0)` answers "0h" because 0 divides by 3600 cleanly, and the admin wall has no editable ceiling | Repair → Rate limits reached |
| 2 | the run-failure banner said *"open any red row and read what it did"* — **6 of the 7 failures had saved no report** | Repair → Claude session history |
| 3 | **22 of the 30 history rows were `<button>`s that changed nothing** and announced `aria-expanded` into an empty expansion | Repair → Claude session history |
| 4 | the plain-English problem line was drawn in a **code font** — the owner's 2026-09-02 change was *"it should be in the human language"* | Repair → Problems right now |
| 5 | the **"Report a problem" box rendered in the browser's monospace** (measured: `monospace` vs the console's Inter) | Repair → Report a problem |
| 6 | **"except 1 that haven't said"** — a hard-coded plural verb over a count that is very often 1 | System health → Offline layer |
| 7 | *"Choose a restaurant…"* printed **twice, one line under the other** | Repair → Hands-on tools |
| 8 | **"Resolve all" also clears the problems set to come back later** — the confirm promised 10 and the server cleared more | Repair → Problems right now |
| 9 | `lateNightRun` judged "late" and printed its times on the **laptop's clock** while every other time on the row is explicit Asia/Kolkata | Repair → Claude session history |
| 10 | the pill read **"1 need attention"** | Repair → status strip |
| 11 | `rlLabel` re-guessed a limit's name instead of reading the shared list (no visible change today; it is what stops the next drift) | Repair → Rate limits reached |
| 12 | `const hollow = false` fed two ternaries with one reachable branch — a decision already retired, left looking like a switch | System health → panels grid |

Plus **item 13**: `verify:admin-health`'s bulk-confirm assertion was pinned to a code *shape* (verb
immediately after `<span>`, whole sentence inside 120 characters) and went red for item 8's line
break with all six confirms present and correct. Widened to judge the rule; re-sabotaged.

## What my own checks got wrong first, and why it is written down

The first full run reported **25 failures. Twenty-four were my checks, not the product.** Each was
verified in the browser before being believed, which is the only reason none of them reached the
report as a fault. The three worth remembering:

* **a `color-mix()` resolves to `color(srgb 0.947 0.922 0.884)` — 0-to-1 FLOATS.** Reading those as
  0-to-255 bytes made a near-white tint compute as almost black and reported the console's own pills
  at **1.18:1** in the light skin. Measured properly: `rgb(17,24,39)` on that tint, about 17:1.
* **`[^>]` cannot parse a JSX tag.** `onClick={() => rlBlock(h)}` contains a `>`, so a "no title
  before the closing bracket" lookahead stopped at the fat arrow and reported the one danger button
  on the page — which does carry hover text — as having none.
* **two of my checks matched their own obituary comments.** `#9aa` and `const hollow = false` each
  appear exactly once, inside the note recording that they were REMOVED. A guard that goes red for
  the comment explaining a fix is a guard that gets the comment deleted.

And one blind spot in my own new suite, found by sabotage: *"every bulk action is two-step"* asserted
that each `confirmBulk === "x"` **branch existed**, so pointing a button straight at the action and
leaving the unreachable branch in place sailed past it. Rewritten to assert that the action can only
be reached *through* its confirm. Caught on re-test.

## Left open, honestly

* **`P72195` UNANSWERED** — the offline-layer "behind" sentence could not be read on screen because
  no device on this stack is behind. Its wording was driven through response interception across five
  counts (0/1/2/3 unknown, 0/1/2 behind) and reads correctly in all five, but the row stays `?`
  rather than a pass, because that is what an unreachable state is.
* **`/api/admin/resolve-error`'s `all: true` path does not exclude snoozed rows.** Item 8 made the
  screen say so; changing the *behaviour* is a product decision and the route is not this
  terminal's file. Reported for his call.
* **`verify:ledger-index` matches `^T\d+\.md$`**, so `T17-R2.md` (527 rows) and `T18-S8.md` (612)
  are invisible to its collision check. Measured: **no id in either collides with anything on
  disk today.** Widening the pattern is safe on that front, but the guard's handling of intra-file
  duplicates needs reading first — a red hook blocks every session, so this was NOT shipped blind.

## How to re-run all of it

```sh
npm run verify:admin-health                                             # the 26 + 12 fixes, static
npm run verify:repair-sweep -- --base http://localhost:4318             # all 612
npm run verify:repair-sweep -- --base http://localhost:4318 --from 1 --to 71
npm run verify:repair-sweep -- --no-browser                             # the static bands only
node scripts/verify-repair-health-sweep.mjs --ledger                    # regenerate T18-S8.md
```

---

# ROUND 2 — the writes performed, the failures induced (2026-09-05)

**Phases `P72350`–`P72700` + `P100614`–`P100762` (500).** Ledger: `.claude/sweep/LEDGER/T18-S8-R2.md`,
generated by `scripts/verify-repair-health-round2.mjs --ledger`. Branch `sweep8/t18-round2`.

His words for this round, after round 1 was merged and deployed:

> "after making it live and merging plan 500 phases test within your boundaries make sure it cover
> everthing within your boundries and test everything again if any error left"

Round 1's 612 phases read the code, drove both pages and measured what was painted — **but they
stopped at every are-you-sure**, because pressing Resolve for real destroys a row another terminal
may be re-running. Round 2 is the ground round 1 could not reach: the writes PERFORMED and read back
out of the database, the failure states INDUCED, the data shapes this stack is never in, keyboard
reachability, a busy server, two tabs disagreeing, and the nineteen fixes re-read on the DEPLOYED
site.

## The bug he reported, and what it actually was

> "I do solve later. So after four hours, it doesn't show. So make sure of that thing."

**The server was right, and proving that first is what stopped a wrong fix.** With one report's wait
moved into the past on the dev database, `/api/admin/oplog?unresolved=1` hands it straight back and
stops counting it as waiting. Hidden while waiting ✓, counted while waiting ✓, comes back once
passed ✓ — and the row was restored to exactly what it was.

**What was missing is that nothing on the page ever asked again.** The board is deliberately
click-to-refresh, so the one screen that honours a wait was also the only one that could not notice
it ending: press "in 4 hours", leave the tab open, and four hours later you are reading a
four-hour-old answer while the problem is back in the database and the board still says All clear.

Fixed as **item 19**, then driven end to end the way he does it — pressed Later, pressed "in 4
hours", moved the wait into the past, touched nothing: **the tile came back by itself after 120s,
with ONE background request and zero others.** One feed, not seven; 120s through the shared
visible-only, idle-aware, jittered helper.

## ⚠ A MISTAKE THIS ROUND MADE, AND HOW IT WAS PUT RIGHT

**Round 2's first full run pressed "Resolve all" on the real board, and cleared the platform's own
27 error reports** along with its four fixtures. It is the rule that matters most in a shared
folder, and it was broken by me, not by the product.

* **Put right, by id:** all 27 were set back to unresolved and the board verified back to its real
  state — 11 tiles, "10 problems open", the same numbers as before the run. The one audit line the
  bulk press wrote was removed. Nothing of this run's remains on the database.
* **Why it happened:** "every row you write, you delete by its own id" is not enough for a BULK
  action, because a bulk action's scope is the SCREEN's, not the fixture's.
* **Made impossible to repeat:** `findQuietRestaurant()` and `assertOnlyOurs()` in
  `scripts/sweep/t18r2/fixture.mjs`. The bulk band now finds a restaurant with no error reports of
  its own, puts its fixtures there, narrows the picker to it, and asserts once more immediately
  before the press that every open report there is this run's. If no such restaurant exists the
  phases are `⏭` with that reason — the honest answer, not a smaller test.

## The other thing that cost this round a whole run

**91 of the first run's failures were not the product.** Two causes, both mine:

1. **The board was empty** — see above.
2. **A registered service worker was eating the fault injection.** Five of the seven feeds could not
   be made to fail at all: a service worker answers a fetch from its OWN context, which
   `page.route()` cannot see. Measured: with `serviceWorkers: "block"`, all five intercept on the
   first try and the page names every failure honestly with a Retry. **This repo already had the
   scar written down** — "route interception needs the service worker BLOCKED, or the panel's own
   cache answers instead" (ledger row `P23427`) — and this round re-earned it.

Every fault-injection phase now also asserts that **the injection arrived**, so a phase can never
again pass because the app was simply healthy.

And three phases were passing for the wrong reason, which is worse than failing: *"with rate limits
failing, the page NAMES it as unreadable"* was answered yes by the section heading, whether the feed
had failed or not. They now read the failed-feed BANNER.

## What round 2 could not answer, and says so

* **The five hands-on tools' final act** (`⏭` ×5). Every one is driven through target selection,
  prefill, validation, the required reason, Escape and the back button — and the server's own guards
  are read. The final POST is deliberately not sent: it would put a real KOT on French House's live
  floor, tombstone a real order, reopen a real invoiced bill, or move a real order into another
  business day, on a stack other sweep terminals are reading. A later session should build its own
  session + order fixture and delete it by id in the same run.
