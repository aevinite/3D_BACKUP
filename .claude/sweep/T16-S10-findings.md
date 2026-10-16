# T16 · Sweep #10 — Shared panel plumbing — findings (all fixed on `sweep10/t16-shared-panel-plumbing-the-helpers`)

One commit per item, the number in the message. Every fix has a guard that goes red on the old code
(sabotage-tested). The four-part report lives in the terminal chat, not here.

| # | what a person lost | file | how it was confirmed | guard |
|---|---|---|---|---|
| 1 | **Every profile save on every staff panel answered "Not Found" since 2026-08-05** — the ⚙ drawer's Save details / Set PIN / first-login card and "My profile & pay". The queue built the address as `undefined + /api/panel-profile`. | `maint.js`, `outbox.js` | driven: the request went to `/panels/editor/undefined/api/panel-profile` (404 on the dev server and on the backup site) | `verify:outbox` §12 |
| 2 | A discount that ran out of retries **let the settle behind it go out at full price**; Try again then landed the discount on a settled bill. | `outbox.js` | driven against a scripted server: "pay, discount" arrived in that order | `verify:outbox` §13, `verify:panel-plumbing` (+2), P04050 |
| 3 | Closing one card and opening the next straight after (**Mark unpaid → Yes → reason card**) made the next close **throw the person out of the panel**. Reported by T12. | `backstack.js` | driven: the page left every time with the second card opened a microtask or 0 ms later | new `verify:panel-backstack` (14), P65921 |
| 4 | A Wi-Fi blip on a **Firefox** staff device was filed as a red crash and could ping the owner's phone (the phrase list held only the first five words of Firefox's sentence). | `errlog.js` | driven: "NetworkError when attempting to fetch resource." was sent as a crash | `verify:t12-plumbing` P185001 |
| 5 | A slow read put the browser's words **"signal timed out"** on a manager's screen (seen on the Dashboard). | `netretry.js` | seen live on :4416 with the slow dev database | `test:netretry` (+2) |
| 6 | On the light skin the **✕ that closes the profile drawer was white on beige**, all but invisible. | `maint.js` | screenshot, manager panel at 360 px | `verify:panel-plumbing` (+2) |
| 7 | A busy moment at boot **hid the ⚙ Profile button — and Sign out — for the whole shift**; the only retry waited for an `online` event that never comes when the server, not the network, is slow. | `maint.js` | driven: two 503s at boot, server healthy a second later, no button after 20 s | `verify:outbox` §14 |
| 8 | When the profile could not be read, "My profile & pay" **told a signed-in person they were not signed in**, and the button stayed hidden. | `myprofile.js` | driven with the same busy boot; also seen live on the slow dev database | `verify:outbox` §14 (+3), P04359, P66052 |
| 9 | A change queued in the **first moment after a panel opened dropped out of the list** (on the device, but not shown, not sent, no timer) until a reload. | `outbox.js` | driven: missing 5 times out of 5; found because one of my checks went red once in four runs | `verify:outbox` §15, P04060 |
| 10 | `/api/maintenance` scoped an **OWNER** to their login's "home" row — restaurant #1 — instead of a restaurant they own. No screen calls it as an owner today; it now checks the owner's portfolio like the manager panel's route does. | `app/api/maintenance/route.ts` | read inline, then driven in memory | new `verify:public-endpoints` (22) |

## Noted, outside this territory (one line each, for their owners)

- Manager panel → floor (custom layout on, no plan): shows the developer text "The plan lives in public/panels/floor-layouts.js" to a manager — `editor/app.js` / `floor-layouts.js`.
- Manager panel → with the guest menu switched OFF there is no bell, so printer-stuck and low-stock notices (which moved into the bell on 2026-08-30 / 2026-10-03) have nowhere to appear — `editor/app.js` `syncGuestBell()`.
- Manager panel → `api()` marks every failed READ as offline (`netErr.offline = true`), so a read that timed out on a slow server reads "no internet right now" — `editor/app.js`.
- Waiter tablet → four sideways rows still have no "more this way" hint (`swipehint.js` not loaded) — T12.
- Manager panel → `LFH_BACK.layer("table-detail", …)` called unguarded (harmless, backstack loads first) — T6–T8.
- `lib/backStack.ts` (the React twin of backstack.js) may carry the same rewind-race shape as item 3 — not checked here.
- Generated ledger `T20-S8.md` rows P73981 / P74195 (auditsort) are re-run by `verify:bin-billing-usage`, not by hand.

