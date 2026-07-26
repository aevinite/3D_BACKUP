-- 201_owner_report_monthly_rollup.sql
--
-- Makes the WIDE owner reports (12-month / FY / all-time, GROUP scope) open INSTANTLY.
-- lfh_owner_sales_report at p_bucket='month' used to re-scan all ~398k orders on every
-- cold compute (~10s for the all-restaurants all-time report; the compute-on-view cache
-- then held it 5 min, but the FIRST open still stalled). Per CLAUDE.md ("dashboards read
-- pre-aggregated summary tables, never live full scans"), the month bucket now reads a
-- small PRE-AGGREGATED per-(restaurant, IST-month) table + a live tail for the current
-- unfrozen month. Day / hour / any other bucket is UNCHANGED (short ranges, already fast:
-- per-restaurant all-time month was 102ms; only GROUP all-time month was the ~10s case).
--
-- No signature / GRANT / returned-number change: this only swaps the month bucket's
-- INTERNALS, so the /api/owner/reports route is untouched and needs no redeploy.
--
-- Effective-date basis: the report recognises a khata (pay-later) order on its PAID day
-- (paid_at) and every other order on created_at -- IDENTICAL to the existing function's
--   eff = CASE WHEN khata_at IS NOT NULL AND paid_at IS NOT NULL THEN paid_at ELSE created_at END
-- The rollup buckets by month(eff) and the tail re-derives eff live, so numbers match to
-- the penny. Revenue/tax are stored as LINEAR COMPONENTS (SUM total, subtotal, discount)
-- and reconstructed on read with the LIVE effective tax rate -- never baked in (same trick
-- as migration 190), so a tax-rate change still reprices history.
--
-- Freshness = "frozen months + live tail":
--   * watermark rolled_through_month = first-of-month of the last FULLY-frozen month,
--     kept 1 month behind the current IST month (the current month stays live).
--   * read = rollup rows (month <= watermark) UNION a live scan of orders whose eff-date is
--     in the still-live month(s) (eff >= tail_start). The tail is index-seeked by created_at
--     (+ a partial paid_at index for the rare khata order paid a later month than made).
--   * partitions every order by eff-month exactly once -> no gap, no double count; self-heals
--     if the nightly refresh is late (the tail just covers more months).
--   * SAFETY FENCE: the rollup path is used ONLY when the request's p_to lands in a still-live
--     month (p_to > tail_start) -- which is every "…to now" wide report. A range that ENDS
--     inside a frozen month (only reachable via a custom picker) transparently falls back to
--     the original live scan, so a whole-month rollup row is never used for a partial month.

-- ── 1. rollup table + watermark ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orders_report_monthly_agg (
  restaurant_id uuid    NOT NULL,
  month         date    NOT NULL,   -- first day of the IST calendar month of the eff-date
  paid_orders   bigint  NOT NULL DEFAULT 0,   -- COUNT filter(non-cancelled AND paid)
  all_orders    bigint  NOT NULL DEFAULT 0,   -- COUNT filter(non-cancelled)
  canc_orders   bigint  NOT NULL DEFAULT 0,   -- COUNT filter(cancelled)
  gross_paid    numeric NOT NULL DEFAULT 0,   -- SUM(total)    filter(non-cancelled AND paid)
  sub_paid      numeric NOT NULL DEFAULT 0,   -- SUM(subtotal) filter(non-cancelled AND paid)
  disc_paid     numeric NOT NULL DEFAULT 0,   -- SUM(discount) filter(non-cancelled AND paid)
  gross_canc    numeric NOT NULL DEFAULT 0,   -- SUM(total)    filter(cancelled)
  disc_canc     numeric NOT NULL DEFAULT 0,   -- SUM(discount) filter(cancelled)
  PRIMARY KEY (restaurant_id, month)
);
CREATE INDEX IF NOT EXISTS idx_orders_report_monthly_agg_month
  ON public.orders_report_monthly_agg (month, restaurant_id);

CREATE TABLE IF NOT EXISTS public.orders_report_monthly_agg_state (
  only_one             boolean PRIMARY KEY DEFAULT true CHECK (only_one),
  rolled_through_month date    NOT NULL DEFAULT '2000-01-01'
);
INSERT INTO public.orders_report_monthly_agg_state (only_one) VALUES (true) ON CONFLICT DO NOTHING;

REVOKE ALL ON public.orders_report_monthly_agg       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.orders_report_monthly_agg_state FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.orders_report_monthly_agg       TO service_role;
GRANT  ALL ON public.orders_report_monthly_agg_state TO service_role;

-- The rare khata order paid a later month than it was created: the tail seeks these by
-- paid_at instead of scanning the whole table. Tiny partial index (khata orders are few).
CREATE INDEX IF NOT EXISTS idx_orders_khata_paid_at
  ON public.orders (paid_at)
  WHERE khata_at IS NOT NULL AND paid_at IS NOT NULL;

-- ── 2. refresh: rebuild frozen months (<= current IST month - 1), advance watermark ─
-- One function = one transaction, so readers never see a half-empty table.
CREATE OR REPLACE FUNCTION public.lfh_refresh_orders_report_monthly_agg()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- freeze every month strictly BEFORE the current IST month; keep the current month live.
  v_target date := (date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')) - interval '1 month')::date;
BEGIN
  DELETE FROM public.orders_report_monthly_agg;
  INSERT INTO public.orders_report_monthly_agg
    (restaurant_id, month, paid_orders, all_orders, canc_orders,
     gross_paid, sub_paid, disc_paid, gross_canc, disc_canc)
  SELECT o.restaurant_id,
         date_trunc('month',
           (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END)
             AT TIME ZONE 'Asia/Kolkata')::date                                              AS month,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'),
         COUNT(*) FILTER (WHERE o.status <> 'cancelled'),
         COUNT(*) FILTER (WHERE o.status =  'cancelled'),
         COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0),
         COALESCE(SUM(o.subtotal) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0),
         COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0),
         COALESCE(SUM(o.total)    FILTER (WHERE o.status =  'cancelled'), 0),
         COALESCE(SUM(o.discount) FILTER (WHERE o.status =  'cancelled'), 0)
  FROM public.orders o
  WHERE date_trunc('month',
          (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END)
            AT TIME ZONE 'Asia/Kolkata')::date <= v_target
  GROUP BY 1, 2;

  UPDATE public.orders_report_monthly_agg_state SET rolled_through_month = v_target WHERE only_one;
