-- 225_waiter_sections_follow_table_count.sql — adding tables must never create a table
-- that NOBODY serves.
--
-- Bug found by QA sweep 2026-07-30, exactly the class of the mig-222/PR-544 one: real data
-- moving after the sections were set.
--
--   A restaurant has 30 tables. Every waiter holds T1-T30 (the mig-223 backfill).
--   The admin raises the floor to 34.
--   T31-T34 are in NOBODY's section — the section editor only ever offered 1..30 — so with
--   sections switched on those four tables are invisible on every tablet AND every write to
--   them is refused 403. Guests sit there and no waiter ever sees them.
--
-- Verified before this fix: with table_count raised 30 -> 34, a waiter holding every old
-- table could not see T31 and got 403 opening it.
--
-- The fix keeps the product's core promise — a section is only ever a SUBTRACTION from the
-- floor, never a hole in it. When the count GROWS, the brand-new numbers are handed to every
-- waiter who already has a section; a manager can then narrow them deliberately, the same
-- way they would any other table.
--
-- Deliberately does NOT touch a waiter whose section is EMPTY: an empty list is a manager
-- saying "this person serves nothing right now" (benched), and quietly handing them four
-- tables would undo that. If EVERY waiter is empty the editor's "N tables nobody serves"
-- banner is the backstop, exactly as it is today.
--
-- Shrinking the count needs nothing: a number above table_count is already visible to
-- everyone (PR #544), so no table goes dark.
CREATE OR REPLACE FUNCTION lfh_sections_follow_table_count() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old int := GREATEST(COALESCE(OLD.table_count, 0), 0);
  v_new int := GREATEST(COALESCE(NEW.table_count, 0), 0);
BEGIN
  IF v_new <= v_old THEN RETURN NEW; END IF;   -- only a GROWING floor can orphan a table

  UPDATE staff_users su
     SET assigned_tables = ARRAY(
           SELECT DISTINCT t FROM (
             SELECT unnest(su.assigned_tables) AS t
             UNION ALL
             SELECT generate_series(v_old + 1, v_new)
           ) q ORDER BY t
         )
   WHERE su.restaurant_id = NEW.restaurant_id
     AND su.role = 'tablet'
     -- benched waiters (an empty section) stay benched — see the note above
     AND COALESCE(array_length(su.assigned_tables, 1), 0) > 0;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sections_follow_table_count ON settings;
CREATE TRIGGER sections_follow_table_count
  AFTER UPDATE OF table_count ON settings
  FOR EACH ROW
  WHEN (NEW.table_count IS DISTINCT FROM OLD.table_count)
  EXECUTE FUNCTION lfh_sections_follow_table_count();

-- A trigger only covers changes from NOW ON, so close the gap that already exists: any
-- waiter whose section stops short of the CURRENT table_count gets the missing tables.
-- Same rule — only waiters who actually have a section.
--
-- ⚠️ ONE-TIME — GUARDED SINCE 2026-08-28 (sweep #7, T23). This statement is correct EXACTLY ONCE.
-- Its WHERE tests "is this waiter missing a table" — which is true both of the gap this migration
-- exists to close AND of every section a manager has deliberately narrowed afterwards. A narrowed
-- section is the whole point of the feature ("a section is only ever a SUBTRACTION from the
-- floor"), so on a re-run this hands the WHOLE FLOOR back to every waiter and the narrowing is
-- gone, with nothing on screen and nothing in the Activity log to say it happened.
--
-- That is the same shape migration 321 named for 198 / 209 / 295 / 288 and migration 352 for
-- 235 / 301: "a WHERE that tests 'is it not the value I want' rather than absence".
-- `scripts/seed-supabase.mjs` step 1 re-runs every file in this folder with no ledger, so this is
-- reachable, not theoretical.
--
-- Measured on the backup database 2026-08-28: 0 waiters are narrowed today (mig 223's backfill gave
-- every one of them the whole floor and nobody has cut a section yet), so guarding it costs nothing
-- now. The day someone uses the feature is the day a re-seed would silently give it back — and that
-- is exactly the day nobody would be looking.
--
-- The TRIGGER above is deliberately NOT guarded and must never be: it only ever fires when the floor
-- GROWS, and handing out the brand-new numbers is the behaviour the file exists for.
--
-- `lfh_already_applied` is created by migration 307, 82 files AFTER this one, so a FRESH database
-- runs this its single legitimate time (no ledger = "not yet applied") and then migration 369
-- records the key. The `to_regprocedure` gate + EXECUTE is migration 043's pattern, for the same
-- reason: this file has to parse on a database where the function does not exist yet.
DO $reseed_guard$
DECLARE v_applied boolean := false;
BEGIN
IF to_regprocedure('public.lfh_already_applied(text)') IS NOT NULL THEN
  EXECUTE $probe$ SELECT lfh_already_applied('225_sections_follow_table_count') $probe$ INTO v_applied;
END IF;
IF v_applied THEN
  RAISE NOTICE '225_sections_follow_table_count: already applied — skipped (a re-run would hand the whole floor back to every waiter whose section a manager had narrowed)';
ELSE
  UPDATE staff_users su
     SET assigned_tables = ARRAY(
           SELECT DISTINCT t FROM (
             SELECT unnest(su.assigned_tables) AS t
             UNION ALL
             SELECT generate_series(1, GREATEST(COALESCE(s.table_count, 0), 0))
           ) q ORDER BY t
         )
    FROM settings s
   WHERE s.restaurant_id = su.restaurant_id
     AND su.role = 'tablet'
     AND COALESCE(array_length(su.assigned_tables, 1), 0) > 0
     -- only where something is actually missing, so this is a no-op on a tidy restaurant
     AND EXISTS (
       SELECT 1 FROM generate_series(1, GREATEST(COALESCE(s.table_count, 0), 0)) AS g(t)
        WHERE NOT (g.t = ANY (su.assigned_tables))
     );
END IF;
END $reseed_guard$;

NOTIFY pgrst, 'reload schema';
