-- Menu items table
-- Run this once in the Supabase SQL editor before seeding data.

CREATE TABLE IF NOT EXISTS menu_items (
  id               TEXT PRIMARY KEY,
  slug             TEXT UNIQUE NOT NULL,
  title            TEXT NOT NULL,
  price            TEXT NOT NULL,
  image            TEXT NOT NULL,
  category         TEXT NOT NULL,
  veg              BOOLEAN NOT NULL DEFAULT false,
  is4d             BOOLEAN NOT NULL DEFAULT false,
  model_folder     TEXT,
  model_small_url  TEXT,
  model_optimized_url TEXT,
  description      TEXT,
  long_description TEXT,
  rating           TEXT,
  time             TEXT,
  nutrition        JSONB,
  ingredients      JSONB,
  reviews          JSONB,
  related_slugs    JSONB,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Allow anyone to read the menu (no auth needed for the public menu)
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_menu_items" ON menu_items;
CREATE POLICY "public_read_menu_items"
  ON menu_items FOR SELECT
  USING (true);
