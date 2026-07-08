-- 152_prune_logs_per_restaurant.sql — make the nightly log cleanup PER-RESTAURANT.
--
-- ⚠ MIGRATION NUMBER: 152 is the next free slot after 151 (login_throttle). This
-- repo has hit numbering collisions when parallel sessions grab the same number.
-- If another branch already took 152, renumber this file to the next free slot —
-- the body is a plain CREATE OR REPLACE + re-GRANT, so it stays correct at ANY
-- number and can run after the others with no conflict.
--
-- THE BUG (B4): lfh_prune_logs() (migration 053) read the retention window from
-- ONLY restaurant #1's settings row (`WHERE id = 'site'`) and then DELETEd from
-- staff_actions / feedback / waiter_calls / session_members with NO restaurant_id
-- filter. Since `settings` became one-row-per-restaurant (migration 079,
-- UNIQUE (restaurant_id)) and the manager "Keep logs for …" control writes each
-- restaurant's OWN oplog_retention_days / custlog_retention_days (in DAYS), that
-- meant:
--   • a non-#1 restaurant's "keep logs for N days" choice did nothing — it was
--     never consulted; and
--   • restaurant #1's choice pruned EVERY restaurant's logs + guest ratings.
-- Migration 085 already flagged this and deferred it: "the correct fix is to LOOP
-- over restaurants applying each one's retention — a redesign, not a read swap."
-- This migration is that fix.
--
-- THE FIX: loop over every restaurant, read THAT restaurant's retention (falling
-- back to the 90-day default when it has no settings row or a NULL value), and
-- delete only that restaurant's aged rows, scoped `WHERE restaurant_id = <that
-- one>`. Same tables, same "LOGS ARE NOT BILLS" guarantee (never touches `orders`
-- or `customers`), same 1..90-day clamp, same SECURITY DEFINER + pinned
-- search_path + grants as migration 053.
--
-- Purely ADDITIVE & IDEMPOTENT: a plain CREATE OR REPLACE swaps the body in place
-- under the SAME function name, so the existing daily 04:00 pg_cron job from
-- migration 053 (`SELECT public.lfh_prune_logs()`) keeps calling it unchanged —
-- no re-schedule needed. Safe to run more than once.

CREATE OR REPLACE FUNCTION lfh_prune_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r      RECORD;
  v_op   INTEGER;   -- this restaurant's operation-log retention (days)
  v_cust INTEGER;   -- this restaurant's customer-log retention  (days)
BEGIN
  -- One pass per restaurant. LEFT JOIN settings so a restaurant WITHOUT a settings
  -- row (unconfigured) still gets the safe 90-day default rather than being skipped
  -- and its old logs never cleaned. `settings` has an FK to restaurants (mig 078),
  -- so iterating restaurants covers every log row (each carries a real restaurant_id).
  FOR r IN
    SELECT rest.id                  AS rid,
           s.oplog_retention_days   AS op_days,
           s.custlog_retention_days AS cust_days
      FROM restaurants rest
      LEFT JOIN settings s ON s.restaurant_id = rest.id
  LOOP
    -- Belt-and-braces clamp (the UI clamps too): never < 1 day, never > 90 days,
    -- default 90 when unset. Identical rule to migration 053, applied PER restaurant.
    v_op   := GREATEST(1, LEAST(COALESCE(r.op_days,   90), 90));
    v_cust := GREATEST(1, LEAST(COALESCE(r.cust_days, 90), 90));

    -- Operation log: a clean standalone audit table — prune fully by age, scoped
    -- to THIS restaurant. Uses the (restaurant_id, created_at) index (mig 098).
    DELETE FROM staff_actions
     WHERE restaurant_id = r.rid
       AND created_at < now() - make_interval(days => v_op);

    -- Customer-ACTIVITY log = feedback + waiter calls + guest visit rows. These are
    -- activity records, NOT bills, so they're safe to prune — scoped to THIS
    -- restaurant. (feedback has a (restaurant_id, created_at) index, mig 140.)
    DELETE FROM feedback
     WHERE restaurant_id = r.rid
       AND created_at < now() - make_interval(days => v_cust);

    DELETE FROM waiter_calls
     WHERE restaurant_id = r.rid
       AND created_at < now() - make_interval(days => v_cust);

    -- Guest visit rows: only prune ones whose table session is NOT still open, so a
    -- guest sitting at a long-running open table is never deleted out from under a
    -- live meal. (orders.member_id is a plain column, not a foreign key, so the
    -- guest's bills are untouched — they simply keep the old id.)
    DELETE FROM session_members sm
     WHERE sm.restaurant_id = r.rid
       AND sm.joined_at < now() - make_interval(days => v_cust)
       AND NOT EXISTS (
         SELECT 1 FROM sessions s
          WHERE s.id = sm.session_id AND s.status <> 'closed'
       );
  END LOOP;
END;
$$;

-- Staff-only: this must never be callable by the public/anon key (migration 038
-- gotcha — new/replaced functions are PUBLIC-executable by default). Re-assert the
-- SAME grants migration 053 used so a plain CREATE OR REPLACE can never widen who
-- may run this housekeeping job.
REVOKE ALL ON FUNCTION lfh_prune_logs() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_prune_logs() TO service_role;

-- No pg_cron change: migration 053 already scheduled 'lfh-prune-logs' to run
-- SELECT public.lfh_prune_logs() daily at 04:00, and this replaces the body under
-- the same name. Nudge PostgREST to re-read the schema for good measure.
NOTIFY pgrst, 'reload schema';
