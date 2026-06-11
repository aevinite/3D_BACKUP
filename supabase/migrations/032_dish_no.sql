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
CREATE UNIQUE INDEX IF NOT EXISTS menu_items_dish_no_key ON menu_items(dish_no);
