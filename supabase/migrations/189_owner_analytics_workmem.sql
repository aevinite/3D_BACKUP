-- 188_owner_analytics_workmem.sql
-- Stops the owner dashboard "canceling statement due to statement timeout" on the
-- "All restaurants / All time" view.
--
-- ROOT CAUSE (measured on the dev DB at ~398k orders, 2026-07-25):
--   The lfh_owner_* analytics functions aggregate the whole orders history live.
--   Postgres' default work_mem (4MB) is far too small for those GROUP BY / hash
--   aggregates, so they SPILL ~75-340MB to disk mid-query. The disk step makes the
--   SAME query swing wildly (measured 2.4s .. 6.7s for the identical all-time
--   timeseries), and a cold run under real concurrent load tips past the DB's 8s
--   statement_timeout -> the red "Couldn't load" banner.
--
--   Giving these low-frequency analytics functions more working memory removes the
--   spill entirely: every heavy all-time query then runs in a STABLE ~2-3.4s with no
--   disk I/O and no variance (measured: 96MB = zero spill on all four heavy calls).
--
-- This is a pure execution-tuning change: NO change to the SQL, the math, or any
-- returned number. Function-level SET work_mem applies only while these functions run
-- (they poll ~every 60s for a handful of owners/admin -- not a hot path), so the extra
-- RAM is transient and bounded. Reversible: RESET work_mem on each function.
--
-- This is the IMMEDIATE fix. The DURABLE fix for real scale (millions of orders /
-- many restaurants) is a pre-aggregated daily revenue rollup so the portfolio
-- dashboard reads a few hundred pre-summed rows instead of scanning raw orders --
-- tracked as the follow-up, per CLAUDE.md "dashboards read pre-aggregated summary
-- tables, never live scans".

ALTER FUNCTION public.lfh_owner_overview(uuid[])                                              SET work_mem = '128MB';
ALTER FUNCTION public.lfh_owner_restaurant_revenue(timestamptz, timestamptz, uuid[])         SET work_mem = '128MB';
ALTER FUNCTION public.lfh_owner_revenue_timeseries(uuid, timestamptz, timestamptz, text, uuid[]) SET work_mem = '128MB';
ALTER FUNCTION public.lfh_owner_payment_breakdown(uuid, timestamptz, timestamptz)            SET work_mem = '128MB';
ALTER FUNCTION public.lfh_owner_dish_breakdown(uuid, timestamptz, timestamptz)               SET work_mem = '128MB';
ALTER FUNCTION public.lfh_owner_category_breakdown(uuid, timestamptz, timestamptz)           SET work_mem = '128MB';
ALTER FUNCTION public.lfh_owner_hourly(uuid, timestamptz, timestamptz)                       SET work_mem = '128MB';
ALTER FUNCTION public.lfh_owner_payment_trend(uuid, timestamptz, timestamptz)                SET work_mem = '128MB';
ALTER FUNCTION public.lfh_owner_records(uuid)                                                SET work_mem = '128MB';
ALTER FUNCTION public.lfh_owner_sales_report(uuid, timestamptz, timestamptz, text)           SET work_mem = '128MB';
ALTER FUNCTION public.lfh_owner_samehour_compare(uuid, timestamptz[], interval)              SET work_mem = '128MB';
