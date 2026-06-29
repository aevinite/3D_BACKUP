-- 106_enabled_panels.sql
-- Per-restaurant PANEL entitlements (owner 2026-06-29): which operational panels a
-- restaurant has — Manager / Kitchen / Tablet / Owner. ADMIN-controlled. A panel that is
-- OFF blocks that role's LOGIN and hides it (the role's staff simply can't sign in), so a
-- restaurant that doesn't want, say, an Owner panel never gets one.
--
-- ADDITIVE + backward-safe (the live-site rule): every EXISTING restaurant defaults to ALL
-- panels ON, so nothing they have today disappears. NEW restaurants created from the admin
-- set their own starting set explicitly (Manager+Kitchen+Tablet on, Owner OFF — owner's
-- choice 2026-06-29). Stored as a JSONB bag on the per-restaurant settings row, exactly like
-- settings.features (mig 035) — read server-side by lib/panelAccess.ts for the login gate.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS enabled_panels JSONB NOT NULL
  DEFAULT '{"manager":true,"kitchen":true,"tablet":true,"owner":true}'::jsonb;

NOTIFY pgrst, 'reload schema';
