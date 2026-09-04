# T17 (sweep #8, wave 3) findings — the owner's Settings, Menu editor, Manager mode and the console shell

> **This is NOT `T17-findings.md`, and that is deliberate.** That file belongs to sweep #6's
> terminal 17 — the ADMIN's health, logs, issues and limits — and so does `LEDGER/T17.md` (1,035
> numbered checks). Sweep #8 re-cut the territories from the real file structure, so **a terminal
> NUMBER no longer identifies a territory**: `T17.md` is sweep #6's admin health, `T17-R2.md` is
> sweep #8's admin console, and this run is sweep #8 wave 3's owner cockpit. Three runs, one number,
> three sets of files. Both of sweep #6's T17 files were very nearly written straight over.
> **Name a sweep's output for its TERRITORY, not for the terminal number that drew it.**

Sweep #8, terminal 17 of 40, 2026-09-04, against `origin/main` **7c154754**.
Branch `sweep8/t17-owner-settings-and-shell` · worktree `../wt-s8-t17` · port 4317.
Ledger: `.claude/sweep/LEDGER/T17.md` (562 new rows, `P70701`–`P71275`, of a block of 1,000).
**The four-part report went into the terminal window, which is where the owner reads it.**

Four problems, all measured, all fixed on this branch, one commit each.

---

## 1 · The Manager-mode launcher's heading was the browser's default, not the console's

`components/owner/OwnerManagerMode.tsx` headed the pick-a-restaurant screen
`<h1 className="adm-page-title">`. **No stylesheet in this repo declares `adm-page-title`**, so the
heading fell through to the browser's own `h1`.

Measured on screen, 1280×900:

| | this heading | every other owner page heading |
|---|---|---|
| font-size | **27px** | 22px (19px at ≤900px) |
| weight | **700** | 800 |
| margin-top | **18.09px** | 0 |
| margin-bottom | **18.09px** | 4px |

So the first screen a multi-restaurant owner meets had the biggest, loosest, least emphatic heading
in the console, and its own sub-line sat 18px away from it.

**Why nothing caught it:** `verify:owner-money` item 7 exists for precisely this class, and its own
comment says *"Checking one file would have let the other two rot, so this walks the whole app."*
The walk was `walk("app")`. This file is in `components/`. Fixed both: the class, and the walk
(`app/` **and** `components/`) — sabotage-tested, it now fails and prints the path. A comment in
`app/owner/manager/page.tsx` claiming that page had been "the last user" of the class is corrected
in the same commit.

## 2 · The launcher's colour dots disagreed with the sidebar's, on one screen

The launcher coloured each restaurant card's dot from `restaurants.accent_color`; the sidebar's "My
restaurants" list, three inches to the left, uses `portfolioColor(id)`. Measured with both lists on
screen at once:

| restaurant | launcher | sidebar |
|---|---|---|
| My Little French House | `rgb(227,192,111)` gold | `rgb(6,182,212)` cyan |
| Pizza Palace | `rgb(192,57,43)` red | `rgb(52,211,153)` emerald |

This is the drift the T5 sweep fixed for the sidebar, the switcher and the charts on 2026-08-07 —
`lib/restaurantColor.ts` was written to hold the one answer, keyed by ID so it survives a sort. The
launcher was never converted. Fixed; both lists now read cyan/emerald. `accent_color` left the
page's two reads with it, and the unused `accentColor` field left `OwnerShell`'s `myRests` state
(fetched and stored every 60s, read by nothing).

## 3 · The restaurant lists were in a different order on every screen, and one of them changed between loads

Measured as the two-restaurant diag owner, 8 loads of each screen:

| list | order |
|---|---|
| `/owner/manager` launcher | Pizza Palace first **1 time in 8**, My Little French House first 7 |
| `/owner/menu` picker | Pizza Palace first 8/8 — **so Pizza Palace's menu was the one that opened** |
| sidebar "My restaurants" | My Little French House first |

Three lists of the same two restaurants, three answers, one of them not repeatable. Both pages read
`select … .in("id", ids)` with no `order by` — PostgREST promises nothing about row order — and then
used POSITION as if it meant something. On the launcher that is confusing. On `/owner/menu` it is
not cosmetic: `selected = ids[0]` decides whose dish names and prices are on screen to be edited.

