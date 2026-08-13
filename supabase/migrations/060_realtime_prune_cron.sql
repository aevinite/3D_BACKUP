-- 060_realtime_prune_cron.sql  (Realtime Stage 2 — guaranteed breadcrumb cleanup)
--
-- The breadcrumb table is already self-bounding: rows only appear when something
-- changes, and the emit trigger prunes (>15 min old) ~1% of the time. But to
-- GUARANTEE the table never lingers — even if activity stops right after a burst —
-- schedule a pg_cron sweep every 10 minutes. pg_cron 1.6.4 is installed.
--
-- Breadcrumbs carry no history value (we always refetch the real data), so a tight
-- 15-minute window is plenty; the audit trail lives in staff_actions, not here.

-- Re-create the job idempotently: drop any existing one with this name first.
DO $$
BEGIN
  PERFORM cron.unschedule('lfh-rt-prune')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lfh-rt-prune');
EXCEPTION WHEN OTHERS THEN
  -- pg_cron not available / different version — the opportunistic prune still runs.
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule('lfh-rt-prune', '*/10 * * * *', 'SELECT lfh_rt_prune();');
EXCEPTION WHEN OTHERS THEN
  NULL; -- safe to skip; opportunistic prune in lfh_rt_emit() keeps the table tiny
END $$;
