# T1 — GUEST MENU CORE · problems found and fixed

Sweep #7, 2026-08-22/23. Branch `sweep7/t1-guest-menu-core`, worktree `~/Documents/Projects/wt-s7-t1`,
port 4201, against `origin/main` **b64951ad**.

Territory: the three guest doors (`/menu`, `/r/<slug>/menu`, `/q/<code>`), `MenuView`, `FoodCard`,
`NavPicker`, `Header`, `HeroTitle`, `GuestChrome`, `GuestNotFound`, `IntroSplash`, `ComingSoon`,
`app/page.tsx`, `app/not-found.tsx`.

**502 existing ledger rows re-run — 0 regressions. 500 new rows written and executed. 4 problems
found, all 4 fixed here, each with a guard proved to fail on the pre-fix code.**

> Sweep #6's findings for this territory (F1 the mis-cased link, F2 the bell → **R29**, F3 the
> not-serving preview) were all re-checked this run and all still hold. They are not repeated below.

---

## The headline: two of the four were invisible to every check that already existed

Both **item 1** and **item 3** had passing ledger rows sitting on top of them the whole time.

- **P00013, P00014, P00015 and P00494** all assert that the menu saves and restores the diner's
  scroll position. All four passed on every pass of every sweep. The feature had stopped working.
  They assert the SHAPE OF THE CODE; nobody had ever come back from a dish and looked.
- **P00488** asserts the search suggestions "describe themselves honestly to a screen reader". It
  passed. The fix it was written for had taken the LINK role off every suggestion row.

The two guards added for them are behavioural for exactly that reason: one drives a real Back, the
other reads the browser's own accessibility tree.

---

## 1 · Back from a dish put the diner at the top of the menu again — HIGH · confirmed, fixed

**Who is worse off:** every diner who opens a dish and comes back, on every restaurant.
**Where:** guest menu → the dish grid → tap any dish, then press Back. What he'd SEE: the menu
scrolled all the way back to "BONJOUR" and the first category, instead of the dish he was looking at.
`components/MenuView.tsx`.

**What happens.** The scroll effect ends with a bare `onScroll()` — *"run once on mount so the shrink
starts at the right value if we restored a scrolled position"*. That mount call runs while the list
is still EMPTY, so `el.scrollTop` is 0, and it wrote that 0 straight over the saved position. The
restore effect runs later (it waits for the dishes), read the 0, and its `if (y > 0)` guard did
nothing at all.

**Measured, not reasoned about.** With the key pre-seeded to 1438, one fresh load produced EXACTLY
ONE write to it — value `"0"`, 136 ms in — and the page stayed at 0. Reproduced on a **production
build**, so it is not a dev-only double-mount artefact.

A second cause sat behind it: two frames is enough for the CARDS to exist but not for the page to
reach its height, because every dish photo is `loading="lazy"` with no reserved box. The browser
silently CLAMPS `scrollTop` — asking for 1438 landed at 447, and nothing re-aimed once the photos
arrived.

**Fixed by** gating the save on the restore having settled, and re-aiming the jump until the page
stops growing — instantly rather than through the container's `scroll-behavior: smooth`, and bounded
four ways (reached it · the guest scrolled and we get out of their way · the height stalled three
ticks running · a 2.5 s deadline).

**Confirmed in a browser**, both restaurants: left at "Mint Melon Juice", came back to "Mint Melon
Juice"; left at "Green Apple Mojito", came back to "Green Apple Mojito". Before the fix the same two
journeys came back to "Espresso" and "Virgin Mojito".

**Guard:** `verify:guest` → **P15332**, both halves. The live half drives the whole journey and
asserts the DISH, not a pixel. Proved to fail on the pre-fix code with exactly that message.

**One thing I got wrong on the way, recorded so nobody repeats it:** I first measured a *second*
corruption — the saved value being overwritten with a clamped number during the hop to the dish page
— and built three more mechanisms to defend against it. It was **my test scrolling the page**:
Playwright's `.click()` scrolls an off-screen element into view first, and I was tapping the 4th
card while at 1438. All three mechanisms were removed again. Tap a card that is ALREADY on screen.

---

## 2 · At 99, the dish card said "added" with a green tick, and nothing was added — MEDIUM · fixed

**Who is worse off:** a diner or waiter adding a large round to one line.
**Where:** guest menu → any dish card whose count is already 99 → tap "+". What he'd SEE: a green ✓
and "<dish> added", with the number still reading 99. `components/FoodCard.tsx`.

