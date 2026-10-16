# T20 (sweep #10) — the owner's home dashboard — findings

Problems found and FIXED in this run, one commit each (the number is in the commit message). The owner's
report — with every improvement idea — is in the terminal's chat window, never here.

| # | what was wrong | where he would see it | fix | guard | live proof |
|---|---|---|---|---|---|
| 1 | **REGRESSION.** The stock-count badge (2026-10-03) asked `/api/owner/inventory` on every dashboard open; for an owner without Inventory & stock the route refuses (403, by design), so every open cost a refused request and a console error. Rows **P05802 / P05804** (green 2026-09-05) were red. | Owner → Dashboard — nothing visible; a red console line and a wasted request each open | asks only when `ov.modules.inventory !== false` | verify:owner-reports "item 1" | T20-S10 P189185–P189187, P189458 |
| 2 | The Orders sheet's "Orders a day" bars were revenue ÷ the paid average ("about 6 orders"); they summed to 45 under a headline of 98 on French House's This month. | Owner → Dashboard → press Orders → the bar chart | draws the real per-day `orders` count, sorted | "item 2" | P189181–P189184, P189199 |
| 3 | Every sheet's heading said "all N restaurants" even when one restaurant's Reports were withheld (its money zeroed). | Owner → Dashboard (2+ restaurants) → any tile → the heading line | uses `restScopeText` ("1 of 2 restaurants · takings hidden for 1") | "item 3" | P189231–P189233 |
| 4 | Drilled into one restaurant, the Today sheet still charted the other restaurant and On hand still split "Earned where" across the estate; a one-restaurant owner got a 100% one-slice share bar. | Owner → Dashboard → a restaurant → Today so far / On hand | both appear only on the all-restaurants view, with 2+ restaurants | "item 4" | P189192, P189194, P189234–P189237 |
| 5 | Today's "Average per order" divided paid money by every order and printed ₹0 when orders were open and none paid. | Owner → Dashboard → press Today so far | "none paid yet" / "no orders yet today"; otherwise says what it divides | "item 5" | P189195, P189211–P189216 |
| 6 | With exactly two days of trade the docket's chart printed the last date twice (React duplicate-key warning, one copy centred off the card's edge). | Owner → Dashboard → press Revenue or Orders early in a week/month | label indexes de-duplicated | "item 6" | P189201–P189208 |
| 7 | `lib/ownerHome.ts` read a failed database read as "the login name is free" / "nobody holds it". | Admin console → Owners → create / rename / restore an owner — backend only, nothing on screen until it goes wrong | refuses to answer on a failed read; the sentence the callers already return | "item 7" | P189336–P189337 (executed with the read failing) |
| 8 | The docket note's "Open Audit & logs →" link had no underline — `a { text-decoration: none !important }` in globals.css beat it. | Owner → Dashboard → press Revenue or Expenses → the note at the bottom | `!important` on the underline | "item 8" | P189188–P189189 |
| 9 | Escape on a tile sheet (or the period list, or the picker) inside ONE restaurant also closed the restaurant view: the page bound its own Escape AND lib/backStack (2026-10-03) answers Escape for the top layer, so one key closed two layers. Traced: sheet gone at 37 ms, restaurant closed at 109 ms. | Owner → Dashboard → a restaurant → any tile → Escape: back on "All restaurants" | the page's four own Escape listeners removed; Escape goes through useBackClose only | "item 9" + verify:owner-screen | P189237–P189238, P189501–P189503 |

Every guard was sabotage-tested once: the fix undone, `npm run verify:owner-reports` red on exactly that item, restored.

## Re-run notes for the next sweep

- `scripts/sweep/t13/` (sweep #8's harness) now targets the docket (`.tdk`, `.tdk-wrap`, `.tdk-back`, `header b`, `header i`,
  `.r.total`) instead of the retired `.ow2-tile` pop-up, and reads a row's label and value from their own cells (the docket
  prints an explanation line under each value).
- `r2-m-shapes.mjs`'s all-zero estate rows depend on a morning when no restaurant has traded; T20's `reprove-live.mjs --estate`
  produces that state by answering the page's own requests instead.
- `live-phone.mjs` P67300 looks for the ADMIN console's menu classes; the owner shell's menu is `.owx-side.open`.
