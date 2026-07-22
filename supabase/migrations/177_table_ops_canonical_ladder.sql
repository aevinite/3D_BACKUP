-- 177_table_ops_canonical_ladder.sql
-- Bring the KOT ▾ menu (Table & KOT operations, migs 172-176) onto the CANONICAL
-- module ladder (docs/ACCESS-LADDER.md, owner rule 2026-07-22) — the same two admin
-- switches + owner toggle every module carries (table_tags mig 166, banquet mig 167):
--
--   table_ops_allowed        admin: the module exists for this restaurant at all
--   table_ops_owner_control  admin: hand the on/off to the owner
--   table_ops_enabled        owner: their toggle (counts only when transferred)
--
-- Effective = allowed AND (NOT owner_control OR enabled) — lib/tableTags.ts
-- tableOpsLadder(). The manager rung is the plain power_table_ops "exists" switch +
-- the owner's manager_permissions.table_ops grant; the tablet rung stays the
-- settings.tablet_table_ops tri-state (mig 172). This REPLACES the interim
-- owner_entitlements.table_ops_depth knob (never enabled for any real restaurant),
-- which is scrubbed below so no orphan key lingers.
--
-- Defaults per the ACCESS-LADDER defaults rule (brand-new module):
-- allowed OFF · owner_control OFF · enabled ON · manager grant OFF · tri-state off.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS table_ops_allowed       boolean NOT NULL DEFAULT false;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS table_ops_owner_control boolean NOT NULL DEFAULT false;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS table_ops_enabled       boolean NOT NULL DEFAULT true;

-- Scrub the interim depth knob (test-only; 'off' everywhere by now).
UPDATE restaurants SET owner_entitlements = owner_entitlements - 'table_ops_depth'
 WHERE owner_entitlements ? 'table_ops_depth';

NOTIFY pgrst, 'reload schema';
