-- 172_table_ops_ladder.sql (ran on the live DB 2026-07-22 under earlier numbering)
-- NOTE: the owner_entitlements.table_ops_depth knob this migration's comments describe
-- was SUPERSEDED the same day by mig 177 (canonical module ladder — table_ops_allowed /
-- _owner_control / _enabled on settings, per docs/ACCESS-LADDER.md). What survives from
-- here is the tablet tri-state column below.
-- "Table & KOT operations" feature (KOT ▾ menu: change table / merge tables / move a
-- KOT / move an item / split bill) gets the full 4-rung access ladder:
--
--   admin → owner → manager → tablet
--
--   · ADMIN sets restaurants.owner_entitlements.table_ops_depth
--     ('off'|'owner'|'manager'|'tablet') — one knob = feature on/off + how deep it may
--     go. ABSENT = 'off' (deliberate dark-launch exception to the usual "absent = on"
--     entitlement convention, same posture as settings.banquet_allowed). No schema
--     change needed for that key — it lives inside the existing JSONB.
--   · OWNER grants the manager via manager_permissions.table_ops (existing mig-091
--     machinery; the admin rung for it is DERIVED from the depth, not a power_ key).
--   · MANAGER grants the tablet via the tri-state below — the NEW 4th rung, reusing
--     the exact pattern of the tablet billing capabilities (mig 074/130): edited in
--     the manager panel's Access settings, enforced by tabletPerm(), per-waiter
--     overrides via staff_users.permissions (mig 115), 'pin' mode included.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tablet_table_ops TEXT NOT NULL DEFAULT 'off';

-- Same constraint shape as the mig-074 tri-states (drop-first keeps this re-runnable).
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_tablet_table_ops_check;
ALTER TABLE settings ADD CONSTRAINT settings_tablet_table_ops_check
  CHECK (tablet_table_ops IN ('off', 'on', 'pin'));

NOTIFY pgrst, 'reload schema';
