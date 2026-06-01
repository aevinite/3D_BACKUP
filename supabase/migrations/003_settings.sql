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
