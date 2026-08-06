-- 093_grandfather_r1_manager_powers.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Migration 091 added restaurants.manager_permissions with RESTRICTIVE defaults
-- (void_bills + manage_staff = false). That is the right default for a NEW
-- restaurant — the owner explicitly grants powers. But restaurant #1 is the
-- EXISTING live restaurant, whose manager could already void bills, discount,
-- edit the menu and see the dashboard before these flags existed. Enforcing the
-- restrictive defaults on it would silently REMOVE abilities the live manager
-- relies on — a regression.
--
-- So grandfather restaurant #1 to all-powers-ON (non-breaking). Every OTHER
-- restaurant keeps 091's restrictive defaults, so the owner-grants-power flow is
-- still meaningful for the SaaS tenants. Idempotent (a plain UPDATE of #1's row).
-- ─────────────────────────────────────────────────────────────────────────

-- ⚠️ ONE-TIME — GUARDED SINCE MIGRATION 307. This REPLACES the whole manager_permissions bag
-- with 5 keys; French House now carries 24. A re-run (seed-supabase.mjs runs every file) would
-- delete the other 19 and flip `delete_bill` from a deliberate false back to absent — a seed
-- script quietly handing back powers an admin removed.

DO $reseed_guard$
BEGIN
IF lfh_already_applied('093_grandfather_r1_manager_powers') THEN
  RAISE NOTICE '093_grandfather_r1_manager_powers: already applied — skipped (a re-run would wipe 19 permission keys)';
  RETURN;
END IF;

UPDATE restaurants
SET manager_permissions = jsonb_build_object(
  'manage_staff',   true,
  'edit_menu',      true,
  'give_discounts', true,
  'view_dashboard', true,
  'void_bills',     true
)
WHERE id = '00000000-0000-0000-0000-000000000001';

NOTIFY pgrst, 'reload schema';

END $reseed_guard$;
