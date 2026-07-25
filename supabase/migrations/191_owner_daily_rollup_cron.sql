-- 191_owner_daily_rollup_cron.sql
-- Keep the owner analytics rollup (migration 190) fresh: rebuild it nightly so its
-- watermark keeps advancing and the live tail stays ~2 days small.
--
-- Kept SEPARATE from 190 so the core fix stands even if a given Supabase project can't
-- enable pg_cron -- the rollup is still correct on backfill, it just wouldn't auto-age.
-- Idempotent: cron.schedule() upserts by job name.
--
-- 00:20 UTC = 05:50 IST daily, just after the 05:00 IST business-day rollover. Timing
-- is not critical (the watermark is always today_IST-2), it just needs to run ~daily.

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'refresh-owner-daily-agg',
  '20 0 * * *',
  $$SELECT public.lfh_refresh_orders_daily_agg();$$
);
