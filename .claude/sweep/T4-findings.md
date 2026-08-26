# T4 findings — sweep #7 (2026-08-22/23)

**Territory:** working offline, and in every language — `public/sw.js` · `public/offline.html` ·
`public/panels/swreg.js` · `public/panels/offline.js` · `components/{OfflineNotice,OfflineShell,ConnectionBadge,AppShell,BanGate,BotTrap,Maintenance}.tsx` · `lib/i18n.ts`

**Branch:** `sweep7/t4-offline-and-language` · **port:** 4204 (production build, proved mine before
anything was trusted) · **base:** `origin/main` b64951ad

---

## What the re-run said

**All 500 existing rows (`P01501`–`P02000`) were re-executed, not sampled. No regression** — every
row that was green is still green, and every row sweep #6 marked `❌→✅` is still green.
`npm run verify:offline` re-ran in full: **55 passed, 0 failed**, and it tidied its own tables after
itself.

**Ten of my own re-run assertions came back red and all ten were MY DETECTOR, not the code.** Each
was verified by reading the line. They are recorded in the ledger because a withdrawn finding is as
useful as a confirmed one. The best of them is a lesson in itself: my comment-stripper read
`/api/editor/*` inside a `//` comment as the start of a block comment and silently swallowed the
whole `NEVER` list — this repo's own "half a comment eats the next rule" trap, reproduced inside the
checker that was meant to catch things.

**New checks: `P16601`–`P17100` (500).** 497 green, 3 were real problems.

---

## The four items, one commit each

### Item 1 — the offline suite was sitting down at another guard's table
`scripts/verify-offline.mjs` · commit `676cfdc7`

Section 5b chose its table with its own bare loop, `for (let i = 30; i >= 1; i--)`, consulting
neither the floor count nor `scripts/sweep/fixtureTables.mjs`. `pickFreeTable()` in the **same file**
had been taught both in sweep #6 and carries three paragraphs explaining why; this loop, added
separately, re-opened the identical hole on the identical table.

**Measured today, not read:** it seated **table 28** — reserved for `verify-void-on-joined-party`,
*"the joined table whose food must survive"* — and then closed and billed it. Closing a session
cancels and archives every unpaid live order on it (mig 232), so the other guard's party is
destroyed mid-run and **that** guard reports a void that had worked perfectly.

This is the most expensive kind of test failure this project can have: it looks exactly like a real
product fault, it surfaces in a *different* terminal's report, and it only reproduces when two runs
overlap.

**Guard:** `npm run verify:fixture-pickers` (new). A script that opens or closes a session and picks
its table from a numeric range must consult `claimedTables()`. Static, no key, no server, well under
a second. Its first draft cried wolf twice on a clean tree — a retry loop that merely had "table" in
its body, and a filter applied fifteen lines below its loop — and both lessons are written into the
file, because a guard that invents a failure protects nothing.

### Item 2 — a diner who lost signal in the 3D dish view was handed the staff sign-in
`public/offline.html`, `public/sw.js` · commit `2ad9033d`

The last-resort page learned in sweep #6 to send a diner back to a menu instead of to `/`, which
`app/page.tsx` redirects to `/login` — the staff username and password screen. It learned three
doors: `/r/<slug>/…`, `/menu` and `/item`, and `/q/<code>`.

It missed **`/view/<folder>` — the 3D dish viewer**, this product's differentiator, reached by
"View in 3D" from any dish. That path has no `/r/<slug>` in it, so it fell through to `/`.

**Measured on a production build, not read from source:** offline on a `/view` path this device had
never opened, the button read *"Go to the home screen"* and went to `/`. A reload of the 3D view with
no signal is precisely the *"tab wakes, reloads, no signal"* moment the whole offline layer exists
for.

The information to do better was already there: `app/view/[folder]/page.tsx` stamps
`lfh_tab_tenant` before hydration from the **database's own slug**, and the link carries `?r=<slug>`.
The way out now reads the pinned slug first, then a `?r=` validated to `[a-z0-9-]` exactly as that
page validates it, and failing both falls back to `/menu` — which is where a `/view` with no
restaurant information resolves anyway, so it is the consistent answer rather than a guess.

Fixed in **both** copies: the branded page and the bare inline copy inside `sw.js` that a device
falls back to when even the branded one is missing. **VERSION v10 → v11**, required rather than
housekeeping: `/offline.html` is precached, so devices keep the old copy until the cache names move.

**Guard:** `npm run verify:offline-retry`, 17 checks → 29. Its stub now answers **any** path with the
real page — which is what the worker does, since `respondWith` does not change the address — so all
seven doors are driven and clicked for real, and the two copies are compared door by door.

