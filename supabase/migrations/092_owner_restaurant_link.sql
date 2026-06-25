-- 092_owner_restaurant_link.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Phase 3 (roles): map each restaurant to its OWNER — a staff_users row with
-- role='owner'. ONE owner can own MANY restaurants, so the link lives on the
-- restaurant (restaurants.owner_user_id), not the user. The owner dashboard and
-- the owner's staff-management both scope to exactly `WHERE owner_user_id = me`.
--
-- Nullable + ON DELETE SET NULL: a restaurant with no assigned owner (e.g. the
-- historical restaurant #1) is owner-less and only the admin super-user manages
-- it; deleting an owner user un-owns their restaurants rather than cascading.
-- The admin assigns owners (Slice F). Additive + non-breaking (one nullable
-- column + an index); existing single-restaurant behaviour is unchanged.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES staff_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_restaurants_owner ON restaurants (owner_user_id);

NOTIFY pgrst, 'reload schema';
