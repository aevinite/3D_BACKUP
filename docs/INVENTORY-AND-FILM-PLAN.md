# The October plan — inventory, the films, and the rules that stop me asking again

**Written 2026-10-03 from the owner's voice note.** Saved to disk *because he asked for it to be*:
"plan whole thing save the plan like completely plan fully save plan bcz of context issue and start
executing all". Every section below is executable without re-reading the conversation.

**Standing rule this plan establishes: he should not have to say any of this twice.** Where an item
is a preference rather than a task, it ends with → **WRITE TO SKILL**, naming the file.

---

## 0 · What he actually said, in his order

1. "Insert the chapter one also" — the tour must get the same treatment as the rest.
2. Divide each film into parts so a mistake in part 2 means re-recording **part 2 only**, then
   re-merging. "That's why I told you to make the small ones also, which you can merge and the big
   ones also."
3. Banquet: when a new feature section starts, *say so* — "now we come to a new feature, banquet".
4. **Inventory UI/UX is "completely shit"** — redesign it. Make five, choose myself, don't ask.
5. Build the inventory features he describes if they are missing (ingredients master → searchable
   dropdown → per-dish quantities → buying adds stock → selling subtracts it → low-stock warning on
   **manager and owner**).
6. Pay-off (the payment flow) was never shown — show it, with every feature.
7. Zomato/Swiggy/website cards must disappear when those channels are switched off.
8. `brag-output/` is one flat heap — a folder per video, and `v1` / `v2` / `v3` so the latest is obvious.
9. Whenever he says "make a video", apply the motion-design brief he pasted **without being given it
   again**.
10. "I will tell you other mistakes" — more notes are coming; this plan must absorb them cheaply.

---

## 1 · What is ALREADY BUILT (verified in code 2026-10-03 — do not rebuild)

I checked before planning, because half of what he described already exists.

| He asked for | Status | Evidence |
|---|---|---|
| Ingredients master | **built** | `inv_items`, the Stock view in `public/panels/editor/inventory.js` |
| Recipe: dish → ingredients + quantities | **built** | `inv_recipe_lines` (mig 224) |
| Selling a dish subtracts its ingredients | **built** | `lfh_inv_deplete_order()` + trigger, mig 224 |
| Buying adds stock | **built** | `inv_purchases` / `inv_purchase_lines`, the Purchases view |
| Par level ("this is less") | **built** | `par_qty` on each ingredient; the "To order" view lists everything under par |
| Ingredient search | **partly** | the Stock list filters; the RECIPE picker's dropdown needs checking |
| Eight views | **built** | Stock · To order · Purchases · Count · Waste · Recipes · Usage · Expenses |
| **Channel cards obey the toggles** | **BUILT AND CORRECT** | `app.js:5715` `const ch = s.channelsOn…`, each card is `ch.zomato ? card(…) : ""`; `channelsOn` is computed server-side in `app/api/editor/[...path]/route.ts:2639` from `platOnDash && dashChan.zomato?.on === true` |
| Owner inventory page | **exists, thin** | `app/owner/inventory/page.tsx`, 68 lines |

**So item 7 is already done.** Verify it on screen (toggle a channel off in `/aevinite`, watch the
card go) and show him the evidence rather than "fixing" working code.

### The real gaps

- **G1 · Low-stock does not NOTIFY.** Nothing pushes "you are low on potatoes" to the manager's bell
  or to the owner. "To order" is a list you must go and look at. He asked for the notification.
- **G2 · Owner inventory page is 68 lines** — almost certainly not showing what he expects.
- **G3 · The recipe editor's ingredient dropdown** — confirm it is searchable; he asked by name.
- **G4 · The whole inventory UI is ugly.** His words. This is the big one.

---

## 2 · The research is already done — use it, don't redo it

`docs/research/pos-inventory/` holds **eight dossiers + a synthesis**, written earlier and never
acted on. "The 2 apps we took notes of" = **PetPooja** (`01`) and **Restroworks** (`02`), the two
Indian competitors; six more cover Toast, Square/Lightspeed, MarketMan/Craftable/R365,
Oracle/eZee/Zoho, Gofrugal/Rista, and the maths (`08-concepts-and-math.md`).

Two conclusions from `00-MASTER-SYNTHESIS.md` that the redesign must respect:

- **§1.2 — units are what everyone gets wrong.** Three units per ingredient minimum
  (purchase / stock / recipe), a per-item weight↔volume conversion (density is per-ingredient; a
  generic ml→g factor is a silent ~10% cost error on oil), balances stored in the smallest base unit,
  rounding **only at render**. Restroworks freezes the unit after first use and its reviewers complain;
  Toast decomposes it into five fields and then cannot let a user fix a mistake.
