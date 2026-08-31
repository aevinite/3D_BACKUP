# SWEEP #7 · TERMINAL 14 — what was found in the owner's Customers, Pay Later, Inventory,
# Complaints and Manager mode

Branch `sweep7/t14-owner-customers` · worktree `../wt-s7-t14` · port **4214** · from `origin/main`
**d7af8f63**, 2026-08-27. Ledger: `.claude/sweep/LEDGER/T14.md` (`P06501`–`P07000` re-run,
`P21601`–`P22100` new).

**The four-part report for the owner is in the terminal window, not here** (sweep-7 rule 3). This
file is the engineering record of the faults only.

## Re-running sweep 6 first: no regression, and one row that was never true

All 500 existing rows were re-executed. **Zero regressions.** Four expectations moved, all of them
the same reversal — the owner rejected sweep-6 item 4 on 2026-08-18 (`docs/REJECTED-IDEAS.md` R34),
so Pay Later must NOT hide itself. Four `⏭` rows were closed. And one row, `P06616`, had been filed
✅ on a claim that was never true: it READ the tab-choosing effect instead of driving it.

## The five faults, each fixed in its own commit

### 1 · The Customers list claimed it was hiding guests it was not
`app/owner/customers/page.tsx`. The line under the list read `summary.total > summary.shown`, and
`summary.total` is the head-count of every guest in scope — it knows nothing about which group tab
is open. Measured on French House: **Regulars** said *"Showing the 13 most-recent of 26"* with all
13 regulars on screen, and **Blocked** said *"Showing the 2 most-recent of 26"* with both blocked
guests on screen. Each group now asks the head-count that means the same thing (Everyone → total ·
Regulars → `visits ≥ 2` · Blocked → `blocked` · First-timers → `total − returning`, exact because
both are head-counts over the same scope), and the line only appears when the read really hit the
300-row cap — so a tile one guest ahead of the live list can no longer invent a hidden guest.

### 2 · A search of wildcards was reported as matches
Same file. `lib/searchText.ts` strips the characters that change what an `ilike` MEANS and the
route sends no `q=` when nothing usable is left; the screen branched on the RAW box. So `*` and
`%%%` fetched the whole list and labelled it *"26 matches for “*”"*, and two spaces produced
*"26 matches for “”"*. Both ends now run the same cleaner.

### 3 · A guest's bills did not say which restaurant they were at
Same file. The record already says *"this number has eaten at 2 of your restaurants"* and then
lists the bills mixed together with no brand on any of them. Bill numbers are a per-restaurant
daily series (`docs/NUMBERING.md`), so two of the owner's restaurants can both issue #41 on the
same day. Each bill row now carries its restaurant, and only when the guest really uses more than
one.

### 4 · With Guest ratings switched off, Feedback & complaints was a blank screen
`app/owner/issues/page.tsx`. The "pick the first available tab" effect latched a `decided` ref on
the FIRST render — before either request had answered, when `ratingsOff`/`issuesOff` are still
their initial `false` — so when ratings came back off the tab never moved. The page rendered its
heading and then a card holding only a "Complaints · 1" button, with an **open complaint** hidden
behind it. **Untouched since PR #199.** The latch is gone: a tab that is switched off can never be
the one you are left sitting on, and the effect cannot fight a real click because a switched-off
tab has no button to click.

### 5 · A rating card printed a database id instead of a name
Same file. `feedback.acknowledged_by` has two writers that disagree: the manager panel stores a
NAME, `/api/owner/ratings` stores `scope.ownerId` — a uuid. Marking a rating handled from the owner
cockpit produced *"handled by c0af7b5b-c0d8-40f6-b831-f475e48bab53"*, here and on the manager's own
Ratings screen. The display is fixed; **the one-word repair at the source is in
`app/api/owner/ratings/route.ts`, which belongs to the owner-routes lane and was not edited.**

## Found and deliberately NOT fixed, because the file belongs to another lane

