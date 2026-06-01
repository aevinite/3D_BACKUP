-- Categories and filters: make them editable from the database instead of
-- hardcoded in the frontend, so a future editor (or restaurant owner) can
-- add/edit/reorder them without code changes.
--
-- Multilingual text is stored as JSONB: { "en": "...", "de": "...", ... }.
-- "en" is always treated as the fallback when a language is missing, so the
-- menu never shows a blank label.

-- ---------------------------------------------------------------------------
-- categories: the menu's category bar (Burgers, Pizza, ...). The virtual
-- "All" tab is NOT stored here; the frontend always shows it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  slug        TEXT PRIMARY KEY,            -- also stored on menu_items.category
  name        JSONB NOT NULL,              -- { "en": "Burgers", "de": "Burger", ... }
  icon        TEXT,                        -- FontAwesome class, e.g. "fa-burger"
  color       TEXT,                        -- hex accent, e.g. "#f97316"
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- filters: the dietary/attribute chips (Veg, Non-Veg, and later Vegan, Spicy,
-- Gluten-Free, ...). The virtual "All" chip is NOT stored; the frontend shows it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS filters (
  slug        TEXT PRIMARY KEY,            -- matched against menu_items.tags
  name        JSONB NOT NULL,              -- { "en": "Veg", "fr": "Végé", ... }
  icon        TEXT,                        -- emoji or icon, e.g. "🌿"
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Each dish can match several filters, e.g. {"veg"} or {"veg","vegan"}.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- Public read for both tables (same policy as menu_items). Writes still
-- require the service role / an authenticated admin (for the future editor).
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_categories" ON categories;
CREATE POLICY "public_read_categories" ON categories FOR SELECT USING (true);

ALTER TABLE filters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_filters" ON filters;
CREATE POLICY "public_read_filters" ON filters FOR SELECT USING (true);