- **§1.3 — depletion timing has no industry answer**, so it is a design decision. Ours already
  deducts on the ORDER (mig 224 trigger). Keep it, and say so on screen, because PetPooja contradicts
  itself about this and Restroworks silently bills into negative stock.

The vocabulary to borrow from PetPooja (what Indian staff already know): **Raw Materials**,
**Item Recipes**, **Conversion** with a yield %, **Production Entry** for semi-finished goods.

---

## 3 · ORDER OF WORK

Infrastructure first — it is quick and it stops the next round costing a re-do.

### Phase A · Video infrastructure (no filming)

- **A1 · One folder per video, versioned.** `brag-output/` is a flat heap of 30+ files.
  New shape: `brag-output/<video-name>/v3/…` with `latest` pointing at the newest.
  Never overwrite a version; always add `v+1` so old cuts survive.
- **A2 · Ship the PARTS, not only the merge.** The rig already renders one clip per chapter
  (`films/<id>/clips/c6.mp4`). They are thrown away after the join. Keep them in the version folder,
  and add `./remake-chapter.sh <film> <chapter>` that re-shoots ONE chapter and re-joins without
  touching the other sixteen. **This is the thing he has now asked for twice.**
- **A3 · The tour gets the same treatment** (his "insert the chapter one also").
- **A4 → WRITE TO SKILL** (`~/.claude/skills/aevidine-product-film/SKILL.md`): the folder shape, the
  versioning, and "always deliver both the parts and the whole".
- **A5 → WRITE TO SKILL** (`~/.claude/skills/general-video/SKILL.md` or the `hyperframes` router):
  his motion-design brief, stored verbatim as the **default creative standard** so that "make a
  video" implies: a problem→solution story; each scene showing a different motion skill (kinetic
  typography, liquid/physics, UI animation, 3D breakdown, animated icons, data-viz, logo reveal);
  photoreal physical materials; an original soundtrack with effects synced to every cut; 1080p 60fps.
  Plus: **he should never have to paste that again.**

### Phase B · Inventory — WHAT IS WRONG, THE FIVE DIRECTIONS, AND THE DECISION

**B1 · What is actually wrong (screenshots taken 2026-10-03, all eight views, real data).**
He is right, and it is not vague — seven named faults:

1. **A quarter of the screen is empty.** Content starts ~26% in and stops short of the right edge.
   The floor and the dashboard use the full width; inventory sits in a narrow column with a beige
   void beside it. This is the single biggest reason it reads as unfinished.
2. **The view pills wrap onto two lines**, orphaning "Expenses" with the refresh button stranded
   beside it.
3. **Every row is an identical floating white pill.** Sixteen of them with no rhythm; nothing to
   scan down.
4. **Unit strings run together and repeat** — `have 1.42 12 box   buy 3.6 12 box`. The pack size is
   printed twice per row and there is no separator between count and unit.
5. **No severity gradient.** Blueberries at **−0.4** (actually out of stock, owing) wears the same
   red dot as Avocado at 1.42 (merely low).
6. **Numbers are right-ragged**, so no column can be scanned.
7. **The shopping list never says what it will cost** — sixteen things to buy and no total.

**B2 · Five directions, judged against three real users** — a kitchen manager on a laptop at 11pm,
the same person one-handed on a tablet by the walk-in, and the owner glancing on a phone.

| # | Direction | Verdict |
|---|---|---|
| 1 | **The shelf** — true dense table, aligned numeric columns, sticky category headers, no card chrome | Best density; all 26 visible. Dies on a tablet and a phone. |
| 2 | **Traffic-light board** — grouped by urgency, not category: below zero → low → fine | Nails the 11pm "what do I buy" job, loses the category model you need for a stock count. |
| 3 | **Two-pane master/detail** — list left, ingredient detail right | Uses the dead gutter and matches the panel's own `#list`+`#editor` pattern (Editor, Settings) — familiarity is worth a lot. Squeezes the list on a laptop. |
| 4 | **Cards with sparklines** — 7-day usage trend + days of cover per ingredient | Prettiest, least useful: 26 cards is a scroll marathon and it buries the numbers. |
| 5 | **One screen, three zones** — tight stat bar → "needs you" (below zero + low, with buy amounts AND the cost) → the full stock table, dense and aligned | Urgency first, completeness after, one scroll. Stacks cleanly to tablet and phone. |

**DECISION — direction 5, with two borrowings.** Decided alone, as asked.
- **Zone structure from 5**, because it answers the question the screen is actually opened to answer
  ("what do I need to do?") before the one it is browsed for ("what do we have?").