- **`app/api/owner/ratings/route.ts`** stores a uuid in `acknowledged_by` (fault 5's root cause).
  The manager panel's own Ratings screen still shows it. Ledger `P22079`.
- **`lib/partialRead.ts`** has no words for the key `openCount`, which `/api/owner/issues` really
  does send when its head-count fails — so the owner would read *"Couldn't read **openCount** just
  now"*. One line in `PARTIAL_LABELS`. Ledger `P22056`.

## The guard

`npm run verify:owner-money` (`scripts/verify-owner-money-screens.mjs`) — five new rules, items
19–23, one per fault. Its `mustNot` rules now test the **code with comments stripped**: item 19's
rule forbids the expression the fix removed, and the comment explaining the fix made the guard go
red pointing at its own obituary.

## Green in this worktree

`typecheck` · `lint` (0 errors, 686 warnings = the branch point's own number) · `verify:owner-money`
26/26 · `customer-erase` 15 · `personal-data` 16 · `owner-panel` 61 · `owner-territory` 49 ·
`owner-screen` 61 · `owner-clash` 11 · `taps` 33 · `customers` 65/65 (`--base 4214`) ·
`recycle-name` (`--base 4214`) · `server-only` · `clash-coverage` · `ui` · `rejected` ·
`settings-columns` · `ledger-index`.

## Housekeeping

Two fixture guest rows on **French House** (`9000021601`, `9000021602`, plus `9000021604` for the
double-tap check), each deleted by its own key in the same run. One existing rating handled, noted
and reopened, then restored field by field. **Aangan was never written to; AV live was never read;
`.claude/deploy.lock` was never taken; nothing was pushed to `main`.** One owner sign-in for the
whole run.


---

# HIS DECISIONS, 2026-08-31 — all eight answered in one message, all eight closed

> *"You can do the seventh number… for the eighth number, if the inventory is not switch on, then it
> will not show — it will not even show that option… can do number nine… number 10th one also…
> number 11 also… number 12 also… number 13 also… the 14th also."*

| # | what he asked for | outcome |
|---|---|---|
| 7 | drop the "Restaurant" column for a single-restaurant owner | **built** — same condition the phone card list already used |
| 8 | a section he has not been given must not be named to him at all | **built, and wider than offered** — Customers, Feedback & complaints (both off), Inventory and Manager mode now send a real owner to his dashboard and show nothing. The four sentences are deleted, not restyled. Pay Later untouched (R34). |
| 9 | make the three tappable figures look tappable | **built** — a small filter mark on the three that work, plus one muted line saying what it means |
| 10 | line the guest record's three figures up | **built** — tops now 118/118/118, previously 118/132/118 |
| 11 | the database id in `acknowledged_by` | **already done upstream** — T12's sweep (2026-08-29) made the owner routes record the login name and added `lib/ownerActor.ts` for rows already written with an id. T14's own local `handledBy()` was DELETED rather than left beside it. |
| 12 | `openCount` printed as a code word | **built** — one line in `lib/partialRead.ts`; it reads "how many complaints are still open" |
| 13 | the tiles can be five minutes behind the list | **built** — the tiles now say "Counted at 10:44 pm · Refresh to count again."; the route had sent `cachedAt` all along and the screen never read it |
| 14 | Manager mode offering to print the kitchen's tickets | **already gone upstream** — he had that band removed everywhere on 2026-08-29/30 (mig 372, "there is no mode toggle"). Re-driven inside the cockpit: absent. |

**Guards:** `verify:owner-money` items 24 (×4), 25, 26, 27, 28, 29 — **35 rules, all green.** Item 7's
old rule lost its `must` (the heading it asserted was deleted with its screen); its whole-app walk
for the dead `adm-page-title` class survives, which is the part that actually enforces anything.

**Two of his eight needed no work at all** — and both were found by re-reading the code as it is
today rather than trusting my own report from four days earlier.
