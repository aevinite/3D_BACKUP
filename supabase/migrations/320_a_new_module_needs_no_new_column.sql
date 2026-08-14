-- 320_a_new_module_needs_no_new_column.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- WHERE: behind Admin console → a restaurant → Access, and Manager panel → Settings.
-- BACKEND ONLY — NOTHING ON SCREEN CHANGES. Every existing module keeps reading exactly the
-- columns it reads today; this only gives the NEXT one somewhere to live.
--
-- THE SHAPE OF THE PROBLEM (sweep improvement I6/I4). `settings` is one row per restaurant and it
-- now has 109 COLUMNS. I told the owner "about 40" — it is 109, and roughly 44 of them are the same
-- four-column pattern repeated once per module:
--     <module>_allowed · <module>_owner_control · <module>_enabled · tablet_<module>
-- eleven modules × four columns. Every new module has meant a migration, a clone-defaults entry, and
-- four more columns on the widest row in the database — and the app does not even want them as
-- columns: lib/accessModel.ts already models a module as a NAMED ladder
-- (state.modules["banquet"] = { allowed, control, enabled }) and lib/tableTags.ts is the one place
-- that turns that name into storage.
--
-- SO THE COLUMNS ARE AN IMPLEMENTATION DETAIL OF ONE FILE, and this migration gives that file a
-- second, cheaper option: a JSONB bag keyed by module name, the same trick `settings.features` and
-- `restaurants.owner_entitlements` already use for switches.
--
--   settings.modules = {
--     "<module>": { "allowed": true, "owner_control": false, "enabled": true, "tablet": "off" }
--   }
--
-- NOTHING IS MIGRATED. The eleven existing modules stay on their columns — moving them would touch
-- every panel and the Access screen for no visible gain, and the owner's own rule is that a change
-- has to earn its risk. A module that declares itself bag-backed (moduleBag in accessModel) reads
-- and writes here instead; none does yet, which is exactly why today's behaviour is provably
-- unchanged. The FIRST new module is the one that benefits.
--
-- GUARDED: npm run verify:settings-columns fails the moment a new <x>_allowed / _owner_control /
-- _enabled / tablet_<x> column appears for a module that is not already on the legacy list — so the
-- next person is told to use the bag rather than discovering this file by accident.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS modules jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.settings.modules IS
  'THE HOME FOR A NEW MODULE''S PERMISSION LADDER, so it needs no new columns (mig 320). Shape: {"<module>": {"allowed": bool, "owner_control": bool, "enabled": bool, "tablet": "off"|"on"|"pin"}}. An ABSENT module reads as allowed:false / owner_control:false / enabled:true — the same "new modules default OFF" rule the columns follow. The eleven modules that predate this (banquet, khata, parcel, platform, payroll, inventory, take_orders, table_ops, table_tags, table_assign, takeaway) stay on their own columns and are NOT migrated; lib/tableTags.ts reads whichever a module declares in lib/accessModel.ts. Guarded by npm run verify:settings-columns.';

NOTIFY pgrst, 'reload schema';
