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
-- languages the moment this ships. The codes MUST match LANGUAGES / CURRENCIES in
-- lib/format.ts — a code the app can't render would show English while claiming otherwise.
--
-- ⚠️ ONE-TIME — GUARDED SINCE 2026-08-21 (sweep T23). Read the WHERE: it does not test ABSENCE,
-- it tests "the list is exactly ['en']" — which is true both of a restaurant that has never been
-- configured (the case this statement was written for) and of a restaurant whose ADMIN
-- deliberately narrowed the guest menu to English only. That is the same shape migration 321
-- found in 198 / 209 / 295 / 288 (findings 7510 / 7822), and it was missed here.
-- `scripts/seed-supabase.mjs` re-runs every file in this folder with no ledger, so on a re-seed
-- this handed five languages back to every English-only restaurant, on the GUEST MENU, with
-- nothing on screen and nothing in the Activity log to say so. Measured on the backup database
-- on 2026-08-21: 4 restaurants were English-only, one of them AANGAN GARDEN RESTAURANT — live,
-- not binned. Same reasoning for the currency list one statement below.
--
-- The helper may not exist yet and that is not an error: `lfh_already_applied` is created by
-- migration 307, 72 files AFTER this one, so a FRESH database runs this its single legitimate
-- time (no ledger = "not yet applied") and then migration 360 records the key. The
-- `to_regprocedure` gate + EXECUTE is migration 043's pattern, for the same reason.
DO $reseed_guard$
DECLARE v_applied boolean := false;
BEGIN
IF to_regprocedure('public.lfh_already_applied(text)') IS NOT NULL THEN
  EXECUTE $probe$ SELECT lfh_already_applied('235_menu_language_defaults') $probe$ INTO v_applied;
END IF;
IF v_applied THEN
  RAISE NOTICE '235_menu_language_defaults: already applied — skipped (a re-run would hand five languages back to an English-only menu)';
ELSE
  UPDATE settings
     SET menu_languages = ARRAY['en','de','fr','ar','hi','ko']::TEXT[]
   WHERE COALESCE((features->>'languages')::BOOLEAN, TRUE) IS TRUE
     AND menu_languages = ARRAY['en']::TEXT[];

  UPDATE settings
     SET menu_currencies = ARRAY['INR','USD','EUR','AED','SAR','QAR']::TEXT[]
   WHERE COALESCE((features->>'currency')::BOOLEAN, TRUE) IS TRUE
     AND menu_currencies = ARRAY['INR']::TEXT[];
END IF;
END $reseed_guard$;

-- Normalise away anything the app cannot actually render (also repairs a row written
-- with an unknown code), and never leave a row with an empty list.
UPDATE settings SET menu_languages = ARRAY(
  SELECT x FROM unnest(menu_languages) AS x WHERE x IN ('en','de','fr','ar','hi','ko'));
UPDATE settings SET menu_currencies = ARRAY(
  SELECT x FROM unnest(menu_currencies) AS x WHERE x IN ('INR','USD','EUR','AED','SAR','QAR'));
UPDATE settings SET menu_languages  = ARRAY['en']::TEXT[]  WHERE cardinality(menu_languages)  = 0;
UPDATE settings SET menu_currencies = ARRAY['INR']::TEXT[] WHERE cardinality(menu_currencies) = 0;

-- ── 4 · pay later (khata) gets its own module columns ───────────────────────
-- khata used to ride on table_tags_allowed, so switching "table types" off also
-- killed pay-later. They are separate features in the new model.
-- _owner_control exists only so the shared moduleLadder() helper can read all three
-- columns; owners control no features in the new model, so it stays FALSE forever.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS khata_allowed       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS khata_owner_control BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS khata_enabled       BOOLEAN NOT NULL DEFAULT TRUE;

-- ⚠️ ONE-TIME — GUARDED SINCE 2026-08-21 (sweep T23). This is the statement that SPLIT khata off
-- table_tags: it copies the old shared switch across, once, so nothing is lost on the day the two
-- become separate features. `WHERE … IS DISTINCT FROM …` reads as "is it not the value I want",
-- which is right exactly once and wrong every time after — from the moment the admin sets khata
-- independently on Access & permissions, a re-seed drags it back to whatever `table_tags_allowed`
-- says. Pay-later is money a restaurant is owed; having it silently switched off (or on) by a seed
-- script is the access model being rewritten by a script, which is migration 307's whole subject.
-- Measured on the backup database on 2026-08-21: 1 settings row would be rewritten today.
DO $reseed_guard$
DECLARE v_applied boolean := false;
BEGIN
IF to_regprocedure('public.lfh_already_applied(text)') IS NOT NULL THEN
  EXECUTE $probe$ SELECT lfh_already_applied('235_khata_follows_table_tags') $probe$ INTO v_applied;
END IF;
IF v_applied THEN
  RAISE NOTICE '235_khata_follows_table_tags: already applied — skipped (a re-run would drag pay-later back onto the table-types switch)';
ELSE
  UPDATE settings SET khata_allowed = COALESCE(table_tags_allowed, FALSE)
   WHERE khata_allowed IS DISTINCT FROM COALESCE(table_tags_allowed, FALSE);
END IF;
END $reseed_guard$;

-- ── 5 · one Takeaway & delivery switch over parcel + platform ──────────────
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS takeaway_allowed       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS takeaway_owner_control BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS takeaway_enabled       BOOLEAN NOT NULL DEFAULT TRUE;

-- On if EITHER of the two old switches was on (non-breaking: nobody loses a board).
--
-- DELIBERATELY NOT GUARDED, unlike the two blocks above (sweep T23, 2026-08-21). This is the same
-- "one-time copy" shape, but it is INERT on a re-seed: migration 263 later sets takeaway_allowed,
-- takeaway_enabled, parcel_allowed and parcel_enabled to TRUE for every restaurant unconditionally
-- (Parcel & delivery platforms became PERMANENT — owner, 2026-08-03), and 263 sorts after this
-- file, so a full pass always ends with the same row whatever this statement did. Adding a ledger
-- guard here would be noise pretending to be safety. If 263 is ever reverted, guard this too.
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