### Item 3 — the French menu used two different apostrophes
`lib/i18n.ts` · commit `bffe46eb`

The dictionary writes its apostrophes as the typographic `’`. French had four values doing that and
three still carrying the typewriter `'`: `noRatingsYet`, `submitReview`, `itemNotFoundDesc`. So a
French diner met one apostrophe shape on the empty-menu screen and a different one on the review
button, on the same menu. French was the only language mixing them.

Nobody can name this when they see it and everybody registers it. Three values now use `’`. No
length change, so no card or button re-flows.

**Guard:** `verify:i18n-scope`, one more check, asked **per language** — a language that
consistently uses the typewriter form everywhere is internally consistent and passes. The fault is
the mixture, not the choice.

### Item 4 — nothing was asking which offline layer a device is actually running
`scripts/verify-warm-shell.mjs` · commit `d0895424`

Two findings, one fix. The worker answers `{type:"LFH_PING"}` with its own VERSION. That handler had
**no caller anywhere in the repo** — and ledger row `P01936` recorded it green with the note *"used
by verify-warm-shell.mjs"*, which **was never true**: `git log -S LFH_PING --all` shows the string
has only ever appeared in `public/sw.js`. A row asserted the hook was covered while nothing asked it.

The reason to give it a caller rather than delete it is the second finding: **VERSION is
load-bearing and had nothing watching it either.** Every cache name interpolates it, `activate`
deletes every `lfh-` cache that is not one of the four current names, and `/offline.html` is
precached. If VERSION and the live cache names ever disagree, a deploy silently keeps the previous
offline layer and a fix nobody receives looks shipped.

**Guard:** `verify:warm-shell` §8 (13 checks → 15) asks the running worker its version, compares it
with the file, and checks every live cache name carries it. Proven both ways: gutting the handler
gives *"the diagnostic hook is dead"*, and pinning one cache name to an old version gives
*"declared v11, found v11, v9"*.

---

## Deliberately NOT filed — recorded so the eighth sweep does not re-file them

| looks wrong | is right, because |
|---|---|
| three `NEVER` entries match no route (`/api/auth`, `/api/owner/login`, `/api/verify`) | **Forward-safe, unlike a dead `DATA_PATHS` entry.** A dead `DATA_PATHS` pattern falsely claims "this is saved offline"; a dead `NEVER` entry claims "this is never cached" about something that cannot be cached anyway, and protects the route from day one if it is ever added. Every sign-in route that *does* exist is covered, and both logout routes are handled before `isNever` is reached. (P17087–P17089) |
| the offline bar spells one plural inline instead of calling `changesWord()` | Identical words. A tidiness point, not a defect. Row `P01669`'s expectation was refined so it is not read as stronger than it is. (P17090) |
| `scheduleHeal` schedules an untracked one-shot `render()` | No handle kept, but it touches no network and no database and each fires once, so it cannot accumulate the way the offline page's retry chains did. (P17091) |
| Arabic's hero greeting renders as disconnected, mis-ordered letters | **The owner's own recorded decision (R23).** Each grapheme sits in its own box and browsers cannot join Arabic across boxes. Confirmed still present, with a screenshot kept as evidence — deliberately **not** re-raised as work. (P17081) |

---

## One thing left for another terminal

`npm run verify:ledger-index` goes red the moment the first sweep-#7 ledger lands, because
`INDEX.md` still said *"next free ID `P15101`"*. **Terminal 40's territory explicitly owns rebuilding
that file.** I made only the one-line, conflict-tolerant edit that is true whoever else edits it —
moved the marker past the whole sweep-#7 allocation (`P15101`–`P35100`, block base
`15101 + (N-1) * 500`) and wrote the formula down, so no other sweep-#7 terminal has to touch that
line at all. The per-terminal `filed?` table still needs T40's real rebuild.

---

## Verification

- `npm run typecheck` — passes.
- `npm run verify:offline -- --base http://localhost:4204` — **55 passed, 0 failed** (production build).
- `npm run verify:offline-retry` — **29 passed, 0 failed** (was 17).
- `npm run verify:warm-shell` — **15 passed, 0 failed** (was 13).
- `npm run verify:i18n-scope` — all checks pass.
- `npm run verify:fixture-pickers` — **3 passed, 0 failed** (new).
- `npm run verify:ledger-index` — green: 29 ledgers, 15,018 rows, 15,018 distinct ids.
- `npm run verify:rejected`, `npm run verify:taps` — green.
- Every fix proven by **reverting it and watching the guard go red**, then restoring.
- `git diff --name-only origin/main` is a subset of my territory. No migration, no other panel, no
  owner or admin screen, no `CLAUDE.md`, no settings file. Nothing named or read the live client stack.
