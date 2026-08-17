# T2 improvements — the 3D dish viewer & the dish page

Terminal 2 of 30, sweep #6. 🟢 = built here. 🟡 = listed for the owner, not built.
Checked against `docs/REJECTED-IDEAS.md` and the pre-empt list before writing anything down.

---

## 🟢 BUILT

### I1 — a dropped signal no longer writes a 3D dish off for the life of the tab

`lib/modelLoader.ts`. A model gets two attempts, 6 s apart, and then lands in `failed` — which
nothing ever cleared. So a phone handing over between the restaurant's wi-fi and mobile data inside
those few seconds wrote the dish off **permanently**: the viewer asks `hasFailed()`, switched to "3D
view isn't ready for this dish", and kept saying it long after the connection was perfect again. The
only cure was reloading the page, which a diner has no reason to think of — on the one feature this
product is sold on.

`retryFailedOnReconnect()` revives what the **current page last asked for**, on the three moments a
phone comes back (`online`, `focus`, `visibilitychange`), wired once on the singleton because the
loader outlives every page. The safety is that `stopAll()` — the path a 3D-OFF restaurant takes —
clears the record of asks too, so a restaurant without the feature revives nothing.

Started from the partial work preserved on `fix/guest-experience-t1` and corrected two things in it:
the record of asks is now **bounded** (`MAX_WANTED`, and most-recent-wins) because `prioritize()`
appends once per dish a guest opens and a 200-dish menu would grow it all evening with an O(n) scan
each time; and the throttle is kept, because one phone unlock fires all three events.

**Measured, driving the loader with a stubbed fetch:** two aborts do not write the model off and a
re-queue fetches again (3rd call); two genuine failures do write it off after exactly 2 attempts; an
`online` event then clears it and fetches again; and after `stopAll()` an `online` event fetches
nothing at all. Guarded by `verify:3d-viewer`.

### I2 — the dish page hides the veg/non-veg mark on a single-diet menu, like the grid already does

