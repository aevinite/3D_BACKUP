-- 180_access_panel_config.sql — foundation for the redesigned access panel.
--
-- DESIGN (owner brief 2026-07-23, design #1): the new panel presents the whole
-- access ladder as ONE model, but it is deliberately NON-DESTRUCTIVE:
--   • For every capability that ALREADY exists, the new panel writes the SAME
--     canonical columns it always did — owner_entitlements (admin→owner rung),
--     manager_permissions (owner→manager grant), settings.<x>_allowed/_owner_control/
--     _enabled (module ladders) and settings.tablet_<x> (tablet tri-states). So the
--     battle-tested server enforcement applies unchanged the moment the panel saves.
--   • Only the genuinely-NEW granular bits that have no existing home yet — the
--     Edit-the-menu sub-options (add_dish / edit_price / …), the Dashboard "which
--     reports", the Logs "which logs", per-side discount limits — live in this new
--     JSONB. Their server enforcement is a SEPARATE, reviewed migration (they change
--     no live behaviour until that lands, so this file is safe to run on dev now).
--
-- Everything here is ADDITIVE and defaults to '{}' (= "no granular overrides", i.e.
-- exactly today's behaviour). Nothing existing changes. Reversible: DROP COLUMN.

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS access_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN restaurants.access_config IS
  'Redesigned access panel: granular per-capability extras that have no legacy column '
  '(edit-menu sub-options, dashboard/log sub-options, per-side discount caps). Shape: '
  '{ "<capability>": { "owner_opts": {"add_dish":true,...}, "manager_opts": {...}, '
  '"limit": {"owner":100,"manager":20} } }. Existing rungs stay in owner_entitlements / '
  'manager_permissions / settings — this only holds the new sub-option granularity. '
  'Empty {} = no granular overrides = current behaviour. Added mig 180.';
