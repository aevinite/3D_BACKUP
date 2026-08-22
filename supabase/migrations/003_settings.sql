-- Site-wide settings, edited from the editor's "General" tab.
-- A single row (id = 'site') holds global toggles like the bubble effect.

CREATE TABLE IF NOT EXISTS settings (
  id              TEXT PRIMARY KEY,
  bubbles_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_settings" ON settings;
CREATE POLICY "public_read_settings" ON settings FOR SELECT USING (true);

-- Ensure the single settings row exists (keeps existing value if already there).
INSERT INTO settings (id, bubbles_enabled) VALUES ('site', true)
ON CONFLICT (id) DO NOTHING;

-- ⚠️ RUN-ALONE GUARD (added by the 2026-08-21 migrations-001-118 sweep, T21).
-- `public_read_settings` above is RETIRED. Migration 283 ("close the door behind the guest") removed
-- it when the guest moved onto `lfh_guest_settings` (mig 282), which returns that ONE restaurant's
-- guest slice instead of the whole row — this table now holds gstin, access_config and every other
-- restaurant's switches. An always-true SELECT policy here means every restaurant's whole settings
-- row, to anyone holding the public menu key.
--
-- Today a partial run of this file would be INERT, because anon's table-level SELECT grant on
-- `settings` is also revoked — two locks, and only one of them comes back. It is still removed here
-- so the file's own end state matches what 283 decided, and so the remaining lock is not the only
-- thing standing between a re-run and a wide-open read. A FULL re-seed already ends correctly.
DROP POLICY IF EXISTS "public_read_settings" ON settings;
