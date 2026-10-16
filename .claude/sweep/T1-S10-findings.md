# Sweep #10 · Terminal 1 · the guest menu and its three doors — findings

Ledger: `.claude/sweep/LEDGER/T1-S10.md` (524 new rows, P170001–P170526 with two guard ids added late) · re-runs stamped in
`T1.md` and 15 other ledgers (3,470 rows).

## Part 1 — problems found and fixed (7)

1. **REGRESSION — the "more this way" fades vanished after a search.** Guest menu → the filter chips row and the search
   suggestions at 360px: after a one-letter or pasted search the right-edge fade (the cue that the row scrolls) was gone.
   Broke 2026-09-17 when the screen started drawing from a deferred copy of the search text and the two cue effects kept
   listening to the typed copy. Fix: they listen to the deferred copy. `components/MenuView.tsx`. Guard P170001–P170003.
2. **A menu link with a stray space was a dead end that looped to itself.** `/r/french-house%20/menu` said "That table
   doesn't exist" and its button led back to the same screen; a null byte in the address gave the error screen.
   `lib/tenant.ts` now reads the address the way the menu API does and refuses an impossible one before the database.
   Guard P170004–P170007, P170012–P170013.
3. **The veg/non-veg mark was silent to a screen reader on every card** (hidden wrapper). `components/FoodCard.tsx`.
   Guard P170008–P170009.
4. **Two 3D dish cards read an icon-font glyph inside their spoken name.** `components/FoodCard.tsx`. Guard P170010–P170011.
5. **Both error screens painted their "Try again" button in restaurant #1's gold** (#d4a574) on every restaurant.
   `app/error.tsx` now uses the device's own system colours, `app/global-error.tsx` light-on-dark. Guard P170014.
6. **With the search switch off, a remembered search kept filtering** — a French House guest was stuck on 6 "coffee"
   dishes with no box, no ✕, no sections. `components/MenuView.tsx`. Guard P170015 (+ live row P170520).
7. **The currency list read "AED AED", "SAR SAR", "QAR QAR"** on the six restaurants that offer them (on screen and aloud).
   `components/Header.tsx` draws a sign only when it differs from the code. Guard P170525 (static) + P170526 (live).

## Part 2 — problems found and NOT fixed

NONE.

## Part 3 — earlier sweeps' improvement ideas on these files

- `T2-improvements.md` I2 (the dish page hides the veg mark on a one-diet menu) — **ALREADY BUILT** (`ItemClient.tsx` `showDiet`).
- `T2-improvements.md` J5 (an owner-facing report of broken 3D dishes) — **ALREADY BUILT** as a list on the admin's System
  health (`app/api/admin/health` → `broken3d`), deliberately not a phone alert.

## Part 4 — improvements (listed, not built)

🟡 A. Restaurant colours can clash for an owner with 4+ restaurants (`lib/restaurantColor.ts` picks from 10 colours by hash:
   ~50% chance two of four share one). Owner console → dashboard charts and "My restaurants". Today's real estates: 7 of 7 distinct.
🟡 B. The dark first frame for staff panels (the 2026-07-26 "white wide screen" fix in `app/layout.tsx`) covers `/kitchen`,
   `/manager`… but not `/editor` or a restaurant's own `/r/<slug>/kitchen|manager|tablet|login`. Read from code, not driven
   (needs a staff sign-in); those panels default to a light skin, so which first frame is right is the owner's call.
🟢 C. Two comments say the opposite of the code (`app/q/[code]/page.tsx` "absolute, from the host" — it is a plain path;
   `lib/menuDataServer.ts` "after 120s" — it is 24 h). `components/GuestChrome.tsx` lists a `pair` route that does not
   exist; `app/menu/page.tsx` keeps its own copy of `queryStringOf`.
🟢 D. Two checks that live only in this sweep's harness belong in `verify:guest`: the bell never fades or stops taking a tap
   while scrolling (R29's guard is static only), and a printed code for a switched-off restaurant is refused.

Deliberately NOT raised: the dead-end and error screens being English-only (R23), calming the floating dots for "reduce
motion" (R69's spirit), `select("*")` on the dish page's one row (documented, R64), capping 3D preload (R28).