**What happens.** *"A limit is not a success"* (owner, 2026-08-18) was applied to the Maximum-99
message — `variant: "info"`, a neutral • instead of the default ✓ — but the `"<dish> added"` toast
at the foot of the same function still fired on ANY `delta > 0`. It arrived second and won. The
photo's success bounce ran too, first thing in the function, before anything knew whether the add
would land.

**Measured on the real card** (Aangan, Virgin Mojito at 99): the toast read `✓ | Virgin Mojito added`
with "TAP TO VIEW YOUR BILL" under it, and the quantity stayed at 99.

`CartPanel`'s "+" has always had this right: at the ceiling it raises the same message and RETURNS.
Those two strings exist precisely so the bill and the dish card explain one limit the same way, so
the behaviour around them has to match too.

**Fixed by** one `refused` test gating both the success toast and the bounce. The removal path and
every ordinary add are untouched.

**Confirmed in a browser:** a normal add still shows `✓ Virgin Mojito added`; at 99 the tap now shows
`• Maximum 99 per dish` and nothing else; "−" from 99 still goes to 98.

**Guard:** `verify:guest` → **P15366**, proved to fail on the pre-fix code.

---

## 3 · A blind diner could not reach the search suggestions at all — MEDIUM · confirmed, fixed

**Who is worse off:** a diner using a screen reader.
**Where:** guest menu → type in "Search dishes…" → the drop-down of matching dishes. Nothing to SEE:
the panel looks and behaves identically. `components/MenuView.tsx`.

**What happens.** The 2026-08-17 accessibility fix put `role="listitem"` on each suggestion `<Link>`.
An explicit role REPLACES an element's own one, so every row stopped being a link.

**Read out of Chrome's own accessibility tree:** the panel contained eight `listitem`s and **NOT ONE
`link`**, while 58 other links on the same page were listed normally. Skimming by links is the
ordinary way a screen-reader user reads a page, and the search results were invisible to it — and no
row announced that it could be opened.

**Fixed by** making the panel a labelled GROUP of links, which is what it actually is and the pattern
the category chip row above already uses. The `aria-label` still carries the count. `role="list"`
was the alternative and needs `listitem` children, i.e. a wrapper around each anchor — and
`.search-result:last-child` draws the row divider, so wrapping would have put a border under every
row.

**Confirmed in a browser:** the tree now reads `group "8 matching dishes"` → `link "Pasta Salad ₹199
Salads"`; 8 of 8 rows keep their link role and the page's link count went 58 → 66. No DOM change, no
CSS change, nothing moved on screen.

**Guard:** `verify:guest` → **P15514**, and **P00488** tightened to assert the group rather than the
list. Both proved to fail on the pre-fix code.

---

## 4 · The language and currency lists said "list box" and then had nothing in them — MEDIUM · fixed

**Who is worse off:** a diner using a screen reader, on every restaurant that offers more than one
language or currency.
**Where:** guest menu → the "EN" button in the top bar (and the ₹/$ button beside it) → the drop-down.
Nothing to SEE. `components/NavPicker.tsx`.

**What happens.** Each `role="option"` button sat inside an `<li>`. A listbox must OWN its options
directly; an element in between breaks that relationship.

**Read out of Chrome's own accessibility tree:** `listbox "Language"` containing plain `button`s and
**ZERO options** — no selectable items, no "1 of 3" position, and `aria-selected`, the only thing
marking WHICH language is currently on, never conveyed. A blind diner could not tell which language
they were already using.

Same shape as item 3, in a component nobody had looked at. **This is the third time this exact
mistake has been made in this territory** (the category chips were a `tablist` with no tabpanel, the
suggestions were a `listbox` with no options, and now this) — which is why the guards for it are
written against the browser's computed tree rather than the markup.

**Fixed by** dropping the `<li>`. `.nav-picker-list` is already `list-style: none` and
`.nav-picker-item` is already `width: 100%`, so the buttons render identically as direct children.

**Confirmed in a browser:** the tree now reads `listbox "Language"` → `option "🇬🇧 English"`,
`option "🇫🇷 Français"`, `option "🇮🇳 हिन्दी"`. Screenshot compared before and after: identical — same
160×137 box, same 146×41 rows, English still highlighted as the active one. No CSS touched.

**Guard:** `verify:guest` → **P15517**, proved to fail on the pre-fix code.

---

## Measured, reported, and deliberately NOT changed

### The category chip's ink is the weaker of the two on 11 of 21 real colours

`inkOn()` in `MenuView.tsx` picks black or white from a luminance THRESHOLD (0.42). Across every
distinct category colour actually in the database, **eleven land on the weaker ink**:

