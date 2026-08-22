# T26 — THE LOOK: findings

Sweep #6, terminal 26. Phases P12501–P13000. Branch `sweep6/t26-the-look`, port 4126.
Every ratio below was **measured on the running app**, in both skins, with the rule mounted in
the real cascade — never reasoned from the stylesheet. `confirmed` = watched it happen or read it
off a screenshot; `code-read` = reasoned from the source and verified the same rule live elsewhere.

## The two shapes every one of these turned out to be

1. **A rule asking for a colour token that nothing in THAT DOCUMENT declares**, with a literal
   written beside it as a fallback. The literal then wins in *both* skins, so one skin is stuck
   with a value tuned for the other. Ten of the seventeen. Each panel is its own document, so a
   token in `app/globals.css` does nothing for a panel — that is what makes this invisible.
2. **A per-skin token declared in one skin block and not the other**, so the other skin inherits
   from somewhere it was never meant to. Sharpest version: the guest theme declares `--accent-ink`
   too, so a console block that leaves it out takes a *guest* hue onto a console — that happened
   mid-run in this very session and measured 2.60:1.

Both are now guarded by `npm run verify:look-ink`.

| # | severity | who is worse off | where | measured | state |
|---|---|---|---|---|---|
| 1 | HIGH | the manager, mid-service | manager panel → Tables floor → the ✓ on a tile with a new order | 1.10:1 at rest, 1.43:1 on hover, light skin → **5.56 / 5.00** | fixed · confirmed (screenshot) |
| 2 | MED | every tenant | manager panel → top bar → the restaurant's own name | 2.81:1 light → **5.91** | fixed · confirmed |
| 3 | MED | the manager | manager panel → Tables floor header → the "to pay" count | 3.71:1 light → **5.91** | fixed · confirmed |
| 4 | MED | the waiter | waiter tablet → primary button / chosen category chip / quantity pill | 2.81 light **and** 2.23 dark → **6.51 / 8.21** | fixed · confirmed |
| 5 | MED | the waiter | waiter tablet → dish tile ＋ and ✎, Take-order category heading | 2.09 / 2.76 / 3.13 light → **4.39 / 4.39 / 4.98** | fixed · confirmed |
| 6 | MED | the waiter | waiter tablet → tile "x/y served" + seat count (manager's twins read 6.4) | 3.49 / 3.18 light → **6.43 / 6.40** | fixed · confirmed |
| 7 | MED | the waiter + the kitchen | waiter tablet floor + kitchen board → the first-paint placeholder | a near-BLACK bar on a white tile in the DEFAULT skin | fixed · confirmed on the tablet (screenshot), code-read on the kitchen (identical rule) |
| 8 | MED | the guest | guest menu → the bill → Back bar, tabs, past-order cards, total, place-order footer | 1.09:1 light / 1.49 dark, and the WRONG skin's colour → **1.31 / 1.62**, the house hairline | fixed · confirmed |
| 9 | LOW | the manager | manager panel → Audit & logs → "was the food made?" box; and the ☰ unread dot | each pinned to the opposite skin's red | fixed · confirmed |
| 10 | LOW–MED | the admin + the owner | both consoles, LIGHT skin → active sidebar item, range buttons, panel-letter chips, Active pills, role badges | 3.65–4.25:1 → **4.93–6.64** | fixed · confirmed |
| 11 | MED | the waiter | waiter tablet → an open table's header → "⇄ one party · T11 T12" | an ORANGE found nowhere else on the panel, 1.89:1 light → **5.89 / 7.12**; and the tile's seat count 4.23 dark → **4.74** | fixed · confirmed |
| 12 | LOW | the manager | manager panel → Audit & logs row hover, retention field focus ring; and the Pay button | a literal BLUE on a gold panel; the Pay gold ignored the skin | fixed · confirmed |
| 13 | LOW–MED | the guest, incl. a banned one | guest menu → offline strip edge, "show more orders" dashed edge, the banned-guest card **and its input** | the input's outline was WHITE on a white card | fixed · confirmed |
| 15 | LOW | the manager on a phone | manager panel → Tables floor header, ≤760px | the header sat 2px wider than the screen (nothing lost) | fixed · confirmed |
| 16 | MED | the admin on a phone | `/aevinite` → Dashboard → the "Working now · 3 active" card at 360px | 14px of the card — the View-all link and every staff row's right end — was clipped away with no way to reach it | fixed · confirmed (screenshot) |
| 17 | MED | the manager + the waiter | manager floor → the TABLE NUMBER on a dense tile; the one-party chip; the tab's waiting count; the tablet's filter count | 3.13 / 4.18 / 3.76 / 3.89 → all ≥4.5 | fixed · confirmed |

(14 is the panel-asset cache bump the repo's own guard requires after a stylesheet change — without
it staff browsers keep serving the old CSS and every fix above is invisible.)

## Measured and NOT a finding — recorded so the next sweep does not re-open them

- **The connection pill** reads 3.76–4.37:1 on several light surfaces. It is deliberately guarded at
  ≥3:1 by the project's own `verify:skin-ink`, which passes. Not mine to move.
- **The light consoles' secondary text** (`--muted`, table headers, page sub-lines, the chart-type
  buttons) sits at 4.11–4.25:1 against 4.5. One token per console block would lift all ~30 places at
  once — that repaints every console screen, so it is a 🟡 decision for the owner, not a fix.
- **The admin DARK console's active nav label and panel-letter chip** read 4.14–4.48:1. On a dark
  tint the fix is to *lighten*, and the accent is already the brightest blue in that palette. 🟡.
- **A decorative particle** on the guest menu drifts ~4px past the right edge at 1194px. It is a 5px
  animated dot, carries nothing, and the document does not scroll sideways.
- **`.t-tagbadge`** on the waiter tablet would measure 2.18:1 — but `.tile .t-tagbadge { display:none }`
  hides it everywhere it is rendered, so nobody ever sees it. Dead, not broken.
- **Two duplicate `@keyframes`** in `app/globals.css` (`fadeIn`, `shimmer`) have effectively identical
  bodies and the later `.fade-in` rule is consistent with the later keyframes. Nothing visible.
- **The kitchen board's 761–819px gap** between its phone block and its 820px three-lane board is
  deliberate and documented in the file (three equal lanes below 820 would crush a ticket head).
- **The kitchen top bar's narrow icon buttons under 760px** — recorded rejection R41.
- **The dish page's sticky Add bar** does not collide with anything: on the real dish page it is the
  only docked element (the mini-cart is not rendered there). Checked at 360 and 1280.
- **The mini-cart / order tracker / offline strip stack** never overlaps: with both body flags set and
  a 34px offline strip the tracker sits at 144px and the cart at 18px, all on screen, at 360/1280/1194.
- **`public/panels/tablet/style.css`'s three `-webkit-backdrop-filter` lines** are safe: the panel
  stylesheets are served statically and never go through the Tailwind-4 build that drops the property.
  `app/globals.css`, which does, has none.

## 🔗 HANDOFF — none

Every fix landed inside this terminal's own territory. The three `public/panels/*/index.html` files
are the single exception, and only because `verify:ui` refuses a stylesheet change without the
matching content-hash bump (item 14).