`app/item/[slug]/ItemClient.tsx`. The rule (owner, 2026-08-12: *"there shouldn't be a non-veg chip …
because it's veg"*) is that on a menu where every dish is on the same side of the line, the mark goes
— marking all 199 dishes green says nothing. `components/MenuView.tsx` has derived that since the day
he said it and passes it to each card as `showDiet`; this page never got it, so a pure-veg restaurant
showed **zero** marks in the grid and **one** the moment you opened any dish. Same derivation, from
the same list, so the two surfaces can only ever agree. Preserved on `fix/guest-experience-t1`; folded
in. Guarded by `verify:3d-viewer`.

### I3 — `verify:slow-load` now guards the slow 3D journey instead of always failing

See finding F9. Not cosmetic: it is the only automated check on what a diner gets when the model is
slow, and it had been red for months for three reasons that were all its own. It now asserts that BACK
works, that the dish and its price are readable, that the overlays arrive on schedule with guest
wording, that the overlay clears itself when the model lands, and that the ready-ticket names the
right dish and leads to the right viewer.

---

## 🟡 NOT BUILT — his call

### J1 — the pinned Add bar also fires on a desktop, where it floats over the description

**Where:** guest → dish page → the floating "₹550 · ADD TO ORDER" bar, on a 1280×800 browser. It
appears centred in the middle of the page and covers two lines of "About this dish".
**What it is:** the bar exists because the real button starts ~880 px down on his phone, so a diner
had to scroll to buy. On a desktop the real button is also below the fold, so the same rule fires —
but there the bar reads as a panel sitting on top of the text rather than a thumb-reachable action.
**If yes:** the bar becomes phone-only (a width test), and the desktop page reads clean.
**If no:** desktop guests keep a floating bar over two lines of description. Nothing breaks.
**Effort:** ~20 minutes. **Risk:** low, but it is a taste call — he asked for the bar, and hiding it
anywhere is narrowing what he asked for, so it should be his decision.

### J2 — `/view/<folder>` with a folder that is not a dish waits 32 seconds before admitting it

**Where:** guest → a 3D link whose model folder has since been renamed, or a mistyped URL. What he'd
see: the full 3D screen, "LOADING 3D MODEL", and a bottom bar reading "— CALORIES — PROTEIN — CARBS
— PRICE" for 32 seconds before it says "3D view unavailable".
**What it is:** the route answers HTTP 200 for any folder name and only the patience timers end it.
**If yes:** the screen says so within a second or two, or answers a real 404.
**If no:** a stale 3D link is a 32-second dead end. It is not reachable from inside the app — every
in-app link is built from a dish that exists — so this only bites a forwarded or bookmarked link.
**Effort:** ~30 minutes. **Risk:** low, but deciding *what* it should say (404 page vs. the friendly
"3D view unavailable" card, which is what a renamed folder deserves) is a product choice.

### J3 — the star picker's tap targets are 36 px, under the 44 px guideline

**Where:** guest → dish page → Customer reviews → the ⭐ Rate tab → the five stars.
**What it is:** each `.sr-toggle` measures 36×36 at 360 px (the row around it is 40×38). Five fit on
one row with 45 px to spare, so there is room to grow them.
**If yes:** slightly fewer mis-taps when someone leaves a rating.
**If no:** nothing breaks — nobody has reported it, and a mis-tap here picks the wrong star, which is
one more tap to correct, not a lost order.
**Effort:** ~15 minutes. **Risk:** low, but the sizes live in `app/globals.css` (another terminal's
file) and the star animation is tuned to those numbers, so it wants a real look rather than a nudge.

### J4 — the favourites coachmark is the one white card on a dark dish page

**Where:** guest → dish page, first visit ever, dark skin → the "Tap the ❤ to save this to your
Favourites" bubble under the heart.
**What it is:** it renders white-on-black text while everything around it is the restaurant's dark
brown. It is perfectly readable — the opposite of the usual complaint — it just does not wear the skin.
**If yes:** the hint matches the page.
**If no:** nothing breaks. It shows once per device, ever.
**Effort:** ~10 minutes. **Risk:** low; `.fav-hint` is in `app/globals.css`, not mine, and a
deliberately high-contrast coachmark is a defensible choice.

### J6 — the "Loading 3D model" caption is hard to read on the 3D screen's near-black canvas

**Where:** guest → dish → View in 3D, while the model is still coming. The small capitalised
"LOADING 3D MODEL" line under the spinner.
**What it is:** the caption uses `--muted`, which measures `rgb(139,105,20)` on the viewer's own
`rgb(10,13,7)` canvas — about **3.7:1** at 11 px, under the 4.5:1 that size needs. `--muted` is fine
everywhere else because everywhere else sits on the page background; the 3D canvas is darker than
`--bg`, and it is the one place this caption appears over it.
**If yes:** the only words on screen during the wait are comfortably readable.
**If no:** they stay dim. Nothing breaks, the spinner still animates, and screen readers get the
text regardless (the loader is `role="status"`).
**Effort:** ~10 minutes. **Risk:** low, but `.inf-loader-label` lives in `app/globals.css` (another
terminal's file) and the same class is used on the dish page, where it is already fine — so it wants
a viewer-scoped override rather than a global colour change, which is a judgement call.

### J5 — a broken 3D dish still has no owner-facing report

**Where:** admin → the problems surface. Backend only today, nothing on screen.
**What it is:** already written down in `components/FoodCard.tsx` and `.claude/REQUESTS.md` — asked
for by the owner on 2026-08-12 (*"whenever the 3-D is not available, it should show me as a problem
also notification"*). The guest half is done (the badge no longer lies); the owner half is a
server-side query over `menu_items` for "ticked 4D, feature on, files missing".
**If yes:** a restaurant learns its 3D dish is broken without a diner having to find it.
**If no:** it stays invisible until someone opens that dish. Nothing breaks.
**Effort:** hours, on the admin side. **Risk:** medium — it is a new screen surface, so it is out of
this terminal's territory and out of the 🟢 rules entirely. Recorded here only so it is not lost.

---

## Deliberately NOT raised

- **Draco compression** — done; in `docs/REJECTED-IDEAS.md`.
- **A ceiling on how many models the menu preloads** — **R28**, rejected by the owner 2026-08-16.
  Not re-offered in any disguise (no cap, no first-N window, no data-saver mode).
- **The heavy tier not being preloaded by `MenuView`** — a deliberate change on 2026-06-25.
- **The greyed "3D preview unavailable" button** on a restaurant that has 3D dishes — deliberate
  (owner, 2026-06-10). Left exactly as it is.
- **The guest menu's unfinished translation** — **R23**, parked by the owner. Not reported.
- **Dark being the default** — his choice, on purpose.