| colour | category | ink today | contrast | the other ink |
|---|---|---|---|---|
| `#22c55e` | salads | white | **2.3:1** | 8.3:1 |
| `#06b6d4` | drinks | white | **2.4:1** | 7.7:1 |
| `#c79a3e` | soups | white | **2.6:1** | 7.3:1 |
| `#0ea5e9` | beverages | white | 2.8:1 | 6.8:1 |
| `#f97316` | sandwiches | white | 2.8:1 | 6.7:1 |
| `#ca8a04` | tacos | white | 2.9:1 | 6.4:1 |
| `#e8772e` | starters | white | 3.0:1 | 6.4:1 |
| `#d97706` | biryani | white | 3.2:1 | 5.9:1 |
| `#16a34a` | salads | white | 3.3:1 | 5.7:1 |
| `#ec4899` | desserts | white | 3.5:1 | 5.3:1 |
| `#ef4444` | pizza | white | 3.8:1 | 5.0:1 |

Picking whichever ink has the better contrast, instead of testing a threshold, is a two-line change
and is better at **every** colour, not just these.

**Not made here on purpose.** It flips the SELECTED chip from white text to dark text on eleven
colours across every restaurant, and that is a visible design decision — the owner's standing rule is
*"Design work → load the UI/UX skill, compare approaches — never restyle by eye."* I looked at the
worst one on screen ("Salads", bold white on mid-green) and it is legible, just below the standard.
Raised as improvement **#12** with these numbers so it is a one-line decision. Recorded at
**P15465** so the next sweep does not re-derive it.

### The brand wordmark ellipsises at 320px

`little French …` on a 320-wide screen: 98 px available, 120 px needed. Deliberate CSS
(`text-overflow: ellipsis` + `nowrap`), and it is clean at 360, 390, 412 and 768 — the owner's own
test widths are 360 and 390. An honest "…" is the designed behaviour. Shrinking it to fit, the way
dish names already do, is improvement **#11**. Recorded at P15550/P15554.

### Considered and NOT reported

- **The waiter bell overlapping a card** — **R29**, ruled by the owner on 2026-08-17. Re-measured
  this run at five widths and both skins: visible, opacity 1, pointer-events auto, and **0
  overlapping controls** at every one. Not a fault and not re-reported.
- **The very first visit fetching the menu twice** — measured on a production build: 2 on a
  brand-new profile while the offline layer fills itself, **1 on every load after that**. The fault
  sweep #6 fixed (two identical page fetches, 39.6 KB each) is genuinely gone. Raised as improvement
  **#10**, not filed as a fault.
- **Two `lfh_guest_settings` calls per minute per open tab** — that is the documented 60-second
  settings backstop, inside the rule.
- **React's dev-only "script tag while rendering" advisory** — unchanged from sweep #6's note.
- **A mistyped address without `/r/` showing the Aevidine 404** — correct per P00404 (an unmatched
  path is not a guest route). Raised as improvement **#9**.

---

## What this run leaves open

| | |
|---|---|
| `⏭` rows still not exercisable | **3** — P00289 (`verify:everything` belongs to the merge terminal), P00372 (no restaurant on this stack uses the dark default), P00419 (no dish-less ACTIVE restaurant) |
| `⏭` closed this run | **1** — P00365, driven against the real printed code `/q/W5QRFWZU` |
| Reported, awaiting the owner's decision | **2** — the chip ink (#12) and the 320px wordmark (#11) |

Improvement ideas are **not** in this file, by the owner's instruction for sweep #7 — they are
printed in the terminal window.

---

# T1 · sweep #8 — the guest menu and its three doors

**Territory:** `app/layout.tsx` · `app/page.tsx` · `app/menu/page.tsx` · `app/not-found.tsx` ·
`app/q/[code]/page.tsx` · `app/r/[restaurant]/menu/page.tsx` ·
`app/r/[restaurant]/menu/not-found.tsx` · `components/MenuView.tsx`

**Branch** `sweep8/t1-guest-menu-and-three-doors` · **worktree** `~/Documents/Projects/wt-s8-t1` ·
**port** 4301, serving a PRODUCTION build of this worktree.

| | |
|---|---|
| Existing ledger rows re-run | **555** (548 `T1.md`, 6 `T29.md`, 1 `T14.md`) |
| **Regressions** | **0** |
| New checks written and executed | **524** (`P54701`–`P55224`) |
| Product faults found | **1**, fixed |
| Guard faults found | **3** — two fixed here, one left for its owner |

---

## 1 — A menu with no sections showed no dishes, and blamed a filter · FIXED

**Where:** the guest menu, any door (`/r/<slug>/menu`, `/menu`, `/q/<code>`) — a blank page saying
"No dishes match these filters. Try turning a filter off." above eight grey chips.

