-- Service / maintenance mode toggle (editor General tab).
-- When true, the public menu shows only a full-screen "under maintenance" screen.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS service_mode BOOLEAN NOT NULL DEFAULT false;
