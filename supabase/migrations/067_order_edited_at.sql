-- 067: mark when an order was EDITED after it was placed.
--
-- "Edited" = staff changed the order after it was sent to the kitchen: a dish's
-- quantity/note/allergens, the order-wide "avoid" list, or a dish was added or
-- removed. The kitchen / tablet / manager show a persistent "✎ Edited" badge on
-- such a ticket so staff re-check what changed. NULL = never edited.
--
-- Additive + nullable, so it is safe on a live table and needs no backfill.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS edited_at timestamptz;
