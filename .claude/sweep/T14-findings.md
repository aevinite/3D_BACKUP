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


---

# ROUND 3 (2026-09-01) — the territory grew, and it came back clean

He gave permission for the two things round 2 had to leave in other lanes' files:

- **Item 20** — `app/owner/{activity,staff,menu}` still named a withheld section. All three are
  redirects now, so **all six** owner screens follow R36 and Pay Later is the one written exception
  (R34). Driven: a **503 on Team stays put and offers a retry**, so a blip can never look like a
  withheld feature; and the **ADMIN still opens all eight sections**, including the one whose module
  is genuinely off — that is the single thing this change could have broken and it is the row worth
  keeping (`P48313`).
- **Item 21** — `lib/ownerActor.ts` let a blank-but-present name through as an empty string.

## What round 3 found

**No new product fault.** Three rounds and 2,000 numbered checks in, this ground has converged.
What it did find was in the guards, not the product:

**`verify:owner-territory` was asserting a rule the owner had just retired** — it required the Menu
page to still say *"isn't switched on for your restaurant"*, the exact sentence item 20 deletes. It
was **rewritten to assert what it was actually protecting** (a failed read and a withheld section
still give two different *answers*) rather than left red or quietly removed. A guard that keeps
asserting a retired rule is one people learn to ignore.

## The one thing deliberately left

The **Dashboard's per-restaurant note** — "Reports are switched off" when you drill into a
restaurant whose Reports the admin has taken away. That is a different case from the six page-level
messages: he *has* the Dashboard, and a number vanishing with no reason is worse than a reason.
Reported to him rather than changed.

## Totals across three rounds

| | |
|---|---|
| numbered checks on record for this territory | **2,000** (`P06501`–`P07000`, `P21601`–`P22100`, `P47301`–`P47800`, `P48301`–`P48800`) |
| items built | **21**, one commit each |
| guard rules watching them | **47** in `verify:owner-money`, plus the territory's other 19 guards |
| PRs | #1128, #1213, #1215 — all merged, all deployed READY, every item driven on the live site |
| regressions found across all re-runs | **0** |

---

# SWEEP #8 · TERMINAL 16 (2026-09-04) — the territory was re-cut, and it came back with seven

**The engineering record only. The owner's four-part report is in the terminal window, not here**
(sweep-8 rule 3).

Sweep #8 re-cut this territory from the real file structure: **T16** now owns the four owner screens
(`customers`, `khata`, `issues`, `inventory`) plus `components/owner/OwnerInventory.tsx` and, newly
inherited from T10, `app/api/inventory/**` and `app/api/issue-media/**`. Manager mode moved out.
Branch `sweep8/t16-owner-customers-khata-inventory`, worktree `../wt-s8-t16`, port **4316**, from
`origin/main` **7c154754**. Ledger: `.claude/sweep/LEDGER/T14.md` — 2,022 existing rows re-run,
785 new (`P69701`–`P70485`).

## The one regression, and it is a guard

**`verify:panel-api` had been RED on clean `main` since 2026-08-31.** Its duplicate-ingredient rule
demanded the literal `confirmDialog`/`window.confirm` inside the `#ppAdd` handler of
`public/panels/editor/inventory.js`; on that date the whole dialog chain moved out into one shared
`askYesNo()` at the top of the same file, which `verify:panel-dialogs` asserts and passes. So the
rule was red *for a fix that improved the behaviour* — and a non-zero exit takes all 77 of that
file's assertions down with it, including every one about `app/api/inventory/[...path]/route.ts`.
Re-pinned to the RULE (the handler must ask; whatever asks must keep the browser's own dialog as its
last resort) and sabotage-tested three ways. This is the ledger's own *"a guard pinned to a code
shape goes red for a refactor"* lesson, on a guard nothing in CI or the hooks runs.

## The six product faults, each in its own commit

2. **`components/owner/OwnerInventory.tsx` could print "updated NaN h ago".** `agoLabel()` does its
   arithmetic without testing the parse, and `Math.max(0, NaN)` is NaN — so the guard that looks
   like it floors the value does not. Measured: `agoLabel("not-a-date")` returns that literal
   string, in the top bar beside Refresh. Sweep 7 · T14 item 17 added exactly this test to the
   three sister screens on one day; this fourth screen in the same territory was missed, and
   `shortDate()` ten lines above already carried an `isNaN` branch.
3. **Same file: the month heading read in the DEVICE's timezone.** `new Date("2026-09-01")` is UTC
   midnight and `toLocaleString` with no `timeZone` renders locally. Measured with
   `TZ=America/New_York` and `TZ=Pacific/Honolulu`: September prints **"August 2026"**, and because
   the tile label is `monthLabel.split(" ")[0]` the card above reads **"Bought (August)"** over
   September's money. Every other date on the screen already sends `timeZone: IST`.
