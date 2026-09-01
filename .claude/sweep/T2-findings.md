# T2 FINDINGS — the 3D dish viewer & the dish page · sweep #7

Terminal 2 of 40. Branch `sweep7/t2-3d-dish-viewer`, worktree `../wt-s7-t2`, dev server port **4202**.
Against `origin/main` **b64951ad**.

**Improvement ideas are NOT in this file.** The owner's instruction for sweep #7 is that they go in
the chat window only. They were printed there, Part A and Part B.

---

## The regression — the most valuable thing this run found

### F1 · `P00649` was ✅ in sweep #6 and is a live fault today — the 3D screen's animation loop never stopped

**Where it lives:** guest → open a dish → **View in 3D** → glance at the model → tap **Back**. Nothing
is visible. What a diner would notice is the phone getting warm and the battery dropping while they
read the rest of the menu.

**Measured on the DISH page, twenty seconds after leaving the 3D screen: six connector-line loops
still running at 360 animation frames a second, forever.** The stack named `_loop` — the 3D viewer's
own hotspot-line tracker. Each frame reads three elements per hotspot out of a document that no
longer contains them.

Two causes:

* `requestRef` remembers only the **latest** frame handle, so the cleanup's single
  `cancelAnimationFrame` stops one chain and one only.
* `handleLoad` scheduled the reveal on an **800 ms timer that nobody cleared**, so leaving inside
  that window *started* a fresh loop after the component had already gone — a chain no live
  component holds a handle to, and which therefore never ends.

**Why sweep #6 measured zero:** it drove one dish→3D→back cycle and waited long enough for the loop
to start while the screen was still mounted, where the single cancel works. The window that leaks is
leaving **1–3.5 s after the model paints** — which is exactly what somebody who glances and taps
Back does.

**Fixed** (item 1). Measured after: 0 frames/s at t+0.5s, +3s, +8s and +20s, across three cycles
leaving at 1.5s, 2.4s and 3.3s — while the loop still runs on the open viewer and the three hotspot
lines still track. Guard: three new checks in `verify:3d-viewer`, proven red on revert.

---

## The other six, in the order they were found

### F2 · "Drag to turn it around" was printed underneath the dish bar — item 2

**Where:** guest → dish → View in 3D → the small pill that appears under the model.
**What he'd see:** the words crossing the dish title, half-legible, looking like a rendering fault.

The pill is pinned at a hardcoded `bottom: 176px` while `#bar` is `bottom: 0` with a content-driven
height. Measured: the bar is 208px tall on a 360×780 phone, so **32 of the pill's 34px sat inside
it**, and `elementFromPoint` at the pill's own centre returned `#bar`. Reproduced on 360×780,
375×667 and 1280×800 — every size, every time, because the pill is only ever shown once the bar is
already up. **The sentence being swallowed is the one the owner asked for on 2026-08-12**, the only
thing that teaches a diner the dish can be spun. It has never been readable on a phone.

Fixed by placing the pill from the bar's real measured height. Guard: `verify:slow-load` Phase C2
measures the overlap in a real browser; proven red on revert.

### F3 · The dish page's main fetch ignored a change of restaurant — item 3

Backend behaviour, nothing on screen today. Both reads are scoped by `restaurantId` but it was not a
dependency. `/r/<a>/item/x` → `/r/<b>/item/x` reconciles the component in place, so it would keep
restaurant A's dish under B's address. **No path inside the product reaches it** — nothing links
between restaurants' dishes — but it is the wrong dependency list, and it was the only lint warning
left on this territory's files.

### F4 · A restaurant closed for maintenance still previewed its dish on WhatsApp — item 4

**Where:** guest → any dish link, forwarded, while the restaurant has Service mode on.
**What he'd see:** opening the link gives the branded "we'll be right back" screen; the same link
pasted into a chat still shows the dish, its photo and its price.

Both doors already close the *page* for Service mode. Neither door's share card checked it — only
the Menu master switch. Sweep #6 closed exactly this hole for the other switch on 2026-08-17 and
left this half open. Fixed on both doors.

### F5 · The dish page paid for review rows it could never show — item 5

**Where:** backend only, nothing on screen — but it is money.

Measured on French House, which has reviews on and ratings off today: **every dish open fetched up
to twenty review rows into a section that renders null.** The fetch was keyed on `features.reviews`
alone; every surface that draws a review needs `features.ratings && features.reviews`. Fixed by
gating on the same pair. Measured after: sakura-sushi (ratings on) still reads once and shows the
area; French House reads zero. The page's whole data footprint drops from 9 distinct reads to 8.

