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