---

# Round 2 (owner, 2026-10-15: "do all five … replan the whole test … make sure everything should be covered")

All on `sweep10/t16-round2`, one commit per item, each with a guard that goes red on the old code.

| # | what a person lost (or got) | file | how it was confirmed | guard |
|---|---|---|---|---|
| 11 | **Report an issue** refused a new phone's 8-12 MB photo with "Photo must be 5 MB or smaller". It is now made smaller and attached. | `issue-raise.js` | driven: a 9 MB photo attaches, a WebP under 5 MB travels | `verify:panel-helpers-driven` §1 |
| 12 | **My profile & pay** said "0 of 8 details filled" over a dozen boxes. Now "No details added yet" / "3 of 8 key details added". | `myprofile.js` | driven at 0, 3, 8 | §4 |
| 13 | "Person (A–Z)" opened on a block of nameless rows. A blank now sorts LAST in every A–Z sort. | `auditsort.js` | driven on both lists | §5 |
| 14 | A first-login save made with **no signal** left the card un-closable until the internet returned. | `maint.js` | driven offline | §3 |
| 15 | **Owner → Settings → Guest menu** — the owner's own maintenance switch (Live / Offline, asks first). At the default ("Owner only") nobody at the restaurant could take the menu down before this. | `app/owner/settings/page.tsx`, `app/api/owner/settings`, `lib/maintenance.ts` | driven in memory + the real page at 1280/390, both skins looked at | `verify:guest-menu-switch` |
| 16 | Every **manager** saw "Take guest menu offline" even when it was not handed to them (the confirm then said "ask your admin"). | `maint.js`, `app/api/maintenance` | driven | `verify:guest-menu-switch` §1, helpers §2 |
| 17 | Changes queued in the **same instant** came back in a random order after a reload (16 of 20). | `outbox.js` | driven | `verify:outbox` §16 |
| 18 | **REGRESSION from round 1 (item 8):** a busy re-read right after a save replaced My profile & pay with "Couldn't load your profile", about a save the server had kept. | `myprofile.js` | driven | helpers §6 |
| 19 | A second save on My profile & pay could be refused as "someone else changed your phone" — the person's own change. | `myprofile.js` | driven against the shipped clash rule | helpers §6 |
| 20 | **Report an issue** sent with no signal dropped the photo / voice note and still said "Saved ✓". | `issue-raise.js` | driven: `image_url: null` | helpers §7 |
| 21 | 53 of the 75 changes the panels can queue were named like "3f2a9c1e-77aa… move" on the saved-on-this-device sheet; two said the wrong thing ("Update availability", "Settle bill"). | `outbox.js` | every api() write in the three panels read from their code (103) | `verify:outbox` §17 |
| 22 | Dead `debounce()` in realtime.js (nothing could run it). | `realtime.js` | coverage | `verify:panel-plumbing` (no declared-but-unused helper) |
| 23 | With no signal, removing a photo / voice note left its button ON, contradicting the offline note. | `issue-raise.js` | found by mutation | helpers §7 |
| 24 | Dead `off` flag in connbadge.js (computed, never read). | `connbadge.js` | found by mutation | `verify:panel-plumbing` (now every variable) |

## How "everything covered" was measured

- **Coverage** (`scripts/sweep/t16s10/cov.mjs`): V8 coverage of every suite and my browser guards. Never-run lines went **~244 → 0 reachable**. What is left cannot run in a browser that runs these panels (a group after an always-true group, a `globalThis`-less browser, a page with no body) or navigates the page away before a record can be taken (Sign out / signed-out-mid-tap — driven and green: P185622–P185626, P185829–P185831).
- **Mutation** (`scripts/sweep/t16s10/mutate.mjs`): one deliberate break at a time in a COPY, only checks that RUN the file, a control first. **510 breaks tried, 459 caught**, 1 removed as dead code (item 24), 1 duplicate after a line shift. Five passes until a pass found nothing new.

