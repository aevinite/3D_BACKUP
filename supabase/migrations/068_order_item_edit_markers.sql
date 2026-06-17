-- 068: per-dish edit markers, so staff see WHAT changed on a dish after it was placed.
--
--   added_allergens — allergens ADDED to this dish after the order was sent. The
--                     kitchen/tablet/manager show a small "＋" beside each of these.
--   removed_flag    — TRUE once an allergen was REMOVED from this dish after placement.
--                     A "✎−" mark shows on the dish name (we don't name what's gone).
--
-- The full add/remove detail lives in the operational log (staff_actions). Both columns
-- are additive with safe defaults, so no backfill is needed.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS added_allergens text[] NOT NULL DEFAULT '{}';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS removed_flag boolean NOT NULL DEFAULT false;