- **Aligned numeric columns from 1** inside the stock zone — `font-variant-numeric: tabular-nums`,
  fixed columns, so a column can be read down.
- **The existing `.inv-pop` ingredient sheet stays as the detail layer** rather than building 3's
  second pane: it already works, and apple-design §16.4 (familiarity) says don't move a thing that
  people already know where to find.
- Rejected 2 and 4 outright: 2 throws away the category model, 4 trades information for prettiness.

**What the build must deliver** (each one a fault above): full-bleed width · pills on one line that
scroll rather than wrap · `1.42 × 12-box` with the pack printed once · three severity levels that
look different (owing / low / fine) · tabular aligned numbers · a cost total on the shopping list.

### Phase B · Inventory — remaining work

- **B1 · Verify G1–G3** by driving the real screens, not by reading code.
- **B2 · Design.** Load `apple-design` + `ui-ux-pro-max`. Produce **five** directions, judge them
  myself against: an Indian kitchen manager on a laptop at 11pm, one-handed on a tablet, and the
  owner on a phone. **Decide alone — he said not to ask.** Record why the winner won.
- **B3 · Build the chosen design** across the eight views.
- **B4 · Close G1** — low stock reaches the manager's bell AND the owner. Per the 11-point module
  checklist: admin entitlement, permission-scoped, egress-safe, offline-safe, no silent overwrite.
- **B5 · Close G2** — make the owner's inventory page worth opening.
- **B6 · Close G3** — searchable ingredient dropdown in the recipe editor.

### Phase C · Film content

- **C1 · Section transitions** — "now we come to a new feature: banquet" (his example) wherever the
  film moves to a new area. Applies to every film, not only banquet.
- **C2 · Pay-off** — the payment flow with every feature on camera.
- **C3 · Channel toggles** — verify and show, do not rebuild.
- **C4 · Re-shoot** only what changed: 1.6 (inventory, rebuilt UI), plus whichever films C1/C2 touch.

### Phase D · Re-stitch and verify

Rebuild the 35-minute manual from the new parts; re-run the seam, chapter, audio and duration checks
that passed on 2026-09-29.

---

## 4 · Rules this plan makes permanent

→ **WRITE TO SKILL / MEMORY**, so he stops repeating them:

1. A video is delivered as **parts + whole**, in a versioned folder.
2. "Make a video" carries the full motion-design brief by default.
3. A new feature section in a film is **announced** before it is shown.
4. When he says a screen looks bad: make five, pick one myself, explain the choice, **never ask**.
5. Before building what he describes, **check whether it already exists** — more than half of the
   inventory ask was already built, and rebuilding it would have been the real waste.

---

## 5 · Progress

- [x] Plan written and saved (this file)
- [x] **A1 folder + versioning** — `brag-output/<video>/v1,v2,v3/` + `latest`, by
      `managerfilm/organise-output.sh`. 13 videos foldered; the root holds only folders and docs.
      `stitch.sh` and `verify-seams.py` read the new paths (flat path kept as a fallback).
      Re-stitched and re-verified end to end: every chapter on its marker, no click at any join.
- [x] **A2 parts + remake-chapter** — every film's chapter recordings are kept in `<ver>/parts/`
      (6–17 per film), and `managerfilm/remake-chapter.sh <film> <chapter>…` re-shoots one chapter
      and rebuilds around the rest. The pieces already existed (capture.mjs took a chapter filter;
      build.py composes from whatever clips are on disk) — nothing had joined them up, so every
      fix re-shot all seventeen. Caveat written into the script: a chapter that depends on what an
      earlier chapter did ON CAMERA must be remade together with them, because prep rebuilds the
      world.
- [x] **A3 the tour included** — manager-1.0-overview/v1/parts/ holds all 17 of its chapters.
- [x] **A4/A5 skills** — `~/.claude/skills/aevi-video-standard/SKILL.md` holds his motion-design
      brief verbatim, the parts-and-whole rule, the folder/versioning shape, "announce a new
      feature section", "make five and decide yourself", and "check it exists before building it".
      Global `~/.claude/CLAUDE.md` now routes every video request through it FIRST.
- [x] **B1 verify** — all eight views screenshotted with real data; seven named faults, listed above.
      Also confirmed what was ALREADY built (recipes, deduction on sale, par levels, channel toggles)
      so none of it gets rebuilt.
- [x] **B2 five designs + decision** — recorded above. Direction 5 ("one screen, three zones"),
      with aligned numeric columns from 1 and the existing ingredient sheet kept as the detail layer.
