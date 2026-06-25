-- 091_roles_and_permissions.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Phase 3 (roles/staff): the owner > manager > kitchen/tablet hierarchy, staff
-- usernames unique PER restaurant, and owner-configurable manager powers.
-- Builds on the existing staff_users table (054) + restaurant_id (078).
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Add 'owner' to the staff role set. Drop ANY existing CHECK on role first
--    (robust against the auto-generated constraint name) so 'owner' is allowed.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'staff_users'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE staff_users DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE staff_users
  ADD CONSTRAINT staff_users_role_check CHECK (role IN ('owner','manager','tablet','kitchen'));

-- 2) Username unique PER restaurant (was global lower(username); deferred from 082).
--    Two restaurants can now each have a "manager" login without colliding.
DROP INDEX IF EXISTS idx_staff_users_username;
DROP INDEX IF EXISTS idx_staff_users_username_per_restaurant;
CREATE UNIQUE INDEX idx_staff_users_username_per_restaurant
  ON staff_users (restaurant_id, lower(username));

-- 3) Owner-configurable manager capability flags, one set per restaurant.
--    The owner flips these; a manager may only perform a gated action when its
--    flag is true (else only the owner can). Mirrors the feature-flags pattern.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS manager_permissions jsonb NOT NULL DEFAULT '{
  "manage_staff": false,
  "edit_menu": true,
  "give_discounts": true,
  "view_dashboard": true,
  "void_bills": false
}'::jsonb;

NOTIFY pgrst, 'reload schema';
