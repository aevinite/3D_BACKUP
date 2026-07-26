-- 197_parcel_module.sql — the Parcel / takeaway feature as a first-class ladder MODULE,
-- so the admin can switch it on/off per restaurant from the Access panel exactly like
-- table_tags / banquet / table_ops / take_orders (docs/ACCESS-LADDER.md, the "six touchpoints").
--
--   parcel_allowed        — admin switch 1: the feature exists for this restaurant at all
--   parcel_owner_control  — admin switch 2: hand the on/off to the owner
--   parcel_enabled        — the owner's own toggle (consulted only while transferred)
--   tablet_parcel         — the waiter-tablet capability (tri-state off | on | pin)
--   (manager grant rides restaurants.manager_permissions.parcel + owner_entitlements.power_parcel)
--
-- Parcel is a BRAND-NEW feature, so per the NEW-FEATURE checklist every rung starts OFF:
-- _allowed defaults FALSE (admin must switch it on), owner_control FALSE, enabled neutral-ON
-- (only consulted once transferred), tablet cap 'off'. No restaurant gets it until granted.

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS parcel_allowed       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parcel_owner_control BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parcel_enabled       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tablet_parcel        TEXT    NOT NULL DEFAULT 'off';

NOTIFY pgrst, 'reload schema';