- [~] **B3 build — the shared furniture is done, the per-view work is not.**
      Done and verified on screen: the 860px cap removed (every other screen in the panel runs full
      width — inventory was the only one boxed in); pills on one line that scroll instead of wrapping
      and orphaning "Expenses"; rows as one list with hairline rules instead of 16 floating cards;
      a severity edge so *owing* ≠ *low* ≠ *fine* without reading a word; tabular aligned numbers;
      category headings with a rule; the pack name printed ONCE per row instead of twice; and the
      shopping list now says what it will cost (`16 items to buy · about ₹68,853`) — which needed
      `avg_cost` adding to the order-list select, using cost-per-BASE-unit to match how the stock
      view values stock, because mixing it with `last_rate` is exactly the pack-factor error the
      unit research warns about.
      STILL TO DO: Purchases, Count, Waste, Recipes, Usage and Expenses have only inherited the
      shared furniture — none has had its own layout thought about yet.
- [x] **B4 notify — BOTH panels, as he asked.**
      MANAGER: `LFH_INV.stockAlert()` feeds two rows into the existing bell ("Needs you") — one for
      what has run out, one for what is below par, each naming the first three ingredients and
      opening the tab. Two rows, not twenty: sixteen separate alerts would bury the orders and
      calls and train him to ignore the bell. It reads data the tab has already loaded and adds no
      poll. Needed a `stock` kind in `public/panels/guestbell.js`, which only gave a self-contained
      title to `printer` rows — anything else rendered as "Table  asked for something". That is now
      a `SELF_TITLED` map rather than a second special case.
      OWNER: the dashboard had **nothing** about stock — you had to think to open the page. A badged
      "Stock" shortcut now sits with Reports/Team/Feedback, fed by a new `?only=counts` path on
      `/api/owner/inventory` (one aggregate; the full report is snapshot-cached but carries 300
      expenses and 100 bills, and shipping those to render two numbers is the egress the playbook
      warns about). Fetched once per restaurant, never polled.
      Caught in testing: the badge first showed low+negative, but `lfh_inv_report_summary`'s
      `low_count` ALREADY includes the ones below zero — it was reporting one ingredient twice.
- [x] **B3 the other four views** — Purchases, Count, Waste and Expenses had only inherited the
      shared furniture, and two of them were quietly broken BY it. `.inv-row` was a three-track
      grid, but Waste rows carry a fourth child (the ✕ strike-out) and Expenses a fifth (the
      receipt thumb), so the extras fell onto an implicit second row — the ✕ sat under the name.
      Flex now; grid was buying nothing anyway, because each row is its own grid and the columns
      never lined up with the row above (what aligns them is `min-width` + `tabular-nums`). The
      corner rounding was `:first-of-type`, which asks "first DIV among siblings" rather than
      "first row of this block" — it worked in Stock only because its rows are `<button>` and the
      heading is a `<div>`. Structural now. All three ledgers gained the `.inv-cat` day heading via
      one `byDay` helper that re-sorts by the BUSINESS date, because both lists arrive ordered by
      `created_at` and a bill entered Friday for Tuesday's delivery would print Tuesday twice.
      Tested on interleaved dates: two headings not four, entry order kept inside each day.
- [x] **B7 THE REAL GAP — stock was never deducted when a dish sold** (mig 409). Not a UI matter
      and the heart of his ask. mig 224 built depletion fifteen months ago and it had never fired
      once: it joined order lines on `slug`, and `lfh_price_order` — the single builder behind all
      three order doors — writes `{id,title,price,qty,options,removed,note,tax_mode,is_mrp}` with
      no `slug` at all, so the trigger's own filter threw every line away before the recipe join.
      Fail-open by design, so it never raised or logged. The same dead join silently zeroed
      `lfh_inv_dish_cost` (every recipe cost money and earned nothing) and `lfh_inv_coverage`
      (the denominator of the food-cost %, which mig 227 calls "the honesty gate"). THIRD time this
      has shipped — mig 089 had it, mig 130 fixed it and wrote the shape down, 224 and 227 brought
      it back — so it comes with `verify:order-keys`, which asks the RUNNING database, proven red
      against a deliberately bad function and green again after. `reset-demo-history.mjs` was the
      source of every slug-shaped row and now writes `id` like the app. Coverage went from 0 of 0
      to 13 of 59 dishes, 28.75L covered of 97.56L, ~33% food cost.
- [x] **B5 owner page — ALREADY BUILT; my gap assessment was wrong.** I recorded it as "68 lines,
      almost certainly not showing what he expects". Those 68 lines are a server shell; the real
      screen is `components/owner/OwnerInventory.tsx`, 474 lines, and it already carries the
      low-stock list, the below-zero list, stock value, purchases, waste and every expense. Nothing
      to build. Judging a page by the line count of its route file was the mistake.
