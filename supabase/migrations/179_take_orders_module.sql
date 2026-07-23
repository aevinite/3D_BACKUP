-- 179_take_orders_module.sql — bring order-taking to the FULL canonical module ladder.
--
-- take_orders already had its manager POWER (power_take_orders + manager_permissions)
-- and tablet CAP (settings.tablet_take_orders, mig 178). This adds the top MODULE rung
-- so it behaves exactly like table_tags / banquet / table_ops (docs/ACCESS-LADDER.md):
--   <x>_allowed        — admin switch 1: the feature exists for this restaurant at all
--   <x>_owner_control  — admin switch 2: hand the on/off to the owner
--   <x>_enabled        — the owner's own toggle (consulted only while transferred)
--   effective = allowed AND (NOT owner_control OR enabled)   [moduleLadder()]
--
-- NON-BREAKING (the rule for a new rung on a PRE-EXISTING feature): _allowed is
-- BACKFILLED true and defaults true — taking orders is the app's core function, so no
-- live restaurant loses ordering. owner_control defaults false (admin hasn't delegated),
-- enabled defaults true. The admin can now switch a restaurant's ordering fully OFF.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS take_orders_allowed       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS take_orders_owner_control BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS take_orders_enabled       BOOLEAN NOT NULL DEFAULT true;

-- Backfill every existing restaurant to today's behaviour (ordering on).
UPDATE settings SET take_orders_allowed = true WHERE take_orders_allowed IS NULL;
UPDATE settings SET take_orders_enabled = true WHERE take_orders_enabled IS NULL;

NOTIFY pgrst, 'reload schema';
