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

-- ⚠️ RUN-ALONE GUARD (sweep #9, T29, 2026-09-15).
-- `idx_staff_users_username_per_restaurant` above is RETIRED. Migration 245 ("a binned login frees
-- its name") replaced it with `idx_staff_users_username_live`, the same key but WHERE deleted_at IS
-- NULL — so a recycled staff login stops holding its username hostage — plus a plain
-- `idx_staff_users_username_any` for the "is this name free?" lookup over binned rows too.
--
-- Left as it was, running THIS FILE ALONE puts the strict rule back and quietly removes 245's whole
-- decision: a binned "manager" would once again block a new one from taking that name, with nothing
-- on any screen to explain why. It does not FAIL today — checked, not assumed: no restaurant
-- currently has a live and a binned row sharing a name.
--
-- A FULL re-seed already ends correctly (245 sorts after this file). Idempotent.
DROP INDEX IF EXISTS idx_staff_users_username_per_restaurant;
