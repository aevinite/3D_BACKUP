-- 082_tenant_index_scoping.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Phase 1a follow-up: two UNIQUE indexes were still GLOBAL (they're partial /
-- plain indexes, so the constraint-level changes in 079 didn't touch them).
-- Left as-is they'd block a real 2nd restaurant from having e.g. an open
-- "table 1" or a dish #1. Re-scope both per restaurant.
--
-- NOTE: `idx_staff_users_username` (unique lower(username)) is INTENTIONALLY
-- left global for now — scoping it per restaurant requires the staff login
-- lookup to become restaurant-aware, which is Phase 3 (RBAC). Until then all
-- staff belong to restaurant #1, so there is no collision.
-- ─────────────────────────────────────────────────────────────────────────

-- Only ONE open session per (restaurant, table) — was global on table_number.
DROP INDEX IF EXISTS idx_one_open_session_per_table;
CREATE UNIQUE INDEX idx_one_open_session_per_table
  ON sessions (restaurant_id, table_number) WHERE status = 'open';

-- dish_no unique per restaurant — was global. (dish_no is nullable; multiple
-- NULLs are still allowed, exactly as before.) Handle whether the old object
-- was a CONSTRAINT or a bare INDEX.
ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_dish_no_key;
DROP INDEX IF EXISTS menu_items_dish_no_key;
DROP INDEX IF EXISTS menu_items_restaurant_dish_no_key;
CREATE UNIQUE INDEX menu_items_restaurant_dish_no_key
  ON menu_items (restaurant_id, dish_no);

NOTIFY pgrst, 'reload schema';
