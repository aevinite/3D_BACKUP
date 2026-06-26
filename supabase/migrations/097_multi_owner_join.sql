-- 097_multi_owner_join.sql
-- ─────────────────────────────────────────────────────────────────────────
-- MULTIPLE owners per restaurant (additive, safe).
--
-- Until now a restaurant had exactly ONE owner (restaurants.owner_user_id).
-- That still works (one owner can own many restaurants), but a restaurant
-- could not have SEVERAL owners. This adds a many-to-many JOIN table so a
-- restaurant can have any number of owners AND an owner can own many.
--
-- We KEEP restaurants.owner_user_id as the "primary owner" — for display and
-- back-compat (admin's Restaurants tab still shows one owner per row, and the
-- act-as path still resolves through it). The SCOPING decisions (what a real
-- owner is allowed to see/manage) now read THIS table, so they widen correctly
-- to all of an owner's restaurants and never leak across owners.
--
-- Safety: fully additive. New table + index + backfill from the existing
-- owner_user_id links; nothing dropped, no existing column changed. RLS is
-- enabled with NO anon/authenticated policy (exactly like staff_users in
-- migration 054) — the service-role API bypasses RLS, the anon key cannot read
-- it. Owner-restaurant membership is sensitive, so it must stay service-only.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS restaurant_owners (
  restaurant_id uuid NOT NULL REFERENCES restaurants(id)  ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES staff_users(id)  ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, user_id)
);

-- The PK already indexes (restaurant_id, …); add the reverse for the hot
-- owner→restaurants lookup (SELECT restaurant_id WHERE user_id = me).
CREATE INDEX IF NOT EXISTS idx_restaurant_owners_user ON restaurant_owners (user_id);

-- Backfill: every restaurant that currently has a primary owner becomes a
-- membership row, so existing owners keep seeing exactly what they saw before.
INSERT INTO restaurant_owners (restaurant_id, user_id)
SELECT id, owner_user_id
FROM restaurants
WHERE owner_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- RLS on, NO policy ⇒ anon/authenticated denied; service-role API bypasses it
-- (same lock as staff_users, migration 054).
ALTER TABLE restaurant_owners ENABLE ROW LEVEL SECURITY;

-- PostgREST caches the schema; nudge it so the JS client sees the new table
-- immediately (without this, sb.from("restaurant_owners") can 404 until reload).
NOTIFY pgrst, 'reload schema';
