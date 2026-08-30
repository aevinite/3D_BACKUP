# T7 · THE FOURTH 500 — P42501–P43000 (planned 2026-08-30, before a single row was written)

His words: *"make sure you read 500 phases test first of all, plan it and then rerun it. There
shouldn't be any error left and even though it is job for other, do that fix that."*

So this pass is planned, not inherited. Two things changed the ground under it since the third:

1. **I now own a cross-panel fix.** Item 21 put nine money boxes right on BOTH panels and left a new
   guard behind. A fix I made in another terminal's file is a fix I have to DRIVE, not assert.
2. **`public/panels/tablet/app.js` changed under me today.** PR #1187 gave the split screen its own
   tip row — in my own territory file, written by another lane, and it arrived carrying the exact
   fault I had fixed hours earlier (item 21b). Nothing in the first three passes has ever driven it.

| block | ids | count | what it drives | why it is here |
|---|---|---|---|---|
| A | P42501–P42580 | 80 | every item 1–21 re-verified LIVE, both panels | the standing instruction: prove my own work still stands |
| B | P42581–P42650 | 70 | the split screen's NEW tip row (PR #1187) on all four ways of dividing | landed today in my file, never driven |
| C | P42651–P42710 | 60 | the manager panel's discount sheet and tip row, driven for real | I changed them; asserting is not driving |
| D | P42711–P42760 | 50 | money that does not divide: paise, discount before tax, GST modes, MRP | the arithmetic behind every screen above |
| E | P42761–P42810 | 50 | taking an order end to end — search, categories, cart, allergies, send | the waiter's most-used screen |
| F | P42811–P42860 | 50 | a table's whole life: open → order → accept → serve → bill → pay → close | and the refusal at every step |
| G | P42861–P42905 | 45 | what a waiter's action does to the PAPER and the kitchen screen | a fault here is invisible on the tablet |
| H | P42906–P42950 | 45 | touch, focus, keyboard and contrast, both skins, five device sizes | the parts a screenshot flatters |
| I | P42951–P43000 | 50 | failure and recovery: 4xx, 5xx, timeouts, clash, double-tap, deep back | how it behaves when things go wrong |

**Rules this pass holds itself to, learned from the third:**
- Every row is driven against the LIVE site, never a branch.
- A red row is proved against the file it accuses BEFORE anything is changed. Roughly thirty of the
  third pass's reds were the check, not the product.
- A figure is counted on the table's own slice — `state.data.orders` only ever holds the open table.
- A toast is captured with a recorder; it is gone in 2.6 seconds.
- `history.back()` inside the panel walks the tab's history; land the tab deliberately instead.
- A `const` at the top of a classic script is not on `window`; intercept `LFH_OUTBOX.send`.
