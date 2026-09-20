-- 405_display_translations.sql
-- ADDITIVE per-language DISPLAY text, so a guest who switches language sees the whole screen
-- change and not only the chrome (owner, 2026-09-21, for the Aevidine launch film: "welcome,
-- all day cafe bakery, and categories and names in categories, name in item, chef special,
-- favorite and all that language should be changed ... if somewhere the language is not changed
-- perfectly you will go inside the code and change that").
--
-- This does NOT auto-translate anything. It is an empty jsonb that an owner (or the admin) fills
-- in with words they chose, exactly the shape `categories.name` has used since migration 002 and
-- exactly what docs/REJECTED-IDEAS.md R14 asks for: "I will add the translated word".
-- NULL everywhere by default, so every existing restaurant renders precisely as it does today.

ALTER TABLE menu_items  ADD COLUMN IF NOT EXISTS title_i18n    jsonb;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS hero_i18n     jsonb;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS tagline_i18n  jsonb;

COMMENT ON COLUMN menu_items.title_i18n  IS 'Optional {lang: title}. NULL = show `title` as-is (the default for every restaurant).';
COMMENT ON COLUMN restaurants.hero_i18n  IS 'Optional {lang: hero_title}. NULL = show `hero_title` as-is.';
COMMENT ON COLUMN restaurants.tagline_i18n IS 'Optional {lang: tagline}. NULL = show `tagline` as-is.';

NOTIFY pgrst, 'reload schema';