The grouped view is built by walking the category list, so an empty category list produces no
groups however many dishes arrived. Reachable two ways: the sections half of the menu read blips
(the two reads run in parallel and only one has to fail), or every category on the menu is
switched off. `lib/menu.ts` deliberately refuses to filter on an empty set for exactly this
reason — "far worse than showing one extra dish" — and `MenuView` then blanked it anyway.

Measured on a production build at 360×780, French House, with the sections half of the reply
emptied and the dishes handed through untouched: **0 tiles drawn, 59 in the payload**, plus the
wrong message and eight placeholder chips that never resolved. After: **59 tiles, no message, no
placeholders, no empty strip**.

Fix: `components/MenuView.tsx` — when there are dishes, no groups and no NARROWING chip on, draw
the dishes flat in the grid a search already uses; and gate the still-loading category arm on
`!loaded`. Guard: `scripts/verify-guest.mjs` `P55217`–`P55219`, static **and** live.

## 2 — `verify:guest` died on a closed restaurant before printing anything · FIXED

Its live half hard-codes `demo-bistro`, which is in maintenance on this stack, so an unguarded
`page.fill("#search-input")` threw and the run exited with a TimeoutError **before the report**.
Reproduced against `origin/main`. Every other live check it had made went unreported with it.
After: the row records a written skip, and the same command reports **119 passed**.

## 3 — `verify:guest` row 261 was red for doing what the owner asked · FIXED

Row 261 matched `history.replaceState` as well as `pushState`. The owner asked on 2026-08-30 for
the table number to leave the address bar, so `MenuView` wipes it with `replaceState` — which adds
no history entry and is the opposite of a back layer. The row had been red on clean `main` ever
since. `pushState` and `popstate` stay banned; a `replaceState` is allowed only where it sits with
the `table` parameter being deleted. Proven by three sabotages, not by reading.

---

## Left for their owners (outside this terminal's eight files)

- **`verify:guest` row 110** is red on clean `main`. It asserts the OLD spelling of the reviews
  gate; `app/item/[slug]/ItemClient.tsx` has replaced it with a stricter one
  (`reviewsCanBeSeen = features.reviews && features.ratings`, resolved through `getFeatures`).
  The dish page is another terminal's territory. (`P55222`)
- **`components/Maintenance.tsx`** prints a restaurant's name markers raw: `alt="Demo *Bistro*"`.
  The asterisks are highlight markers `Header` and `HeroTitle` both strip. Two of nine live
  restaurants carry them; both have a logo today, so only a screen reader hears it — but a
  restaurant with markers and no logo would show them in 40px text. (`P55223`)
- **`scripts/verify-t24b-live.mjs`** drives the app without the `requireUp` preflight, so the
  repo's own PostToolUse hook reports a failure on **every** session's write, repo-wide. (`P55224`)

## Not a finding — recorded so nobody files it again

- Demo Bistro's maintenance screen shows a mark that looks like French House's. It is Demo
  Bistro's OWN uploaded logo (`.maint`, not `.maint-flagship`); the dev fixture was seeded from #1.
- `P00100`'s subject moved: the per-category ink helper left `MenuView` on 2026-08-26 when the
  owner ruled one theme colour. The same WCAG maths now lives in `lib/accent.ts` → `inkOnAccent`.
- All nine live restaurants are set to a LIGHT default, so the dark-default script could only be
  exercised in the negative direction. Flipping one would change a fixture other terminals are
  reading this run.

---

# T1 · SWEEP #8 ROUND 2 — a fresh plan over the same ground (2026-09-02)

Asked for after round 1 was merged and made live: *"plan 500 phases test within your boundaries make
sure it cover everthing within your boundries and test everything again if any error left"*.

**Planned by measuring.** Every const, state, ref, prop and storage key in the nine owned files —
183 distinct named things — cross-referenced against all 1,547 rows already in `T1.md`. **Fifty had
never been named by a single check.** That gap list is the plan.

**464 written, 464 executed, 464 ✅ · 0 ❌.** Not 500: the pre-allocated block `P54701`–`P55700`
had 464 ids left after round 1's 536. Block O was trimmed by four repeats rather than take an id
belonging to another terminal.

Everything from block L onwards was driven against the **live backup site**, after the merge.

## 9 (the other docket) — the CLOSED stamp covered "none" and "not serving" · FIXED

The identical fault to the VOID stamp fixed earlier the same day, on the screen a diner is far MORE
likely to reach: `components/GuestNotFound.tsx`, shown for a wrong or retired restaurant link.
Pinned to the docket's bottom, the stamp covered the value "none" and struck through "not serving".
Found on the **live site**, by pointing the same check at the twin screen. Same fix, same guard —
which now runs on both dockets at two widths.

