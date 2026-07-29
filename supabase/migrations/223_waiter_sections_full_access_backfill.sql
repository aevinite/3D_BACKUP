-- 223_waiter_sections_full_access_backfill.sql — every EXISTING waiter keeps the whole floor.
--
-- Owner, 2026-07-29, at go-live: "make sure right now whoever the users are created in the
-- backup, all will have full access."
--
-- Migration 222 added `staff_users.assigned_tables` defaulting to '{}'. That is harmless
-- while the table_assign module is off (an empty list only restricts anyone once the module
-- is switched on), but it means the FIRST restaurant to switch sections on would find every
-- waiter staring at a blank tablet. This backfill removes that cliff: every waiter starts
-- holding every table, so turning the feature on changes NOTHING until someone deliberately
-- narrows a section. Sections then become a subtraction, which is the safe direction.
--
-- ONLY fills a waiter whose list is EMPTY. A section somebody has already set is never
-- overwritten — so this is safe to run again, and safe to run later on another database
-- that has been using sections for a while.
--
-- table_count is per restaurant (settings.table_count, mig 011); a restaurant with no
-- settings row keeps '{}' and is unaffected.
UPDATE staff_users su
   SET assigned_tables = ARRAY(
         SELECT generate_series(1, GREATEST(COALESCE(s.table_count, 12), 1))
       )
  FROM settings s
 WHERE s.restaurant_id = su.restaurant_id
   AND su.role = 'tablet'
   AND COALESCE(array_length(su.assigned_tables, 1), 0) = 0;

NOTIFY pgrst, 'reload schema';