## The 49 breaks no check catches — and why none can matter

- **`return null` → `undefined`** (11): every caller asks only "is there one?" (`if (!x)` / `== null`). outbox 325, offline 310/319, connbadge 20/237, theme 18, fitnums 148/150, guestbell 235, swipehint 27, shrinkimg 66.
- **A capability test inside a `try`** (6): if it misjudges, the `catch` lands on the same fallback. netretry 68, realtime 104, offline 593, fitnums 129, errlog 283, issue-raise 198.
- **A boundary only an exact value reaches** (15): a 1 px tolerance (swipehint 77/91/92/98), the 4 px "moved" mark that only gates the 60 px flick (undobar 184 ×2), exactly 0 ms left (undobar 300), exactly 180 KB / the same byte size (shrinkimg 93/99), a zero-iteration loop (backstack 50), a Back with nothing open that leaves the document (backstack 68), a loop index one past the end that `watch()` already ignores (swipehint 121), and two always-present DOM methods (swipehint 119/136).
- **A value nobody reads** (5): `ensureClient()`'s three return values (realtime 281/285/289 — every caller ignores them), the pop's re-render signature, which changes either way (connbadge 281), a `console.error` text (owner/settings 256).
- **Reached only by input a browser never produces** (7): a bitmap of height 0 (shrinkimg 90), computed font size not in px (fitnums 58), nowrap already set (fitnums 28), the minimum-size loop that the next line ends anyway (fitnums 74), the tooltip rule on an element with children (fitnums 104), a keyless row's `at` fallback when it has an id (guestbell 87), the older start style handing each topic the same no-op (realtime 183).
- **Unreachable by construction** (5): offline 66 (the bar returns for "offline" before asking), auditsort 378 / 498 (an always-true last group; the `window` fallback where `globalThis` exists), errlog 278 (the final `|| ""` when every earlier name is empty), client-error 230 (`where || null` when the screen name always answers), issue-raise 386 (the history entry is already cleared when Back reaches it).

---

# Round 3 (owner, 2026-10-16: "replan whole test. Don't use the previous one … do it again … I want it completely error free")

All on `sweep10/t16-round3`. A new suite written from scratch — `scripts/t16r3/`, `npm run verify:panel-plumbing-r3` — that
serves the REAL panel files from its own local server (no app, no database, no login) and drives them in a real browser;
families G and H also drive the real manager / kitchen / tablet panels (`--base`), with every write answered in the browser.

| # | what a person lost | file | how it was found | guard |
|---|---|---|---|---|
| 25 | (asked) the Dashboard charts drawn with real numbers | manager panel → Dashboard | French House's reach set to "last 7 days" for the run and restored exactly; 7 charts drew ₹14,209 — no fake sale made (a paid bill draws an invoice number that can never be deleted) | — |
| 26 | On an **iPhone** a shrunk photo was a PNG named and labelled WebP — stored as megabytes under a false name, downloaded by every guest | `shrinkimg.js` | family C/B in WebKit: `toBlob("image/webp")` answers `image/png` | R3-B-044 (judges each file by its own bytes) |
| 27 | The offline sheet's and the guest bell's ✕ had no name a screen reader can say | `offline.js`, `guestbell.js` | family D | R3-D |
| 30 | The everyday ⚙ drawer showed Phone as optional and then refused it empty | `maint.js` | family K | R3-K-001 |
| 31 | On an older iPad (no `createImageBitmap`) every shrunk photo stayed pinned in memory all shift | `shrinkimg.js` | coverage pass 1 → reading the fallback | R3-L-017 |
| 32 | Every crash from Samsung Internet was filed as Chrome; Edge on a phone as Chrome / Safari | `app/api/log/client-error/route.ts` | coverage pass 1 → 13 real browser strings | R3-M-004 |
| 33 | A figure more than twice its tile's width was crushed to the 11 px floor instead of shrunk just enough ("1,234 covers": 11 px where ~13 px fits) | `fitnums.js` | the mutation run — a break no check noticed, then measured | R3-P-003 |
| 34 | The saved-on-this-device bar flipped to "hasn't sent yet — the connection looks fine" in the last 1.5 s before EVERY retry, then back | `offline.js` | the first full 200-seed final run sampled inside that window | R3-O-006 |