### F6 · The dish page could spin forever with nothing on it and no way out — item 6

**Where:** guest → dish page, on a weak or dropped connection.
**What he'd see:** "PLATING YOUR DISH" and nothing else — measured at 2s, 5s, 10s, 20s and 35s. No
dish, no honest word, no Back and no Try again. The phone's own back gesture was the only escape.

Nothing had a deadline. Both reads carry `.catch()`, which looks safe — but a catch only helps a
request that *fails*, and a request that never settles never rejects. Fixed with an 8-second
deadline and an honest card. A reply that lands later still wins, so the screen heals itself.

### F7 · Both "something went wrong" cards were flush against the side of the phone — item 7

**Where:** guest → dish page → the "Dish not found" screen (and the new one from item 6).
**What he'd see:** the emoji, the heading, the sentence and the Back link all jammed against the
left edge, with no padding and no vertical centring.

Measured: `padding: 70px 0 0`, `align-items: normal`, `justify-content: normal`, heading at **x = 0**
on a 360px phone. The container's `flex flex-col items-center justify-center min-h-screen p-4` is
entirely inert — `#detail-page` is an ID selector in `app/globals.css` and Tailwind 4 puts its
utilities in a layer those author rules outrank. **This has been true since the "Dish not found"
card was written**; it was found by building a sibling of it and looking at the screenshot. Both
cards now share one inline layout object.

---

## 🔗 HANDOFFS — real, and not this territory's files

### H1 · Offline, the dish page freezes on its server-rendered spinner — `public/sw.js` (T4)

**Where:** guest → dish page → reload with no signal.
**What he'd see:** "PLATING YOUR DISH" and nothing else, indefinitely. The guest **menu** survives
the same test and shows the restaurant's branding and categories.

The client JavaScript never boots at all (`__lfh_modelLoader` is undefined), so **no deadline in
`ItemClient` can rescue it** — item 6 fixes the live-page stall, which is a different case. The menu
works because its data comes through `/api/r/<restaurant>/menu-data`, which `public/sw.js` →
`DATA_PATHS` caches; **this page's reads go straight to Supabase, and every `DATA_PATHS` pattern is
an `/api/…` one**, so the service worker never sees them.

**The exact change needed:** either teach `DATA_PATHS` about the guest's direct Supabase reads, or
route the dish page's reads through an `/api/r/...` endpoint the way the menu's are. Rows `P15932`
and `P15933` stay ❌ until one of those happens.

### H2 · A capitalised tenant URL still splits the cart and the favourites — `lib/tenantStorage.ts`

Unchanged from sweep #6 (`P00852`, still ❌). `/r/French-House/...` writes
`lfh-favorites:French-House` while `/r/french-house/...` writes `lfh-favorites:french-house`. The
prop fix landed in sweep #6; the storage key never did. Fixing only favourites from here would leave
the cart split, so it belongs in one place: `lib/tenantStorage.ts`.

### H3 · `verify:offline` is still hard-pinned to port 4000 — `scripts/verify-offline.mjs` (T28)

Unchanged from sweep #6. It ignores `--base`, `LFH_BASE`, `VERIFY_BASE` and `BASE_URL`, so a sweep
terminal — which may not use the owner's own window — cannot run it. Rows `P00697` and `P00813`
stay ⏭ because of it.

### H4 · The category list is read twice per dish open — `lib/menu.ts` (T25)

Not filed as a fault, recorded so it is not rediscovered. Measured on one dish open: `categories
select=slug` appears **4×** where every other read appears 2× — and the 2× is React Strict Mode's
development double-invoke, so this is **two distinct callers** each running twice. One read would do.
Small, and outside this territory.

---

## What did NOT come back, and what stayed skipped

* **Four rows stopped being skipped.** `P00679`, `P00704`, `P00863`, `P00864` — sweep #6 could not
  drive the non-#1 white-label path on `/view` because no second restaurant has a 3D dish. That
  reason was too strong: the accent, the dish name, the price and the Back link are all resolved
  from `?r=` *before* any model work. Driven on sakura-sushi: `--accent #db2777`, "Salmon Nigiri",
  ₹249, Back into Sakura, tab title "3D View — Sakura Sushi".
* **Eleven rows are still ⏭**, every reason re-checked this run rather than copied forward: four
  would write to the shared dev database mid-sweep, three have no fixture on this stack, two are
  blocked by H3, and two are deliberate non-actions (`verify:everything` belongs to the merge
  terminal; the dev server is stopped at hand-off).
