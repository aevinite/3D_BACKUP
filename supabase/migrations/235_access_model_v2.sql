-- 235_access_model_v2.sql — storage for the rebuilt access & permission model
-- (owner, 2026-07-31; spec: docs/ACCESS-MODEL.md).
--
-- The rebuild deliberately re-uses the columns the app ALREADY enforces, so this
-- migration only adds what genuinely has nowhere to live yet. Every column is
-- ADDITIVE with a default that preserves today's behaviour — nothing changes for any
-- restaurant until the admin flips a switch in /aevinite → Access.
--
-- 1. menu_enabled          the guest-menu master switch (there was no such thing)
-- 2. menu_default_*        what a first-time guest sees before they change anything
-- 3. menu_languages/…      which languages + currencies the menu offers (one = no switcher)
-- 4. khata_*               "pay later" split OFF table_tags_*, which it used to share
-- 5. takeaway_*            one switch over the old parcel_* + platform_* pair
-- 6. *_in_reports          show payroll / inventory cost inside the sales reports

BEGIN;

-- ── 1-3 · guest menu ────────────────────────────────────────────────────────
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS menu_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS menu_default_layout  TEXT    NOT NULL DEFAULT 'grid',
  ADD COLUMN IF NOT EXISTS menu_default_mode    TEXT    NOT NULL DEFAULT 'light',
  ADD COLUMN IF NOT EXISTS menu_languages       TEXT[]  NOT NULL DEFAULT ARRAY['en']::TEXT[],
  ADD COLUMN IF NOT EXISTS menu_currencies      TEXT[]  NOT NULL DEFAULT ARRAY['INR']::TEXT[];

-- Only these two shapes are meaningful; a bad value would silently change the menu.
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_menu_default_layout_chk;
ALTER TABLE settings ADD CONSTRAINT settings_menu_default_layout_chk
  CHECK (menu_default_layout IN ('grid', 'list'));
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_menu_default_mode_chk;
ALTER TABLE settings ADD CONSTRAINT settings_menu_default_mode_chk
  CHECK (menu_default_mode IN ('light', 'dark'));

-- Never leave a restaurant with an empty language/currency list — the guest menu
-- would have nothing to render prices or labels in.
UPDATE settings SET menu_languages  = ARRAY['en']::TEXT[]  WHERE menu_languages  IS NULL OR cardinality(menu_languages)  = 0;
UPDATE settings SET menu_currencies = ARRAY['INR']::TEXT[] WHERE menu_currencies IS NULL OR cardinality(menu_currencies) = 0;

-- Existing restaurants keep today's behaviour: they currently offer the switchers
-- (features.languages / features.currency default true), so a restaurant that has
-- NOT switched them off keeps a multi-language menu rather than silently losing five
-- languages the moment this ships.
UPDATE settings
   SET menu_languages = ARRAY['en','fr','hi','gu','es','de']::TEXT[]
 WHERE COALESCE((features->>'languages')::BOOLEAN, TRUE) IS TRUE
   AND menu_languages = ARRAY['en']::TEXT[];

-- ── 4 · pay later (khata) gets its own module columns ───────────────────────
-- khata used to ride on table_tags_allowed, so switching "table types" off also
-- killed pay-later. They are separate features in the new model.
-- _owner_control exists only so the shared moduleLadder() helper can read all three
-- columns; owners control no features in the new model, so it stays FALSE forever.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS khata_allowed       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS khata_owner_control BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS khata_enabled       BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE settings SET khata_allowed = COALESCE(table_tags_allowed, FALSE)
 WHERE khata_allowed IS DISTINCT FROM COALESCE(table_tags_allowed, FALSE);

-- ── 5 · one Takeaway & delivery switch over parcel + platform ──────────────
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS takeaway_allowed       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS takeaway_owner_control BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS takeaway_enabled       BOOLEAN NOT NULL DEFAULT TRUE;

-- On if EITHER of the two old switches was on (non-breaking: nobody loses a board).
UPDATE settings
   SET takeaway_allowed = TRUE
 WHERE COALESCE(parcel_allowed, FALSE) OR COALESCE(platform_allowed, FALSE);

-- parcelLadder() and platformLadder() are repointed at takeaway_* in lib/tableTags.ts, so
-- the old columns stop being read. They are left in place (not dropped) so a rollback of the
-- code alone still finds its data — dropping them is a later, separate cleanup.

-- ── 6 · show payroll / inventory cost inside the sales reports ─────────────
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS payroll_in_reports   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS inventory_in_reports BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
