-- 157_tablet_permissions.sql — the MANAGER → TABLET rung of the access ladder.
--
-- The 4-rung permission ladder (owner rule, 2026-07-22) is admin → owner → manager →
-- tablet. restaurants.manager_permissions (mig 091) already holds owner→manager; this
-- adds the mirror bag for manager→tablet: what a manager has switched on for their
-- waiters' tablet. JSONB so new tablet capabilities are just new keys (no future DDL) —
-- the reusable pattern for every feature (see lib/tabletPermissions.ts).
--
-- ADDITIVE + behaviour-preserving: absent = each key's default, and take_orders defaults
-- ON in code, so every existing tablet keeps taking orders with no data change.
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS tablet_permissions JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
