-- 298_each_menu_starts_at_one.sql
--
-- Every restaurant's dish codes become its own 1..N (owner, 2026-08-05).
--
-- THE STATE THIS FIXES. Migration 032 gives each dish a short number for staff to say out loud —
-- its own example is "Espresso (#7)". Migration 082 then made `dish_no` unique PER restaurant, but
-- the assigning trigger kept taking MAX(dish_no) across the WHOLE table, so numbers came out of one
-- platform-wide pool: French House #1–59, Pizza Palace #60–72, Aangan #195–467 (201 dishes spread
-- over 273 numbers), OG's Cafe #335–406 — interleaved with Aangan's range. Migration 296 fixed the
-- trigger, so every dish added from now on continues its own restaurant's series. This migration
-- fixes the numbers that were already there.
--
-- WHY IT IS A MIGRATION AND NOT A ONE-OFF SCRIPT (the owner's instruction). He wants the renumber
-- to happen on backup now, and to travel with the code on the day he says "copy everything over"
-- to the live stack. A migration does exactly that by construction: it runs wherever the folder
-- runs, once, in order — so nobody has to remember a manual step on release day. A script in
-- scripts/ would have been forgotten.
--
-- SAFE TO RENUMBER. `dish_no` is display-only: an order stores the dish's `id` (mig 029 builds every
-- line as {id, title, price, qty}), never its number, so no bill, KOT, report or history moves. The
-- one real cost is human: a restaurant's staff may know a number from a printed sheet. That is why
-- this was NOT done unasked, and why it lands on backup first.
--
-- ORDERING is the same rule migration 032 used for its original backfill — menu order, then age,
-- then id as the tie-break — so the result is stable and re-running changes nothing.

-- Two passes, because `menu_items_restaurant_dish_no_key` is a plain UNIQUE index: it is checked
-- row by row as a statement proceeds, so assigning final numbers in one UPDATE can collide with a
-- number the same statement has not moved yet (restaurant #2 wanting #1 while #1 is still taken).
-- Parking the changing rows on negatives first sidesteps that entirely — nothing else in this
-- column is ever negative, and only rows that actually CHANGE are touched, so a restaurant already
-- numbered correctly (French House, which is already 1–59) is not written to at all and emits no
-- realtime breadcrumb.
WITH target AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY restaurant_id
                            ORDER BY sort_order NULLS LAST, created_at NULLS LAST, id) AS want
    FROM menu_items
)
UPDATE menu_items m
   SET dish_no = -t.want
  FROM target t
 WHERE m.id = t.id
   AND (m.dish_no IS DISTINCT FROM t.want);

UPDATE menu_items
   SET dish_no = -dish_no
 WHERE dish_no < 0;

-- After this every restaurant reads 1..N with no gaps, and the trigger from migration 296 keeps it
-- that way: a new dish continues from its own restaurant's highest number.