Fixed with one sorter, `components/owner/ownerRestaurantSort.ts` → `byName()`, called by the
launcher, the Menu picker and `OwnerShell`'s sidebar + top switcher. Measured after: **16/16
identical, alphabetical, on all three lists at both widths**, and `/owner/menu` opens My Little
French House deterministically.

*(The file is called `…Sort`, not `…Order`, because `verify:owner-s7` P21278 asserts that
`app/owner/menu/page.tsx` "touches no bill, order or price directly" by grepping its code for
`/bill|invoice|order/i` — an import path containing "Order" turned a real check red for a reason
that had nothing to do with what it guards. The check is right; the filename was the thing to
change, and there is a note in the file saying so.)*

## 4 · The reconnect card's retry clock skipped rungs

`components/owner/OwnerReconnecting.tsx` held both the READ and the WRITE of its attempt counter
inside a `useState` initializer. React requires an initializer to be pure and runs it twice in
development to catch exactly this, so the count rose twice per screen and the backoff climbed
3s → 12s → 30s instead of 3s → 6s → 12s → 24s → 30s. A production build calls it once, so the wrong
number is **development-only** — but it is the same impurity the T12 sweep found in `OwnerShell`'s
`toggleSkin` and wrote a long note about. The read stays (pure); the write moved into `retryNow()`,
which both the timer and the "Retry now" button call, so a person tapping through a sustained outage
still climbs the ladder instead of looping at 3s.

---

## What was checked and is clean

- **`ownerReportDoc.ts` — 89 checks, all green.** The money flow adds up on paper
  (`gross − discount + GST` printed, and "money in hand" = `gross − discount`); every name, tax
  label and dish title is escaped at the sink for print and left RAW for CSV/Excel; negatives read
  `−₹`; grouping is en-IN everywhere; the 92-row print cap says so while the CSV carries the
  complete series; weekday/daypart/slow-mover thresholds all hold; a period with no sales still
  produces an honest document with no `NaN`, no `undefined`, no divide-by-zero.
- **304 driven page checks** — every one of my three pages × both roles × both skins × 1280×900 and
  360×780 dpr3: no page error, no console error, no leaked code text, **no sideways scroll and
  nothing past the right edge at 360px**, the skin painted on the shell (not the body), sign-out a
  POST form, the crumb naming the section.
- **71 driven interaction checks** — the header toggle broadcasts exactly once and reaches the
  embedded editor without re-navigating it; the Settings buttons agree with the header; the switcher
  re-scopes Dashboard and Manager mode in place and navigates elsewhere; ☰ opens and hardware Back
  closes it without leaving the page; launcher → floor → Back → launcher with **one** history entry;
  the report dialog's eleven periods, its calendar (2020 back, no future month), Escape, and a real
  CSV download whose bytes carry the money flow; the password form refuses a mismatch and a short
  password **without asking the server**; and Settings makes **no** printing request in 35s with the
  tab hidden.
- **183 rows from earlier sweeps re-run and updated in place** across 16 ledger files. **No
  regressions.** Two rows were superseded by decisions rather than broken (`P06002`, the deleted
  "not switched on" card under R36; `P06006`, whose "ordered by the entitled-id order" WAS the fault
  fixed above) and say so in their notes rather than being rewritten.

## The one row that is not a clean pass

`P71119` — one 404 in the console on the first desktop-light load of `/owner/manager` in the suite.
Re-driven three times immediately after: clean, no 4xx at all. **The URL was not captured, so it
cannot be named**, which is the honest limit of that row. Most consistent with the standing pre-empt
that the dev server compiles each route on first hit. `live.mjs` now logs `http <status> <url>` for
every 4xx so a repeat can answer it instead of guessing. Not filed as a product fault.

## The guard left behind

`npm run verify:owner-shell` — 98 static checks over all twelve files, no server needed.
**Sabotage-tested 26 for 26.** Two of those sabotages passed on the first attempt and both were the
guard being too loose — a token that appears twice, so replacing one left the other; both are counted
now, not merely present. The suite refuses to pass if fewer than 60 checks run.
Deliberately NOT added to the PostToolUse hook: a red guard there refuses Write/Edit for every
session in this shared folder, and this one is new. It should join `verify:everything`'s `GUARDS`
list — that is the merge terminal's call, because adding to it shifts the phase numbering.
