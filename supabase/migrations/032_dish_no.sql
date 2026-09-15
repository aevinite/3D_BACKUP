-- 032_dish_no.sql
-- Give every dish a stable numeric code (dish_no) shown ONLY in the editor
-- ("Espresso (#7)"). Pricing is already server-authoritative by item id × qty
-- (migration 029); this number is purely a human-friendly reference for staff.
--
-- It must keep working when NEW dishes are added: a BEFORE INSERT trigger assigns
-- the next number automatically when one isn't supplied. The editor's "add dish"
-- upsert never sends dish_no, and neither does the menu.json reseed — so on an
-- UPDATE the existing code is preserved, and on an INSERT the trigger fills it.

-- 1) the column (idempotent)
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS dish_no integer;

-- 2) backfill existing dishes with stable sequential numbers (by menu order)
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order NULLS LAST, created_at NULLS LAST, id) AS n
  FROM menu_items
)
UPDATE menu_items m
   SET dish_no = numbered.n
  FROM numbered
 WHERE m.id = numbered.id
   AND m.dish_no IS NULL;

-- 3) auto-assign the next number on insert when the caller didn't supply one
CREATE OR REPLACE FUNCTION assign_dish_no() RETURNS trigger AS $$
BEGIN
  IF NEW.dish_no IS NULL THEN
    SELECT COALESCE(MAX(dish_no), 0) + 1 INTO NEW.dish_no FROM menu_items;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_dish_no ON menu_items;
CREATE TRIGGER trg_assign_dish_no
  BEFORE INSERT ON menu_items
  FOR EACH ROW EXECUTE FUNCTION assign_dish_no();

-- 4) no two dishes share a code
--
-- ⚠️ RUN-ALONE GUARD (sweep #9, T29, 2026-09-15). This index is GLOBAL on dish_no, and migration
-- 082 replaced it with the per-restaurant `menu_items_restaurant_dish_no_key` precisely because a
-- global one "would block a real 2nd restaurant from having … a dish #1". On today's database ten
-- restaurants each have a dish #3, so re-creating the global index raises `could not create unique
-- index … key is duplicated` and `node scripts/run-migration.mjs 032_dish_no.sql` — the single-file
-- workflow CLAUDE.md recommends — ABORTS here. (A full re-seed was always fine: this runs while
-- only restaurant #1 exists, and 082 then swaps it for the scoped one.)
--
-- So: create it only while 082's scoped replacement is NOT yet present. Where 082 has run, the
-- rule it enforces is already being enforced, better, and this line has nothing left to do.
DO $dish_no_unique$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'menu_items_restaurant_dish_no_key'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS menu_items_dish_no_key ON menu_items(dish_no);
  END IF;
END $dish_no_unique$;

-- …and retire it at the end, so the file's own end state is the one 082 decided rather than an
-- index the sequence has replaced. The same one-line ending migrations 036/040/099 carry.
ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_dish_no_key;
DROP INDEX IF EXISTS menu_items_dish_no_key;
