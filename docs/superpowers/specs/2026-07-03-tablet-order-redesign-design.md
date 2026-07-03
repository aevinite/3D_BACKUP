# Tablet "Take Order" redesign — approved design (2026-07-03)

## What the owner asked for
Browse dishes like the guest menu: **all categories always visible** in one list, tapping a
category **jumps** to it instantly, and the highlight **follows the scroll** (scroll-spy).
After reviewing 3 mockup options (`docs/TABLET-ORDER-REDESIGN.html`) the owner approved the
scroll-spy browsing but **rejected the floating cart bar / bottom sheet**: the "This order"
cart stays exactly as it was, permanently visible, in its **own separate scroll region** —
one scroll for the dish browser, one for the cart.

## The design (as built)
- **Full-screen takeover.** Tapping "＋ Take order" (or "+ Add dish" on an existing order)
  hides the floor + topbar and gives the order screen the whole viewport (`body.om-mode`).
  Exiting (← back / ✓ Done / hardware back / send) restores the normal panel; the cleanup
  lives at the top of `renderPanel()` so no exit path can leak the takeover class.
- **Wide screens (>760px), 3 panes:** category rail LEFT (`.om-nav`, vertical) · all-category
  dish sections MIDDLE (`.om-scroll`, own scroll, sticky section headers) · the unchanged
  `.cart` markup RIGHT inside `.om-cart` (own scroll, SEND always reachable).
- **Phones (≤760px):** same DOM, one breakpoint — the rail becomes a sticky chip row, the
  cart docks below the browser capped at 44dvh, still its own scroll. Search input wraps to
  its own row.
- **Jump + spy:** tapping a rail/chip item smooth-scrolls its section into view (spy muted
  700ms so the highlight doesn't flicker through passed categories); scrolling computes the
  active section from `offsetTop`s in a rAF handler and follows.
- **Search** collapses sections into one flat "Search results" list (nav hidden); clearing
  restores the sections at the previous browse spot.
- **Scroll preservation:** adding a dish patches badges + cart pane in place (no grid
  rebuild); the options-screen round trip and add-to-order reload restore `state._omTop`.
- **Unchanged:** dish tap-to-add, options/size/extras screen, per-item allergy+note, cart
  line editing, order note, whole-order allergies, confirm dialog, `sendOrder`, all API
  calls. Zero backend / zero egress change — purely how the already-loaded dishes are painted.
- **Back button:** `backstack.js` now loads in the tablet panel; order mode registers a
  `tablet-order` layer, so hardware back closes it (then the panel, then leaves).

## Also in this branch — "make every panel responsive" (same owner request)
Audit of all panels at 390px found `/aevinite` DEGRADED (one UNUSABLE card) and small
leftovers elsewhere. Fixed: admin Branding card grid collapse (`adm-grid2`), compact 3-across
phone nav for the shared admin/owner chrome, editor Operations-log phone reflow (parity with
the Customer log), login/staff-login inputs to 16px (iOS focus-zoom). Kitchen, owner,
manager and both login pages otherwise verified fine.

## Verification (done live on the worktree dev server, port 4017)
390px + 1280px, dark + light: takeover, jump, spy, badge/cart in-place updates with scroll
kept, options round-trip, search restore, hardware back (order → panel → leave), floating ✕
hidden while ordering, real order sent end-to-end (table 3, bill #2, dishes visible cooking
on the table detail afterwards). Admin: branding card 1-column with zero overflowing
controls; toggle refactor (`panelToggle`/`staffToggle` render helpers) exercised on/off/on.
`npm run lint`: 0 errors.