## 10 — four rules in the 404's stylesheet could never match anything · FIXED

Fifty rules ship with every 404 and not one had ever been checked. Three were left behind when the
toaster's `again` class was replaced by re-keying (the file's own comment says so), and one was an
anchor rule for a control that is a `<button>`. Removed, with the obituary as a source comment
rather than stylesheet bytes. Guard: every rule is now run against the screen it belongs to, and
against the no-JavaScript fallback.

## Already built by other terminals — checked, not assumed

- **Item 7** (`verify-t24b-live.mjs` missing its app-up preflight): fixed on `main` on 2026-09-02.
  The hook noise every session was still seeing came from the SHARED folder sitting 38 commits
  behind; that folder has now been pulled current and the hook is quiet. (`P55233`)
- **Item 4** (the platform's name in a diner's browser tab): `verify:notfound` now asserts a dead
  dish link's tab title is "Menu". (`P55234`)

---

# T1 · SWEEP #8 ROUND 3 — the behaviour, and the failures (2026-09-02)

Block `P97201`–`P98200`, claimed from the registry and **pushed to `main` before a single row was
written**. Rounds 1 and 2 spent T1's own block (536 + 464); the owner said *"yes do it"*.

**Planned on a different axis from either earlier round.** Round 1 invented its checks; round 2
measured the names. Round 3 measured the behaviour: **382 two-way places, 26 failure paths, 91
exits, 346 readable strings** across 2,866 lines — and then **caused** the failures.

**505 written, 505 executed: 504 ✅ · 1 ❌.**

## The one red — CORRECTED: real, but not something a diner can reach

**A half-written percent-escape in a restaurant address gives a bare 500.** Measured on the local
production build AND the live backup site:

    /r/%E0%A4/menu        → HTTP 500, 21 bytes: "Internal Server Error"
    /q/%E0%A4             → HTTP 500
    /r/fr%E0%A4ance/menu  → HTTP 500

Next rejects the malformed escape inside its own request handling, before any of this app's code or
any error boundary runs — **proved** by adding a route-level `error.tsx` and watching the 500 come
back unchanged. So it is not fixable inside this terminal's files.

**BUT THE FIRST WRITE-UP OVERSTATED IT, AND THE CORRECTION MATTERS MORE THAN THE FINDING.** It was
found with a script that issues RAW requests, and reported as "a diner gets a blank error page"
before the browser path had been driven. Driven afterwards, in a real browser at 360×780 against the
live site, every realistic version of it is harmless:

| what a person actually does | what happens |
|---|---|
| mistypes the restaurant name | the friendly "this menu isn't available" screen |
| types it IN CAPITALS | the menu opens normally |
| leaves a space in the address | the friendly screen |
| a stray `%` in the address | **the browser refuses to send it** — they never reach this app |
| a link cut short mid-character | the browser refuses to send it |

So no diner can reach the bare 500. What reaches it is a link-preview fetcher, a crawler or an
uptime check — things that read a status code, not a screen. Downgraded from a guest-facing dead end
to an untidy status code for machines. **Measure the door a person actually walks through.**
(`P97650`)

## Fixed this round

**The closed-restaurant screen used a different apostrophe from the other two dead ends — and the
guard could not see it.** `verify:notfound` has a row for exactly that rule, but
`components/Maintenance.tsx` was not in its file list, and its test looked for a raw `'` between
letters. JSX cannot carry a bare apostrophe in text, so a file that wants the typewriter one writes
`&apos;` — which matched neither side of the test. Both closed; sabotaged two ways.

**Nothing was watching the owner's per-restaurant browse-state rule (I11).** Replacing `sk()` with
`(base) => base` turned NO guard in this repo red. One diner's layout, sort, search, diet and folded
categories would follow them from restaurant to restaurant on the same phone — the bug the scoping
was introduced to fix in July. Two rows added to `verify:guest`; sabotaged three ways.

## What was caused, not read about

Storage that throws on every call · a menu reply that is 500 / 503 / not JSON / the wrong shape /
dishes-with-no-sections / sections-with-no-dishes / empty / cut off · no network at all · a browser
with no `ResizeObserver`, no `Intl.Segmenter`, no `CSS.escape` · twelve corrupt saved values · four
half-written escapes in the address. **Everything held except the one above.**

## A lesson this round paid for

`git checkout --` restores from the index, so a sabotage block **silently throws away uncommitted
work** in any file it touches. It wiped an apostrophe fix that had not been committed yet. Commit
before sabotaging.