4. **`app/owner/issues/page.tsx`: one half of the screen failing was said by nobody.** The two tabs
   load together in a `Promise.all` and both loaders wrote to ONE `err`: a failure set it, a
   *success* cleared it. **Driven, four ways** (either route answering 500, either settle order):
   Refresh produced no card, no sentence and no mark, and the stale complaint list sat there looking
   current. Only both halves failing at once ever spoke. The failing read usually answers FASTER
   than the working one, so the silent case is the ordinary one. Each read now keeps its own error,
   the shared slot is left to the write actions, the card shows the load error **of the tab on
   screen**, and the tab you are not looking at carries its own mark.
5. **`app/owner/khata/page.tsx` printed the guest's mobile as one ten-digit run.** Measured at
   360px: `9876500077` on Pay Later, under a Customers list showing `90000 00007`. Pay Later is the
   screen you open to *ring* the person who owes you money. The grouping rule moved to
   **`lib/phoneText.ts`** (zero imports, client-safe, the shape `lib/searchText.ts` already uses)
   and the local copy in Customers was **deleted**, not left beside it. One copy remains on purpose:
   `app/aevinite/customers/page.tsx` is the admin terminal's file and is named for whoever owns it.
6. **`app/owner/issues/page.tsx`: on a phone every tab's count fell onto its own line.** The
   segmented pill was capped at 298px of content width and held THREE flex children — two tabs and
   Refresh — so all three shrank below their content: "Guest ratings" on one line and "· 0" alone on
   the next. Refresh was never a tab, and that was the whole cause. It moved out of the pill into a
   wrapping row; the pill never wraps (a stretched pill background across a wrapped row is what the
   note beside `.own-range` in `app/globals.css` warns reads as a broken control). Re-measured with
   the busy case mocked (381 ratings, 12 open): both labels one line, pill 251px inside 298, zero
   sideways overflow.
7. **`app/owner/khata/page.tsx`: the four money figures did not line up on a phone.** The same fault
   sweep 7 · T14 item 10 fixed inside the guest record, on the tiles this time. "Collected this
   month" wraps to two lines and pushes its own number down — measured at 360px: y=261 vs y=275.
   Each tile is now a column with its number pinned to the bottom; re-measured 269 and 269.

## What the re-run cost, and the lesson worth keeping

The mechanical re-runner (`scripts/sweep/t16/rerun.mjs`) first reported **228 regressions** across
the 2,022 rows. The first thirty were every one of them the detector: it extracted backticked spans
from the *how to verify* and *note* columns as well as the claim, so it was asserting that shell
commands (`git diff --name-only origin/main`, `lsof -ti:4114`), measured colour values
(`rgb(245,166,35)`), a fixture value a previous run typed in (`acknowledged_by: "Ravi"`) and quoted
**file paths** were all present inside the source. Restricted to the claim column, and with the four
meanings of "gone" told apart (a negative claim still satisfied · a span that lives in another file ·
a paraphrase · a real absence), it comes to **three** rows needing a human, and all three were fine.

**A ledger row is prose, so a purely mechanical replay is a screen, not a verdict.** That is why the
pass header in `T14.md` categorises how each row was re-executed rather than asserting a number.

Two traps re-paid in full, both already written down and both still expensive:

- **A panel's service worker eats a fault-injected reply.** Twenty minutes went into "the mock is
  not working" before `serviceWorkers: "block"`. Every context in blocks C–F now sets it.
- **Sentry's own 429 is not a page error.** `/api/owner/*` looked like it was failing under a
  console error that turned out to be `ingest.us.sentry.io` rate-limiting our error reports — and
  the message text does not carry the URL, only `m.location().url` does.

## Not driven, and why

Five rows are `⏭` (`P70421`–`P70425`): a successful purchase, the two-lines-one-ingredient
regression test, a waste slip and its undo, a count submit, and a prep batch. Each posts a movement
into an **append-only** stock ledger designed never to be deleted, so driving one would quietly move
French House's stock figures under every other terminal measuring them. The rows name the pattern a
later session should use — a throwaway restaurant created and purged in the same run, as T20 did for
`void_bill`.

## What this run touched

French House's inventory entitlement (switched on, restored and **re-read** as restored), Pizza
Palace's (already on, unchanged), and one expense row created and removed by its own id. Aangan was
never touched. AV live was never read. One owner, one multi-restaurant owner and one manager
sign-in, all cached. No deploy lock, no merge, no deploy.
