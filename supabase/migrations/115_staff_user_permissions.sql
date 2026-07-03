-- 115_staff_user_permissions.sql — per-USER capability overrides (owner, 2026-07-03:
-- "inside the Access setting… what access is granted to a particular user, like he can
-- mark as paid / not paid").
--
-- staff_users.permissions is a JSONB map of capability-key → mode:
--   { "tablet_mark_paid": "on" | "pin" | "off", ... }
-- An ABSENT key means "Default" — the user inherits the restaurant-wide tri-state in
-- settings (tablet_discount / tablet_mark_paid / tablet_invoice). JSONB (not columns)
-- so future capabilities need no further migration — same pattern as
-- restaurants.manager_permissions (migration 091).
--
-- Resolution rule (single source of truth, enforced in /api/tablet):
--   effective(key, user) = user.permissions[key] ?? settings[key] ?? 'off'
--
-- LIVE-SAFE: additive column with a default; existing rows read '{}' = everyone keeps
-- exactly today's behaviour (all inherit the restaurant default).
ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

-- staff_users already has RLS on with NO policies (service-role only) — the new
-- column is covered by that same lockdown; nothing to grant.
NOTIFY pgrst, 'reload schema';