* **Two things changed underneath this territory and neither is a code fault.** French House now has
  the ratings switch **off**, so its review area correctly renders nothing — the star rows were
  re-run on sakura-sushi rather than flipping a shared switch. And `app/globals.css` moved by 77
  lines under other terminals; every class this territory depends on was re-grepped and all are
  present.

## One measurement trap worth passing on

A hit-test on a **dev server** can be blocked by `nextjs-portal`, Next's own development overlay,
which never ships. Two of seventeen sample points across the 3D Add button "failed" for that reason
alone (`P00580`). Discount it before believing a coverage finding.

## The guards this run leaves behind

| guard | what it now covers |
|---|---|
| `verify:3d-viewer` | +13 checks: the animation loop's early return and its mount flag, the model effect's timer collection (item 1), both doors' Service-mode share card (item 4), the review fetch gate **and** its display condition (item 5), the read deadline and its four properties (item 6), both error cards' inline layout (item 7) |
| `verify:slow-load` | +Phase C2: the hint pill's overlap with the dish bar, measured in a real browser (item 2) |

Every one was **proven to turn red** with its fix reverted, and green with it restored. Two of them
had to be hardened while proving them: the Service-mode check matched its own explanatory comment
until it stripped comments first, and item 3's check asserted the dependency list too literally and
turned red on item 6's legitimate extra dependency.

---

# ROUND 2 — the seven decisions the owner picked (2026-09-01)

He answered T2's report with items **8, 9, 10, 11, 12** to do, **14** left to my judgment, **13**
declined, and **15** held back until he gives permission.

**Three of the seven were already built.** Reporting that honestly is the whole value of this
round: two were already solved at a LOWER level than the report understood, and one had been fixed
by another terminal after the report was written. Building them would have left two mechanisms
doing one job, which `CLAUDE.md`'s *"a new way replaces the old one"* bans outright.

| item | outcome |
|---|---|
| 8 · quiet retry before showing the error | **ALREADY HANDLED — I built it and then deleted it.** `lib/supabase.ts` already puts a 15-second deadline on every browser read, and the page already recovers on its own: measured WITHOUT my change, the dish arrives by itself at 17.2s; WITH it, 16.1s. One second, for extra requests. My first attempt was also genuinely worse — 15 attempts in 75 seconds and still climbing, the fast-retry-while-reads-fail the busy rules ban. |
| 9 · send the dish down with the page | **BUILT.** No spinner, browser dish-reads 2 → 0, and an offline reload now shows the dish. Four faults found on the way — see below. |
| 10 · tell a restaurant its 3D dish is broken | **ALREADY BUILT** by T17 on 2026-08-27: admin → System health → "3D dishes", plus `broken3d` in `/api/admin/health`, capped at 200, `null` for unreadable rather than a reassuring zero. I proved it CATCHES one, which it had never been shown to do. |
| 11 · a visible offline warning | **HALF ALREADY BUILT, HALF BUILT.** The existing bar works when the signal drops on an open page. It cannot work after a reload with no signal, because the client JavaScript never boots at all. Added a no-framework bar for exactly that case. |
| 12 · the category list read twice | **BUILT**, and deliberately WITHOUT the cache the obvious fix would have used. |
| 13 · a second restaurant with a 3D dish | **DECLINED by the owner.** |
| 14 · the capitalised link that splits the basket | **ALREADY FIXED** by T1 on 2026-08-17. Proven by landing straight on a capitalised dish link: one folded key, heart still on at the lower-case address. **This closes handoff H2.** |
| 15 · `verify:offline` pinned to port 4000 | **NOT AUTHORISED YET** — *"you can do 15 once I give you permission"*. `P00697` and `P00813` stay ⏭. |

## The four faults item 9 caused, all found by measuring rather than by reading

Item 9 is the reason this round is worth reading. Rendering the dish on the server is plainly
right — and it made four things visible or wrong that the spinner had been hiding:

1. **`$550` on a rupee menu.** Every price falls back to `$` while the currency state is null. That
   was invisible behind the spinner; it became the first thing on screen, and PERMANENT on an
   offline reload where React never boots to correct it.
2. **Reviews read again on a ratings-off restaurant** — the exact fault item 5 had fixed two
   commits earlier. Handing the dish down means `item` is set on render one, when `useFeatures()`
   still returns the code defaults with ratings and reviews both on.
3. **A five-star row in French House's own HTML**, on a restaurant that has ratings switched off,
   because the server built the page with those same defaults.
4. **Both dish routes went blank** when I tried to fix (3) by exporting a helper from
   `lib/features.ts` — that file imports `useEffect`, so a server component cannot import from it
   at all.

