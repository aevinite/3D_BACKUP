# T2 findings — the 3D dish viewer & the dish page

Terminal 2 of 30, sweep #6. Ledger: `.claude/sweep/LEDGER/T2.md` (P00501–P01000).
Every row below passed the four-test gate in §5 of the sweep rules before a line of code moved.
All measurements are from headless Chromium on **port 4102** against the dev stack, at Samsung A35
(360×780, dpr 3) unless stated.

---

## F1 — HIGH · the BACK button on the 3D screen was dead while the model loaded · **FIXED** · confirmed

- **Where:** guest menu → any dish with a 3D model → **View in 3D**. What he'd see: the loading
  screen with BACK and AR VIEW drawn at the top, and tapping BACK does nothing at all.
- **Who is worse off:** a diner on weak restaurant wi-fi who opens a 3D dish and changes their
  mind. They tap BACK, twice, three times, and the app ignores them. Only the phone's own back
  gesture gets them out — and inside a saved-to-home-screen menu there is no browser chrome either.
- **How it happens:** `.viewer-wrapper #load` is `position:fixed; inset:0` with an **opaque**
  background and `z-index:100` (`app/globals.css`), while `#topbar` and `#bar` are both
  `z-index:30`. So the loading panel covers the whole screen, chrome included, for as long as the
  model is downloading — up to the 15 s point where the "still preparing" card takes over (that
  card does offer a Go-back button, so the trap ends there).
- **Measured:** `document.elementFromPoint` at the BACK button's centre returned `#load`; a real
  `page.tap("a.back-btn")` timed out and the address never changed.
- **Fix:** `app/view/[folder]/ViewerClient.tsx` — the loading panel is rendered with an inline
  `zIndex: 20`, above the model canvas and below the two chrome bars. Inline because the stylesheet
  is another terminal's file; if that rule is ever corrected at source this line becomes redundant
  rather than wrong.
- **Guarded by:** `verify:3d-viewer` (source) **and** `verify:slow-load` Phase A (a live hit-test).
  Reverting the fix turns both red — verified.

## F2 — HIGH · adding a dish from the 3D screen skipped the "you must be at a table" gate · **FIXED** · confirmed

- **Where:** guest menu → dish → View in 3D → the bottom bar's **Add to order**. What he'd see:
  with dining sessions on, a guest who has not joined a table gets the dish accepted anyway; the
  join flow never opens.
- **Who is worse off:** the restaurant and the diner both. The rule (owner, 2026-06-11) is that
  while dining sessions are ON a dish can only join the cart once the guest is an approved member
  of an open session. Every other Add path asks — `components/FoodCard.tsx`,
  `app/item/[slug]/ItemClient.tsx`, `components/CartPanel.tsx` — the 3D screen was the only one
  that did not. So the guest is only told the rule at Place Order, which is the exact complaint the
  sold-out hole in this same file was fixed for.
- **How it happens:** `ViewerClient.addToOrder` dispatched `lfh:open-order-confirm` directly
  instead of going through `gateAddToCart(...)`.
- **Measured:** grep of every `gateAddToCart` call site — three of the four Add paths, not this one.
  After the fix, tapping Add to order on the 3D screen opens the session join overlay (`sg-overlay`)
  instead of dropping the dish straight into the cart.
- **Fix:** `app/view/[folder]/ViewerClient.tsx` — wrap the dispatch in `gateAddToCart(...)`, exactly
  as `ItemClient.addToCart` does. The gate either adds now or holds the add and replays it the
  moment the guest is connected.
- **Guarded by:** `verify:3d-viewer`.

## F3 — MEDIUM · a slow model hid the dish, the price and the Add button behind an opaque spinner · **FIXED** · confirmed

- **Where:** guest menu → dish → View in 3D, on a slow connection. What he'd see: a black screen
  with a spinner and the words "LOADING 3D MODEL", and nothing else, for up to 15 seconds.
- **Who is worse off:** a diner on restaurant wi-fi. The dish's name, description, calories and
  price were all already fetched and sitting in memory, and the Add button was ready — all of it
  hidden behind the same opaque panel as F1.
- **Measured, with the model file held open:** `#bar` sat at `top: 801` on a 780 px-tall phone
  (fully off screen) for the whole 15 s, until the "still preparing" card replaced the screen.
