# T6 — THE KITCHEN SCREEN · improvement ideas

Checked against `docs/REJECTED-IDEAS.md` first — R3 (no collapsing an empty column), R5 (no ageing
signal on the Ready column), R7 (no profile of any kind), R21 (no shared `errText()` here) are all
still honoured and none of them is re-offered below.

## 🟢 Built in this branch

Nothing here that is not already a fix. Every improvement this sweep found either turned out to be
one of the seven problems in `T6-findings.md` (the 44px 🖨 target and the light-skin "served ✓"
started life as improvement ideas and were promoted once measured), or needed a decision the owner
should make — those are below.

The bar for building was: inside the territory, ≤150 lines, no migration, no new screen, module or
permission, not rejected, and it makes a real restaurant's day better. Pure tidying was left alone.

## 🟡 Needs a decision from the owner

### I1 · An older iPad in portrait (768–819px) still gets the two-column board

The lane layout that gives each column its own scroll and pins its heading starts at **820px** —
chosen deliberately, because three lanes below that are ~230px each and crush a ticket head. Below
it the board falls back to `auto-fit, minmax(300px, 1fr)`, which at 768px gives **two** columns, so
✅ Ready wraps onto a second row underneath a tall Cooking column and goes off the bottom.
Measured at 768×1024. 768px is a real kitchen screen (iPad 9.7"/mini in portrait); 810px (iPad
10.2") is in the same band. The band also keeps all nine top-bar controls with their words, because
the ⋯ menu is phone-only (≤760px).

Three ways out, all with a cost: drop the lane layout to ~768px and accept narrower lanes; extend
the ⋯ menu up to 819px and keep two columns; or leave it, on the grounds that a kitchen screen
should be landscape anyway. It is his call, not a fault to fix quietly.

### I2 · The COLUMNS layout lists dine-in before platform inside each lane

The wall board is now one FIFO queue across both channels (finding F3). The three columns are not:
`draw()` still concatenates dine-in tickets then platform tickets, so in a busy Cooking lane an
hour-old Zomato ticket can sit below a one-minute dine-in one. Unlike the wall, the columns never
promised FIFO, and grouping the delivery tickets together in a lane is arguably useful — a cook
plating for the counter can work down one block. Three lines to change if he wants the wall's rule
everywhere.

### I3 · The 86 board has no "show me what is already sold out"

The drawer lists all 59 dishes in menu order with a search box. To answer "what have we 86'd
tonight?" a cook scrolls the whole list looking for red. A single "sold out only" toggle at the top
of the drawer would answer it in one tap. Small (≈20 lines, inside the territory) — listed rather
than built only because it adds a control to a screen the owner has already been particular about,
and a filter that can be left ON is a state a cook could be confused by mid-rush.

### I4 · Nothing on the board says how long the READY column has been waiting

Deliberately NOT re-proposing R5 (an ageing signal on Ready) — he turned that down on 2026-08-07
and it stays turned down. Recording it here only so the next sweep does not "discover" it again:
the Ready column is age-blind on purpose.