## Four of my own guards went stale in one afternoon

`verify:3d-viewer` turned red four times on correct code, because I had written the checks against
a literal shape instead of the behaviour: the 404 check pinned one spelling of a read, the
honest-card check compared against the first `if (!item)` anywhere in the file, and the reviews
check pinned a condition item 9 strengthened. All three rewritten to assert what must be TRUE. This
is the "stale expectation" pattern `LEDGER/INDEX.md` predicted T28 would find, arriving on schedule
in my own work.

## What is still open after this round

* **H1 · the guest MENU page offline** — `components/OfflineNoticeStatic.tsx` is written and ready
  to drop into that route, but the route is not this territory's. The dish page and the 3D screen
  are covered.
* **H3 · `verify:offline` is still pinned to port 4000** — held, awaiting his permission (item 15).
* **H4 · nothing.** The category double-read it described is fixed (item 12).
* **H2 · CLOSED** — fixed by T1; `P00852` is now ✅.

## Item 6, honestly

With the server always supplying the dish, item 6's "We couldn't load this dish" card is now
**unreachable on both doors** — which is the point of item 9, not an oversight. The deadline stays
as a bounded safety net for any caller that renders `ItemClient` without `initialItem`, and it costs
nothing: the promise resolves instantly and clears the timer.

---

# THE 5-PHASE LIVE TEST — and a correction to round 2

Run against **https://3-d-backup.vercel.app** after the merge, on his instruction. Five phases
covering the whole territory: the download-once engine, the 3D screen, the dish page, the look, and
the project's own rules. **115 checks, 115 green, 0 faults found.** Five rows came back red and all
five were my own test being wrong — each is written up in the ledger so nobody re-files them.

## ⚠️ THE CORRECTION, which matters more than the greens

Round 2 said, in a commit message and in a report to the owner, that *"after an offline reload the
dish page's client JavaScript never boots"*. **That is true on the dev server and FALSE on the live
site.**

Measured on production, offline, after one warm visit: `--lfh-offbar-h` is `69px`, the model loader
is alive, React's own offline bar renders, and the page is interactive — tapping the photo opened
the lightbox. The freeze exists only under `next dev`, whose chunks the service worker does not
hold. Same class of trap as this ledger's standing pre-empt about the dev server compiling each
route on first hit.

**What it changes, stated plainly:**

* **Item 11's static offline bar is insurance, not a rescue.** On production, React's own bar already
  appears after an offline reload. The static one refuses to draw whenever React is alive — proven,
  and guarded — so it is not a duplicate, and it does make the dev experience honest. But I sold it
  on a fault that a real diner never met.
* **Item 9 is unaffected.** No spinner, one fewer browser read, the dish in the server HTML: all
  three verified on the live site. Its value never depended on the offline claim.
* The honest description of the dish page offline is: **it already worked on production**, and item 9
  makes it arrive sooner and cost less.

I would rather correct this in writing than leave a commit message overstating what was wrong.

## What the live test confirmed about the seven sweep fixes

| fix | verified on the live site |
|---|---|
| 1 · the animation loop | 0 animation frames a second remain after three look-and-leave cycles |
| 2 · the hint pill | "Drag to turn it around" clears the dish bar — overlap 0, and the point at its centre belongs to the model canvas |
| 3 · the fetch's dependency | backend only; asserted by guard |
| 4 · the maintenance share card | asserted by guard on both doors |
| 5 · the review rows | 0 review reads on a ratings-off restaurant; 1 on a ratings-on one |
| 6 · the read deadline | now a bounded safety net — see the note on item 9 |
| 7 · the error cards | centred, both skins, all three sizes |
| 9 · the server-rendered dish | no spinner, ₹550 not $550, 1 browser dish read → 0, ratings-off respected in the HTML |
| 11 · the offline bar | exactly one bar in all four states across both screens — never two |
| 12 · the category read | 1 read per dish open, not 2 |

**One dish open on the live site now costs six browser reads** — guest settings, categories, the dish
row, its rating, the ban check and the device greeting — and nothing polls in the fifteen seconds
after it settles.

## Still open

* **H1 · the guest MENU page's offline warning** — retested on live and it DOES show React's bar, so
  this is no longer a fault, only a missing belt-and-braces. `components/OfflineNoticeStatic.tsx` is
  there if that route's owner wants it. Downgraded from a handoff to a note.
* **H3 · `verify:offline` pinned to port 4000** — held, awaiting the owner's permission (item 15).
