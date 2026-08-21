-- 359_a_rating_is_given_not_typed.sql
--
-- Drops `menu_items.rating` and `menu_items.reviews`. Both have been dead since migration 030 and
-- both were still WRITABLE from a screen, which is the part that made them worth removing rather
-- than leaving alone.
--
-- THE STORY. Migration 030 replaced seeded fake reviews with real customer ones: a guest's rating
-- goes into the `reviews` table, and the `item_ratings` view (per-restaurant since migration 116)
-- aggregates it. 030 emptied these two columns and nothing has read them since — measured on the dev
-- database the day this was written, 0 of 464 dishes carried a value in either.
--
-- But the manager's dish form still had a "Rating" text box and an editable "Reviews" list bound
-- straight to them, and the editor's write path is a DENY-list (it strips the fields a person may not
-- edit and passes everything else through), so both reached the table on every save. A manager could
-- type 4.8 into a dish, press save, and see absolutely nothing change — not on the card, not on the
-- dish page, not in the Rating review tab. Work that goes nowhere and says nothing is worse than a
-- missing feature, because the person believes they have done something.
--
-- WHAT LANDED WITH THIS, and why the order mattered: the two writers were removed FIRST, in the same
-- change. Dropping a column that a live screen still sends makes PostgREST reject the whole write, so
-- the manager would have gone from "the Rating box does nothing" to "no dish can be saved at all".
--   · public/panels/editor/app.js — the Rating field, the Reviews card, its two row actions, and the
--     blank-dish template entries. A comment there says why, so the boxes are not rebuilt.
--   · lib/starterMenu.ts — a newly created restaurant no longer seeds `rating: null` / `reviews: []`.
--
-- SAFE FOR EVERY READER, checked before writing: no query anywhere names either column
-- (`CARD_COLUMNS` in lib/menu.ts deliberately omits both as detail-only), the two `select("*")` reads
-- simply return two fewer columns, and lib/menu.ts's mapper already guards the reviews field with
-- `has(row, "reviews")` so it is skipped when absent. `getItemReviews` reads the `reviews` TABLE and
-- is untouched. MenuItem's TypeScript `reviews` field stays: the dish page still carries its own
-- locally-loaded review list under that name.

ALTER TABLE menu_items DROP COLUMN IF EXISTS rating;
ALTER TABLE menu_items DROP COLUMN IF EXISTS reviews;

NOTIFY pgrst, 'reload schema';