- [x] **B6 dropdown** — the recipe editor's ingredient picker was a native `<select>`, which cannot
      be typed into beyond first-letter jumping; fine at 26 ingredients, useless at the hundreds a
      real kitchen carries. It is now a combobox: type to filter, arrow keys, Enter takes the only
      match, the unit shown on every option (200 means nothing until you know grams or litres), and
      focus jumps to the quantity box. Driven and verified: 26 on focus → "mozz" → one match →
      Enter → picked, unit "g".
- [x] **C1 transitions written** — his example was banquet, and banquet was the worst case: ONE
      sentence tacked onto the end of the platforms chapter, so a viewer watching Zomato tickets is
      shown a different product with no warning. Three chapters reworded (no lines added or
      removed, so every `shows` index stays valid): c7 "Then the money." → "Now a different job —
      taking the money."; c12_4 → "And banquet is a feature of its own…"; c15 "Then the day, as it
      stands." → "Now the dashboard — …". The rest already name their subject in their first words.
- [x] **C2 pay-off written** — "Collect one bill, or all of them at once" was spoken over a Collect
      button that was boxed and never pressed. Pressing it IS the feature: it asks how the money
      came in (UPI / Cash / Card / Other), records it against that person, and the bill leaves the
      tab book. The chapter now presses it, boxes the method grid, and pays with Cash.
- [x] **C2b "make sure pay off also have every feature" — AUDITED, nothing missing.** The product
      half of his sentence, checked rather than assumed. The collect sheet offers UPI, Cash, Card
      and Other, plus Split payment, On the house and Pay Later (khata) as first-class choices, and
      a tip that can be entered as an amount or a percentage with the change worked out against
      what the guest handed over. A discount carries a reason (shipped 37acb55b). Collect-all pays
      every open bill at once. That is the full set; no gap found, so nothing was built.
- [x] **C3 toggles — VERIFIED, and they were already correct.** Proved on screen rather than from
      code: with everything on the strip reads Dine-in · Zomato · Swiggy; with Zomato and Swiggy
      switched off in `settings.platform_channels` it reads Dine-in · Website · Parcel — both cards
      gone. Settings restored byte-for-byte afterwards. No change was needed or made.
- [x] **C4 re-shoots — DONE, and the partial re-shoot earned its keep.** `./remake-chapter.sh
      1.0-overview c7 c10 c12 c15` — four chapters, thirteen clips kept. First real use of the
      one-chapter rebuild he asked for. Take 1 went red on two gates, both c10, both real:
      the Collect press fired 0.2s into the sentence that NAMES the button, so the pay overlay
      covered it while the voice still pointed at it (scene-truth) and buried the previous box
      after 0.32s of 2.4s (box-still). Take 2 fixed scene-truth but the method-grid box still
      held only 0.39s — the overlay animates for ~1.67s, more than double the 0.80s SETTLE, so
      the box opened late and the Cash tap cut it. **No static gate can find that; only a take
      measures an animation.** Take 3: all gates green. One box was dropped rather than squeezed.
- [x] **D re-stitch + verify — DONE.** 35m11.3s, 11 chapters. Every join lands on its marker TO
      THE FRAME, no click at any join, picture 2111.30s = the eleven parts summed. Delivery:
      63,339 frames, audio 2111.31s, longest still 0.0s, longest silence 0.2s. Filed as
      `manager-panel-manual/v3`, tour as `manager-1.0-overview/v2` with its 17 parts.
      **Caught before it shipped:** `stitch.sh` reads `<film>/latest/`, `remake-chapter.sh`
      writes the loose top-level file — the fresh tour was 23:40, the copy the stitcher would
      have taken was 03:47. `organise-output.sh` between them is not optional.
- [x] **B8 the demo world could never SHOW depletion** — found by screenshotting the Usage tab
      instead of trusting the DB. It read "Used by orders ₹0" on a world that had just sold a
      day of food. Not a product fault: `prep-all` ran `prep-floor` (places 22 real orders, which
      now deduct) and THEN `prep-stock`, whose first act is to delete every `inv_movements`,
      `inv_items` and `inv_recipe_lines` row before rebuilding. The trigger fired; the next step
      erased it. Harmless for fifteen months precisely BECAUSE the feature never worked. Stock is
      now seeded before the trade — which is also what a restaurant does. Verified on screen:
      **Used by orders ₹3,250.38**, 54 consumption rows over 21 ingredients, all 28 world checks
      still green.