END;
$function$;
REVOKE ALL ON FUNCTION public.lfh_refresh_orders_report_monthly_agg() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_refresh_orders_report_monthly_agg() TO service_role;

-- ── 3. backfill now ─────────────────────────────────────────────────────────────
SELECT public.lfh_refresh_orders_report_monthly_agg();

-- ── 4. rewrite lfh_owner_sales_report: month bucket = rollup + live tail ─────────
-- Exactly one path does real work per call, fenced by empty index ranges (mig-190 style):
--   * use_rollup = (bucket='month' AND p_to lands in a live month) -> hist + mtail run,
--     live_rows is fenced to created_at >= +infinity (empty probe).
--   * otherwise -> live_rows runs the ORIGINAL scan, hist is fenced to month <= -infinity
--     and mtail to created_at >= +infinity (both empty).
CREATE OR REPLACE FUNCTION public.lfh_owner_sales_report(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_bucket text)
 RETURNS TABLE(bucket timestamp with time zone, orders bigint, paid_orders bigint, subtotal numeric, tax numeric, discount numeric, revenue numeric, cancelled_orders bigint, cancelled_value numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '128MB'
 SET plan_cache_mode TO 'force_custom_plan'
 SET statement_timeout TO '25s'
AS $function$
  WITH
  params AS (SELECT COALESCE(NULLIF(p_bucket, ''), 'day') AS b),
  rates  AS MATERIALIZED (SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r),
  -- the restaurant id-set as ONE array value (a single-row CTE); referenced as a scalar
  -- subquery `(SELECT arr FROM ids)` so `= ANY(<array>)` gets the array, not a row-set.
  ids    AS (SELECT (CASE WHEN p_restaurant_id IS NOT NULL THEN ARRAY[p_restaurant_id]
                          ELSE (SELECT array_agg(id) FROM restaurants) END) AS arr),
  wm     AS (SELECT s.rolled_through_month,
                    ((date_trunc('month', s.rolled_through_month) + interval '1 month')::timestamp
                        AT TIME ZONE 'Asia/Kolkata') AS tail_start
             FROM orders_report_monthly_agg_state s),
  -- only accelerate a month report that ends in a still-live month (every "…to now" report)
  fences AS (
    SELECT ((SELECT b FROM params) = 'month' AND p_to > (SELECT tail_start FROM wm)) AS use_rollup
  ),
  bounds AS (
    SELECT
      CASE WHEN (SELECT use_rollup FROM fences) THEN (SELECT rolled_through_month FROM wm) ELSE '-infinity'::date        END AS hist_max_month,
      CASE WHEN (SELECT use_rollup FROM fences) THEN (SELECT tail_start FROM wm)           ELSE  'infinity'::timestamptz  END AS mtail_start,
      CASE WHEN (SELECT use_rollup FROM fences) THEN  'infinity'::timestamptz              ELSE '-infinity'::timestamptz  END AS live_min_created
  ),
  -- frozen months from the rollup
  hist AS (
    SELECT a.restaurant_id, a.month,
           a.all_orders ao, a.paid_orders po, a.canc_orders co,
           a.gross_paid gp, a.sub_paid sp, a.disc_paid dp, a.gross_canc gc, a.disc_canc dc
    FROM orders_report_monthly_agg a CROSS JOIN ids
    WHERE a.month <= (SELECT hist_max_month FROM bounds)
      AND a.month >= date_trunc('month', (p_from AT TIME ZONE 'Asia/Kolkata'))::date
      AND a.restaurant_id = ANY (ids.arr)
  ),
  -- live tail for the current unfrozen month(s), re-derives eff-date + measures
  mtail AS (
    SELECT o.restaurant_id,
           date_trunc('month',
             (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END)
               AT TIME ZONE 'Asia/Kolkata')::date AS month,
           COUNT(*) FILTER (WHERE o.status <> 'cancelled')                              ao,
           COUNT(*) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid') po,
           COUNT(*) FILTER (WHERE o.status =  'cancelled')                              co,
           COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) gp,
           COALESCE(SUM(o.subtotal) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) sp,
           COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dp,
           COALESCE(SUM(o.total)    FILTER (WHERE o.status =  'cancelled'), 0) gc,
           COALESCE(SUM(o.discount) FILTER (WHERE o.status =  'cancelled'), 0) dc
    FROM orders o CROSS JOIN ids
    WHERE (o.created_at >= (SELECT mtail_start FROM bounds)
           OR (o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL AND o.paid_at >= (SELECT mtail_start FROM bounds)))
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) <  p_to
      AND o.restaurant_id = ANY (ids.arr)
    GROUP BY 1, 2
  ),
  mcomb AS (
    SELECT restaurant_id, month,
           SUM(ao) ao, SUM(po) po, SUM(co) co,
           SUM(gp) gp, SUM(sp) sp, SUM(dp) dp, SUM(gc) gc, SUM(dc) dc
    FROM (SELECT * FROM hist UNION ALL SELECT * FROM mtail) u
    GROUP BY restaurant_id, month
  ),
  month_rows AS (
    SELECT (c.month::timestamp AT TIME ZONE 'Asia/Kolkata')            AS bucket,
           SUM(c.ao)::bigint                                            AS orders,
           SUM(c.po)::bigint                                            AS paid_orders,
           COALESCE(SUM(c.sp), 0)::numeric                              AS subtotal,
           COALESCE(SUM(c.gp - c.sp - c.dp * rt.rate), 0)::numeric      AS tax,
           COALESCE(SUM(c.dp), 0)::numeric                              AS discount,
           COALESCE(SUM(c.gp - c.dp * (1 + rt.rate)), 0)::numeric       AS revenue,
           SUM(c.co)::bigint                                            AS cancelled_orders,
           COALESCE(SUM(c.gc - c.dc * (1 + rt.rate)), 0)::numeric       AS cancelled_value
    FROM mcomb c JOIN rates rt ON rt.rid = c.restaurant_id
    GROUP BY c.month
  ),
  -- the ORIGINAL live aggregation, fenced OFF (empty created_at probe) when use_rollup
  live_rows AS (
    SELECT date_trunc(COALESCE(NULLIF(p_bucket, ''), 'day'),
                      (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
           COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint,
           COUNT(*) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid')::bigint,
           COALESCE(SUM(o.subtotal) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
           COALESCE(SUM(o.total - o.subtotal - o.discount * rt.rate) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
           COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
           COALESCE(SUM(o.total - o.discount * (1 + rt.rate)) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
           COUNT(*) FILTER (WHERE o.status = 'cancelled')::bigint,
           COALESCE(SUM(o.total - o.discount * (1 + rt.rate)) FILTER (WHERE o.status = 'cancelled'), 0)::numeric
    FROM orders o
    JOIN rates rt ON rt.rid = o.restaurant_id
    CROSS JOIN ids
    WHERE o.created_at >= (SELECT live_min_created FROM bounds)   -- +infinity => empty when use_rollup
      AND o.restaurant_id = ANY (ids.arr)
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) <  p_to
    GROUP BY 1
  )
  SELECT * FROM month_rows
  UNION ALL
  SELECT * FROM live_rows
  ORDER BY 1;
$function$;
REVOKE ALL ON FUNCTION public.lfh_owner_sales_report(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_sales_report(uuid, timestamptz, timestamptz, text) TO service_role;

-- ── 5. nightly refresh (pg_cron) — 00:25 UTC, just after the daily-agg job ───────
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'refresh-owner-report-monthly-agg',
  '25 0 * * *',
  $$SELECT public.lfh_refresh_orders_report_monthly_agg();$$
);
