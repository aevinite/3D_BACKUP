-- 087_restaurant_branding.sql
-- Additive per-restaurant BRAND fields on `restaurants`, so each restaurant can
-- show its own wordmark, hero, tagline and accent colour (white-label chrome).
-- Restaurant #1 is backfilled to its CURRENT café look so it stays identical.
-- (item_ratings per-restaurant scoping is a separate follow-on — NOT here.)

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS logo_text    text;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS hero_title   text;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS tagline      text;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS accent_color text;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS theme        jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Backfill restaurant #1 to its present look (the guest menu still renders #1's
-- hero from i18n + its hardcoded wordmark, so this is data-correctness +
-- future-proofing; it does NOT change #1's current appearance).
UPDATE restaurants SET
  logo_text    = COALESCE(logo_text,    'little French house'),
  hero_title   = COALESCE(hero_title,   'All-Day Café & Bakery'),
  tagline      = COALESCE(tagline,      'BONSOIR'),
  accent_color = COALESCE(accent_color, '#e3c06f')
WHERE id = '00000000-0000-0000-0000-000000000001';

NOTIFY pgrst, 'reload schema';