Decisions left with the owner: **28** — eight texts under the WCAG reading standard, mostly the gold house colour (R13), frozen
by a ratchet in family E; **29** — the manager panel asks the print queue every 20 s, hidden or not, even on a screen that is not the
printer (`editor/app.js` `managerPrintPass`, the printing terminal's file).

## How "everything" was covered this time

- **Sixteen families** — A random queue sequences (200 seeds) · B random inputs (thousands of cases) · C Chromium + WebKit ·
  D names / tap sizes / Back · E a layout + contrast grid (168) · F the three routes vs 1,500 random requests · G real panels under a
  busy / silent / erratic server · H what an idle panel costs · I–N three further passes aimed by coverage · O–P two passes aimed by the mutation run.
- **Coverage**, round-3 checks only: pass 1 left `realtime.js` / `swreg.js` / the owner switch at 0 % and ~1,100 lines unrun; families
  I–M brought every file to 90–100 %; family N took the voice note, the frame sign-out and the rest.
- **Mutation**, round-3 suite only (`--bail`, the families that RUN each file): **180 breaks, 143 caught** — 111 by families A–N,
  30 more once O–P were aimed at the survivors, 2 more by the last two P checks. A full 200-seed run of family A also showed the
  queue is **at-least-once by design** (a reload can resend a change whose answer never came back; every route it writes to runs
  an action id once, `lib/idempotency.ts`) — so A now judges "one change, one action id, a repeat marked a replay" (a fresh id per
  replay turns 20 of 60 seeds red).
- **Sabotage**: every family was broken on purpose at least once and went red (a give-up that deletes, a 1,400 px bar, a manager
  allowed without the hand-over, a truthy `on`, a claim that beats the address, every error called "no internet", a late undo card,
  a voice note sent as a photo …).
- **Firefox** could not be run on this Mac (its Playwright build fails "Could not find profile folder", also after a forced
  reinstall) — 14 visible skips, never a silent pass.

## Noted, outside this territory

- Manager panel → the 20 s print-queue check runs on every manager screen, hidden or not, whether or not it is the printer — decision 29, `editor/app.js`.

## The 37 breaks no check catches — and why none can matter

- **Not this terminal's code (5):** `app/api/owner/settings/route.ts` 148 / 215 / 385 / 405 / 407 belong to the route's other
  features (modules, printing, the owner's Activity id) — only its maintenance half is T16's.
- **Type lines, no code (2):** `lib/maintenance.ts` 40 / 41 (`true` / `false` inside a TypeScript union).
- **A capability test or fallback inside a `try`, or a `typeof` that is always true in a browser (8):** offline 69, netretry 68 /
  136 (the first `||`: an abort is always also "aborted"), realtime 71 / 289 / 313, myprofile 290, auditsort 179.
- **A starting value overwritten before it is read, or a listener flag (8):** undobar 174 / 177, guestbell 68, theme 60 (the
  capture flag), swreg 99 (`once`), swipehint 110, backstack 62 (a second microtask that finds nothing to do), maint 346.
- **A guard every caller already applies (3):** maint 707 (init never runs while the button exists), issue-raise 369 (the layer
  is registered once per open), swipehint 131 (a loop bound whose body re-measures anyway).
- **A wording or count no real input reaches (4):** guestbell 291 (`el()` drops an undefined text), guestbell 306 (the catch
  path), myprofile 137 (only a nameless profile reads differently — and then "?" either way), myprofile 237 (the clash field name).
- **Timing only (4):** netretry 126 (which attempt waits — the count is unchanged), realtime 386 (a default the caller always
  passes), outbox 579 (a backoff reset while offline costs nothing — flush returns at once), offline 259 (the other `&&`).
- **Late-load and visibility (3):** swipehint 144, swreg 28 (`update()` on a visible tab — a nicety), fitnums 57 (`|| 1` only
  for a zero-width box, which never overflows).
