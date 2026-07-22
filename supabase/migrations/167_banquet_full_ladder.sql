-- 167_banquet_full_ladder.sql
-- LADDER AUDIT (owner 2026-07-22: "check all the features… the ladder is the user
-- access"): bring BANQUET (mig 130) up to the full 4-rung ladder the table-tags
-- module (mig 166) established. Banquet had rung 1a (banquet_allowed) and rung 3
-- (tablet_banquet) but no admin→owner power transfer, no owner toggle, and no
-- owner→manager grant.
--
-- NON-BREAKING DEFAULTS RULE (docs/ACCESS-LADDER.md): a NEW rung added to a
-- PRE-EXISTING feature defaults to that feature's CURRENT behaviour —
--   banquet_owner_control  default FALSE (admin keeps the switch, as today)
--   banquet_enabled        default TRUE  (a later transfer changes nothing)
--   manager power 'banquet' BACKFILLED TRUE for every restaurant (managers who
--     can use Banquet today keep it; enforcement reads absent=false, so without
--     the backfill this rung would silently kill Aangan's banquet tab).

ALTER TABLE settings ADD COLUMN IF NOT EXISTS banquet_owner_control boolean NOT NULL DEFAULT false;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS banquet_enabled boolean NOT NULL DEFAULT true;

-- Backfill the owner→manager grant as ON everywhere (pre-existing behaviour).
UPDATE restaurants
   SET manager_permissions = COALESCE(manager_permissions, '{}'::jsonb) || '{"banquet": true}'::jsonb
 WHERE deleted_at IS NULL
   AND (manager_permissions->>'banquet') IS NULL;

NOTIFY pgrst, 'reload schema';