- **Fix:** `app/view/[folder]/ViewerClient.tsx` — `SLOW_BAR_GRACE_MS` (2.5 s). Once the dish's own
  details are known and the model has *not* arrived, the bar slides in anyway. On a normal load the
  model paints first and `handleLoad`'s existing 1 s delay still owns the choreography, so the
  cinematic is untouched; the timer checks `modelSeenRef` and does nothing. Also: the "Drag to turn
  it around" hint now waits for the model as well as the bar, so the app never invites a diner to
  drag something that is not on screen yet.
- **Guarded by:** `verify:slow-load` Phase A2 — it asserts the name, the price and a reachable,
  enabled Add button while the model is held open.

## F4 — MEDIUM · the "your 3D is ready" notification named the wrong dish · **FIXED** · confirmed

- **Where:** guest — the café-ticket notification that arrives after you leave a 3D dish whose
  model had not finished. What he'd see: a ticket reading "**Croissant Sandwich** in 3D · ready to
  view" after tapping View in 3D on **Avocado & Cream Cheese**.
- **Who is worse off:** any diner whose model was not ready when they tapped. They are invited back
  to a dish they never asked about, and tapping the ticket opens a dish whose name does not match
  the ticket.
- **How it happens:** the watchlist entry was titled `config.title || folder` — `config.title` is
  the **static** `/content/items/<folder>/config.json` name, which belongs to restaurant #1's
  flagship folder, not to the dish on screen (two dishes share the "Croissant" folder). Worse for
  everyone else: no other restaurant ships a static config at all, so `config.title` is undefined
  and the fallback handed the diner the raw **model-folder slug** as a dish name.
- **Measured:** the exact ticket above, captured from the `lfh:toast` payload and from the DOM.
- **Fix:** `app/view/[folder]/ViewerClient.tsx` — `menuItem?.title || config.title || folder`, the
  same order the bottom bar's title and the viewer's `alt` text already use, with `menuItem?.title`
  added to the effect's deps so the entry is rewritten when the live name resolves.
- **Guarded by:** `verify:3d-viewer` (source) and `verify:slow-load` Phase D, which now fails if the
  ticket's text does not contain the dish page's own title.

## F5 — MEDIUM · the `<model-viewer>` script was downloaded twice on every first 3D open · **FIXED** · confirmed

- **Where:** backend only, nothing on screen — but a diner feels it as a slower first 3D open and
  247 KB more of their mobile data.
- **Who is worse off:** every guest opening a 3D dish for the first time in a session.
- **How it happens:** Next emits a `<link rel="preload" as="script">` beside the `<Script>`. A
  `<script type="module">` is always fetched in CORS mode; a preload with no `crossorigin` is not,
  so the two disagree on credentials mode, the preloaded copy is thrown away, and the file is
  fetched again. Chrome says so itself: *"the request credentials mode does not match"* and
  *"preloaded using link preload but not used"*.
- **Measured:** two 200 responses, **253,368 bytes each**, for one file. After the fix: one.
- **Fix:** `components/PublicModelViewer.tsx` — `crossOrigin="anonymous"` on the `<Script>`.
- **Guarded by:** `verify:3d-viewer`.

## F6 — MEDIUM · Service (maintenance) mode did not close the dish page · **FIXED** · code-read

- **Where:** guest — `/r/<slug>/item/<dish>` and `/item/<dish>`. What he'd see: with the restaurant
  switched to maintenance, the menu says "we'll be right back" and the 3D screen says "not
  available", but a direct dish link still shows the photo, the price and a working Add to Cart.
- **Who is worse off:** the restaurant. It turned itself off and guests can still order.
- **How it happens:** *"Service mode replaces the whole menu with the maintenance screen"* — but
  that swap lives in `components/AppShell.tsx`, and both dish pages render `ItemClient` **without**
  AppShell. The 3D screen closed this exact hole on 2026-08-04 with a comment naming both switches;
  the dish pages only ever got the Menu master switch.
- **Fix:** both `app/item/[slug]/page.tsx` and `app/r/[restaurant]/item/[slug]/page.tsx` now render
  the same branded `<Maintenance>` screen the menu shows — the restaurant's own name and logo, never
  the flagship's, and not a bare 404, which would be harsher than what the menu says.
