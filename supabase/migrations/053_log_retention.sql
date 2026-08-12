-- 053_log_retention.sql — auto-delete old LOG rows on a timer, so log storage
-- never grows without bound. Two independent retentions (operation log vs the
-- customer-activity log), a once-a-day cleanup job, and a forward-compat "actor"
-- column on the operation log for the staff-login work coming later.
--
-- IMPORTANT (owner's rule): LOGS ARE NOT BILLS. This cleanup ONLY ever touches
-- activity/log rows (staff_actions, feedback, waiter_calls, guest visit rows).
-- It NEVER deletes from `orders` (the bills / sales history) or `customers`
-- (the saved customer profiles). Those are kept forever by this job.

-- ── 1. Retention settings (in days) ──────────────────────────────────────────
-- Default 90 = "3 months", which is also the MAX the UI offers. Backfills the
-- existing settings row to 90 automatically.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS oplog_retention_days   INTEGER NOT NULL DEFAULT 90;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS custlog_retention_days INTEGER NOT NULL DEFAULT 90;

-- ── 2. Forward-compat "who did it" on the operation log ──────────────────────
-- No per-staff login yet (the owner is adding it). This nullable column is the
-- ready slot: once login lands, logAction() can fill it and the log shows the
-- staff member's name. Until then it stays NULL and the log shows panel+device.
ALTER TABLE staff_actions ADD COLUMN IF NOT EXISTS actor TEXT;

-- ── 3. The cleanup function ──────────────────────────────────────────────────
-- Reads the two retention settings, clamps them to 1..90 days, then deletes
-- anything older. SECURITY DEFINER so the daily job runs with full rights; the
-- search_path is pinned so it can't be tricked into hitting the wrong tables.
CREATE OR REPLACE FUNCTION lfh_prune_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op   INTEGER;
  v_cust INTEGER;
BEGIN
  SELECT COALESCE(oplog_retention_days, 90), COALESCE(custlog_retention_days, 90)
    INTO v_op, v_cust
    FROM settings WHERE id = 'site';

  -- Belt-and-braces clamp (the UI clamps too): never < 1 day, never > 90 days.
  v_op   := GREATEST(1, LEAST(COALESCE(v_op, 90), 90));
  v_cust := GREATEST(1, LEAST(COALESCE(v_cust, 90), 90));

  -- Operation log: a clean standalone audit table — prune fully by age.
  DELETE FROM staff_actions
   WHERE created_at < now() - (v_op || ' days')::interval;

  -- Customer-ACTIVITY log = feedback + waiter calls + guest visit rows. These
  -- are activity records, NOT bills, so they're safe to prune.
  DELETE FROM feedback
   WHERE created_at < now() - (v_cust || ' days')::interval;

  DELETE FROM waiter_calls
   WHERE created_at < now() - (v_cust || ' days')::interval;

  -- Guest visit rows: only prune ones whose table session is NOT still open, so
  -- a guest sitting at a long-running open table is never deleted out from under
  -- a live meal. (orders.member_id is a plain column, not a foreign key, so the
  -- guest's bills are untouched — they simply keep the old id.)
  DELETE FROM session_members sm
   WHERE sm.joined_at < now() - (v_cust || ' days')::interval
     AND NOT EXISTS (
       SELECT 1 FROM sessions s
        WHERE s.id = sm.session_id AND s.status <> 'closed'
     );
END;
$$;

-- Staff-only: this must never be callable by the public/anon key (migration 038
-- gotcha — new functions are PUBLIC-executable by default).
REVOKE ALL ON FUNCTION lfh_prune_logs() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_prune_logs() TO service_role;

-- ── 4. Schedule it once a day (best-effort) ──────────────────────────────────
-- Uses pg_cron so the cleanup runs server-side on its own — it NEVER runs on a
-- page load or login, so opening the logs is always instant with zero added
-- load. Wrapped so that if the platform ever blocks pg_cron, the migration still
-- succeeds (the function above stays usable; we'd trigger it another way).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  -- Replace any previous copy of our job, then (re)create it for 04:00 daily.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lfh-prune-logs') THEN
    PERFORM cron.unschedule('lfh-prune-logs');
  END IF;
  PERFORM cron.schedule('lfh-prune-logs', '0 4 * * *', 'SELECT public.lfh_prune_logs();');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped (%) — function still installed', SQLERRM;
END
$$;
