-- Per-restaurant logo IMAGE (Phase 3). Additive, nullable; existing rows unaffected.
-- The image itself lives in the public Storage bucket `branding`; this column holds its URL.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS logo_url text;