- **Why code-read and not confirmed:** proving it live means flipping French House's `service_mode`
  on the shared dev database while twenty-nine other sweep terminals are driving it. The sweep rules
  warn about exactly that ("a guard once died with a restaurant's Menu switch off and real scans got
  a 404 for an hour"). The branch is asserted statically instead, and `npm run typecheck` proves the
  screen's props are right. **Manual check for the next sweep:** switch French House to Service mode
  in the editor's General tab, open a dish URL directly, expect the maintenance screen, switch back.
- **Guarded by:** `verify:3d-viewer`, for both doors.

## F7 — LOW · a shared dish link previewed as open while the menu was switched off · **FIXED** · code-read

- **Where:** guest — the link preview card when a dish URL is forwarded (WhatsApp, iMessage, a
  social post). What he'd see: the dish, its photo and its price, for a menu that answers 404.
- **How it happens:** the page `notFound()`s, but `generateMetadata` ran ahead of that gate and
  returned the dish's title, description and image regardless.
- **Fix:** both doors' `generateMetadata` now return a neutral "Menu / This menu isn't available
  right now" when the restaurant is inactive or its Menu master switch is off. Both reads are the
  cached ones the page already makes. (The tenant half of this was preserved on
  `fix/guest-experience-t1`; folded in and extended to restaurant #1's door, which it had missed.)
- **Guarded by:** `verify:3d-viewer`, for both doors.

## F8 — LOW · a 3D link opened cold put the diner's dish in the wrong restaurant's basket · **FIXED** · confirmed

- **Where:** guest — a `/view/<folder>?r=<slug>` link opened in a fresh tab (forwarded to a friend,
  bookmarked, or "open in new tab"), for any restaurant other than French House. What he'd see: tap
  Add to order, tap BACK to that restaurant's menu, and the cart is empty.
- **How it happens:** `/view` has no `/r/<slug>` in its path, so `lib/tenantStorage.ts`'s
  `tenantSlug()` falls back to "the slug this tab last visited", held in the `lfh_tab_tenant`
  sessionStorage key. Arriving from the menu sets it on the way through; a cold open has no such
  history, so every tenant-scoped key — the cart included — resolved to restaurant #1.
- **Measured:** `sessionStorage.lfh_tab_tenant` is `null` on a cold `/view`, and correctly
  `"sakura-sushi"` after visiting that restaurant's menu first.
- **Fix:** `app/view/[folder]/ViewerClient.tsx` records the tab's restaurant the moment `?r=`
  resolves to a real, live one — and only then, so an unknown slug cannot overwrite a tab's genuine
  history. The key name belongs to `lib/tenantStorage.ts`; the guard fails if the two literals drift.
- **Guarded by:** `verify:3d-viewer` (it reads `LAST_SLUG_KEY` out of `lib/tenantStorage.ts` and
  compares).
- **Still owed, and not mine to write** — see HANDOFF H1.

## F9 — the guard my own prompt names had been FAILING for months · **FIXED** · confirmed

`npm run verify:slow-load` — one of the four guards this terminal was told to keep green — was dead
three separate ways on `origin/main`, all of them the guard's fault rather than the app's:

1. it waited **10 s** for the "Still preparing" overlay, which had been moved to **15 s** ("6 s was
   too eager and looked like a failure", `ViewerClient`) — so the wait could never succeed;
2. it asked `globalThis.__lfh_modelWatchlist.has("MP")`, and `ModelWatchlist` has **never** had a
   `has()` method — that assertion was hard-coded to `false`;
3. it drove `/view/MP?from=gourmet-burger`, and neither exists any more — the folder is `Croissant`
   and the dish slug answers **404**.

A guard that always says FAIL is worse than one that is skipped: people learn to ignore it. Rebuilt
against reality — the 3D dish is discovered from the grid's own `is-4d` marker instead of hardcoded,
the timings mirror the screen's, the private-API probe is replaced by observing the ticket a guest
actually gets, and F1/F3/F4 are now covered by live assertions. It passes, and reverting F1 turns it
red — verified both ways.

---

## 🔗 HANDOFF rows — the fix lives in another terminal's file

### H1 — `lib/restaurant-context.tsx` · the global guest widgets think `/view` is restaurant #1

`RestaurantProvider` derives the active restaurant from the **pathname** only
(`/^\/r\/([^/]+)/`), so on `/view/<folder>?r=<slug>` it resolves to `DEFAULT_RESTAURANT_ID`. Every
body-level widget that reads `useRestaurantId()` therefore asks about the wrong restaurant while a
guest is on the 3D screen — including `components/OrderConfirmModal.tsx`, which uses it for
`useFeatures()` and so gates its allergy block on **restaurant #1's** switch when confirming another
restaurant's dish.
**Exact change needed:** in `RestaurantProvider`, when the pathname has no `/r/<slug>` segment, fall
back to the `?r=` search param before falling back to `DEFAULT_RESTAURANT_SLUG` — the same precedence
`ViewerClient` already uses. F8 fixes the storage half of this from my side; this is the context half.

### H2 — `app/globals.css` · `.viewer-wrapper #load` should sit under the chrome at source

F1 is fixed with an inline `zIndex` because the stylesheet is not mine. The tidy version is
`z-index: 20` on the `.viewer-wrapper #load` rule (currently `100`), after which the inline style in
`ViewerClient` is redundant. Do **not** remove the inline style without making that change in the
same commit — `verify:3d-viewer` and `verify:slow-load` both check it.

### H5 — `lib/tenantStorage.ts` · a capitalised tenant URL gets its OWN cart and favourites · confirmed

**Where:** guest → any `/r/<Slug>/...` page reached with different casing from last time. What he'd
see: a diner adds two dishes, comes back through a link with a capital letter, and the cart is empty.
**Measured:** hearting a dish at `/r/French-House/item/...` wrote `lfh-favorites:French-House`, while
the same dish at `/r/french-house/...` writes `lfh-favorites:french-house`. Both URLs resolve — the
page renders and answers 200 — so the two are the same restaurant with two separate baskets. The same
split hits every tenant-scoped key: the cart, the session, the table, the active-orders list.
**Why this is a fault and not a quirk:** the dish page's own comment states the intended rule —
*"this prop namespaces the cart/favourites and builds the back-to-menu link, so a capitalised URL
must land in the SAME scope as the lower-case one (owner, 2026-08-12)"*. That fix was applied to the
**prop** (`restaurantSlug={r.slug}`), but `tget`/`tset` do not use the prop: they go through
`tkey()` → `tenantSlug()`, which reads the raw path segment. So the rule he asked for holds for the
links and not for the storage.
**Exact change needed:** in `lib/tenantStorage.ts` → `tenantSlug()`, normalise the captured segment
(`decodeURIComponent(m[1]).toLowerCase()`) before returning and before writing `LAST_SLUG_KEY`. Slugs
are lower-case in the database and `getRestaurantBySlug` already resolves either casing, so this only
makes the key agree with the row. `lib/restaurant-context.tsx` derives its slug the same way and
wants the same one-line change (lines 56 and 67), which also settles half of H1.
**Not fixed here** because a partial fix would be worse: I could normalise the favourites read in
`ItemClient`, but the cart is written by `components/OrderConfirmModal.tsx` and read by
`components/CartPanel.tsx` — neither is mine — so favourites and the cart would then disagree.

### H4 — `scripts/verify-offline.mjs` is pinned to port 4000, so no parallel session can run it

It ignores `--base`, `LFH_BASE`, `VERIFY_BASE` and `BASE_URL` and always probes
`http://localhost:4000` — the owner's own window, which a sweep terminal is forbidden to use. It
therefore cannot run in any worktree, in CI, or alongside another session; the offline phases in my
ledger are marked `⏭` for exactly this reason. Every other guard here already accepts `--base`
through the shared `scripts/sweep/appUp.mjs` helper (`baseFrom(argv)`); this one just needs the same
three lines. Same disease as F9, one step earlier: a guard nobody can run is a guard nobody runs.

### ~~H3~~ — WITHDRAWN: the owner asked for this on 2026-08-17 and it turned out to be fixable
### from inside this territory after all. Built as improvement **I4** — both button rows now sit at
### `z-index: 50`, above the strips. No stylesheet change needed. Original write-up below.

### H3 (original) — `app/globals.css` · `.dish-nav-strip.next` covers the right 8 px of Add to Cart on a phone

**Where:** guest → dish page → the real "Add to Cart" button in the button row (not the pinned bar).
At 360 px the button spans x 28→332 and the fixed next-dish strip starts at x 324 with
`pointer-events: auto` and `z-index: 49`, so a tap on the button's rightmost 8 px navigates to the
next dish instead of adding the dish. Measured with a point-by-point walk across the button: the last
two of 76 sample points belong to the strip. Desktop is unaffected (the strip sits at x 1244, the
button ends at 992), and the **pinned** add bar is clean (0 of 64 points covered).
**Exact change needed:** stop the strips overlapping the button row — e.g. end the strip above it, or
give the strips `pointer-events: none` with an inner hit area narrower than the page gutter. Small
and low severity: 8 px of 304, at the very edge, with an uncovered pinned bar one scroll away. Left
alone rather than reaching into a stylesheet I do not own.
