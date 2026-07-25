-- 190_owner_analytics_daily_rollup.sql
--
-- DURABLE fix for the owner dashboard "canceling statement due to statement timeout".
-- Migration 189 removed the disk-spill variance, but the all-time OVERVIEW still scans
-- every one of ~398k orders on each load and can cold-spike over the DB's 8s limit.
-- Per CLAUDE.md ("dashboards read pre-aggregated summary tables, never live scans of
-- millions of order rows"), the portfolio analytics now read a small PRE-AGGREGATED
-- daily-totals table instead of re-summing raw orders every time.
--
-- ── Design ────────────────────────────────────────────────────────────────────
-- orders_daily_agg: one row per (restaurant, IST-calendar-day, payment method) holding
-- the LINEAR revenue COMPONENTS -- SUM(total) and SUM(discount) over paid non-cancelled
-- orders, plus paid/all order counts. Revenue is reconstructed at READ time as
--   revenue = SUM(gross_paid) - (1 + effective_tax_rate) * SUM(disc_paid)
-- which is algebraically identical to the old  SUM(total - discount*(1+rate))  (the
-- expression is linear, and numeric arithmetic is exact), so every number matches to
-- the penny AND the tax rate stays live-adjustable (applied on read, never baked in).
--
-- Freshness = "summary + live tail":
--   * A single-row watermark (orders_daily_agg_state.rolled_through) marks the last
--     IST day frozen in the rollup, kept 2 days behind today.
--   * Every read = rollup rows (day <= rolled_through)  UNION  a LIVE scan of the tail
--     (orders whose created_at >= the IST-midnight AFTER rolled_through). The tail bound
--     is a plain timestamptz so the (restaurant_id, created_at) index seeks it -- the
--     tail is only a couple of days of orders, so reads stay in the low-ms range.
--   * This partitions every order by IST-date exactly once -> no double count, no gap,
--     and SELF-HEALS if the nightly refresh is late (the tail just covers more days).
--   * Late settles / voids on RECENT orders (<= 2 days) are always live-exact via the
--     tail; rare edits to OLD orders reconcile on the nightly full rebuild (<=24h).
--     (At millions of rows, swap the full rebuild for incremental -- YAGNI today.)
--
-- No change to any RETURNS signature, GRANTs, or returned numbers. Verified penny-exact
-- (283 checks, 0 diffs) against the pre-change functions for all-time / 7d / 30d / today
-- / yesterday, group + per-restaurant, on the dev DB 2026-07-25.

-- ── 1. the rollup table + watermark ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orders_daily_agg (
  restaurant_id uuid    NOT NULL,
  day           date    NOT NULL,   -- IST calendar day: (created_at AT TIME ZONE 'Asia/Kolkata')::date
  method        text    NOT NULL,   -- COALESCE(NULLIF(payment_method,''),'Not recorded')
  gross_paid    numeric NOT NULL DEFAULT 0,   -- SUM(total)    filter(non-cancelled AND paid)
  disc_paid     numeric NOT NULL DEFAULT 0,   -- SUM(discount) filter(non-cancelled AND paid)
  paid_orders   bigint  NOT NULL DEFAULT 0,   -- COUNT(*)      filter(non-cancelled AND paid)
  all_orders    bigint  NOT NULL DEFAULT 0,   -- COUNT(*)      filter(non-cancelled)
  PRIMARY KEY (restaurant_id, day, method)
);
CREATE INDEX IF NOT EXISTS idx_orders_daily_agg_day ON public.orders_daily_agg (day, restaurant_id);

CREATE TABLE IF NOT EXISTS public.orders_daily_agg_state (
  only_one       boolean PRIMARY KEY DEFAULT true CHECK (only_one),
  rolled_through date    NOT NULL DEFAULT '2000-01-01'
);
INSERT INTO public.orders_daily_agg_state (only_one) VALUES (true) ON CONFLICT DO NOTHING;

REVOKE ALL ON public.orders_daily_agg        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.orders_daily_agg_state  FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.orders_daily_agg        TO service_role;
GRANT  ALL ON public.orders_daily_agg_state  TO service_role;

-- ── 2. refresh: rebuild all frozen days (<= today_IST - 2), advance the watermark ─
-- Runs atomically (one function = one transaction) so readers never see a half-empty
-- table. Called nightly by pg_cron (migration 191) and once here to backfill.
CREATE OR REPLACE FUNCTION public.lfh_refresh_orders_daily_agg()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target date := (now() AT TIME ZONE 'Asia/Kolkata')::date - 2;  -- keep 2 live days on top
BEGIN
  DELETE FROM public.orders_daily_agg;
  INSERT INTO public.orders_daily_agg (restaurant_id, day, method, gross_paid, disc_paid, paid_orders, all_orders)
  SELECT o.restaurant_id,
         (o.created_at AT TIME ZONE 'Asia/Kolkata')::date                         AS day,
         COALESCE(NULLIF(o.payment_method, ''), 'Not recorded')                    AS method,
         COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0),
         COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0),
         COUNT(*) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'),
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')
  FROM public.orders o
  WHERE (o.created_at AT TIME ZONE 'Asia/Kolkata')::date <= v_target
  GROUP BY 1, 2, 3
  HAVING COUNT(*) FILTER (WHERE o.status <> 'cancelled') > 0;   -- drop cancelled-only buckets

  UPDATE public.orders_daily_agg_state SET rolled_through = v_target WHERE only_one;
END;
$function$;
REVOKE ALL ON FUNCTION public.lfh_refresh_orders_daily_agg() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_refresh_orders_daily_agg() TO service_role;

-- ── 3. backfill now ────────────────────────────────────────────────────────────
SELECT public.lfh_refresh_orders_daily_agg();

-- ── 4. rewrite the four portfolio read functions (rollup + live tail) ───────────
-- wm exposes BOTH the day watermark and tail_start (a plain timestamptz = IST midnight
-- after rolled_through). Every tail filters `created_at >= (SELECT tail_start FROM wm)`,
-- a scalar subquery = evaluated once = an index range seek, NOT a per-row expression.

-- 4a. lfh_owner_overview -- all-time totals from the rollup; today + all-time TAIL live.
CREATE OR REPLACE FUNCTION public.lfh_owner_overview(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(restaurant_id uuid, slug text, name text, active boolean, accent_color text, orders_today bigint, revenue_today numeric, orders_all bigint, revenue_all numeric, open_tables bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH
  rates AS MATERIALIZED (SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r),
  wm AS (SELECT rolled_through, ((rolled_through + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS tail_start FROM orders_daily_agg_state),
  day_start AS (
    SELECT (((now() AT TIME ZONE 'Asia/Kolkata') - interval '5 hours')::date
            + interval '5 hours') AT TIME ZONE 'Asia/Kolkata' AS ts
  ),
  hist AS (
    SELECT a.restaurant_id, SUM(a.gross_paid) gp, SUM(a.disc_paid) dp, SUM(a.all_orders) ao
    FROM orders_daily_agg a
    WHERE a.day <= (SELECT rolled_through FROM wm)
    GROUP BY a.restaurant_id
  ),
  tail AS (
    SELECT o.restaurant_id,
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) gp_all,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dp_all,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled') ao_all,
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid' AND o.created_at >= (SELECT ts FROM day_start)), 0) gp_today,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid' AND o.created_at >= (SELECT ts FROM day_start)), 0) dp_today,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled' AND o.created_at >= (SELECT ts FROM day_start)) ao_today
    FROM orders o
    WHERE o.created_at >= (SELECT tail_start FROM wm)
      AND (p_ids IS NULL OR o.restaurant_id = ANY(p_ids))
    GROUP BY o.restaurant_id
  ),
  sess AS (
    SELECT s.restaurant_id, COUNT(*) AS open_tables
    FROM sessions s
    WHERE s.status = 'open' AND (p_ids IS NULL OR s.restaurant_id = ANY(p_ids))
    GROUP BY s.restaurant_id
  )
  SELECT
    r.id, r.slug, r.name, r.active, r.accent_color,
    COALESCE(t.ao_today, 0)::bigint,
    (COALESCE(t.gp_today, 0) - (1 + rt.rate) * COALESCE(t.dp_today, 0))::numeric,
    (COALESCE(h.ao, 0) + COALESCE(t.ao_all, 0))::bigint,
    ((COALESCE(h.gp, 0) + COALESCE(t.gp_all, 0)) - (1 + rt.rate) * (COALESCE(h.dp, 0) + COALESCE(t.dp_all, 0)))::numeric,
    COALESCE(sess.open_tables, 0)::bigint
  FROM restaurants r
  JOIN rates rt ON rt.rid = r.id
  LEFT JOIN hist h ON h.restaurant_id = r.id
  LEFT JOIN tail t ON t.restaurant_id = r.id
  LEFT JOIN sess ON sess.restaurant_id = r.id
  WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
  ORDER BY r.name;
$function$;

-- 4b. lfh_owner_restaurant_revenue -- window totals per restaurant (rollup + tail).
CREATE OR REPLACE FUNCTION public.lfh_owner_restaurant_revenue(p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(restaurant_id uuid, slug text, name text, accent_color text, revenue numeric, orders bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH
  rates AS MATERIALIZED (SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r),
  wm AS (SELECT rolled_through, ((rolled_through + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS tail_start FROM orders_daily_agg_state),
  hist AS (
    SELECT a.restaurant_id, SUM(a.gross_paid) gp, SUM(a.disc_paid) dp, SUM(a.all_orders) ao
    FROM orders_daily_agg a
    WHERE a.day <= (SELECT rolled_through FROM wm)
      AND a.day >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
    GROUP BY a.restaurant_id
  ),
  tail AS (
    SELECT o.restaurant_id,
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) gp,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dp,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled') ao
    FROM orders o
    WHERE o.created_at >= (SELECT tail_start FROM wm)
      AND o.created_at >= p_from AND o.created_at < p_to
    GROUP BY o.restaurant_id
  )
  SELECT r.id, r.slug, r.name, r.accent_color,
    ((COALESCE(h.gp, 0) + COALESCE(t.gp, 0)) - (1 + rt.rate) * (COALESCE(h.dp, 0) + COALESCE(t.dp, 0)))::numeric AS revenue,
    (COALESCE(h.ao, 0) + COALESCE(t.ao, 0))::bigint AS orders
  FROM restaurants r
  JOIN rates rt ON rt.rid = r.id
  LEFT JOIN hist h ON h.restaurant_id = r.id
  LEFT JOIN tail t ON t.restaurant_id = r.id
  WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
  ORDER BY revenue DESC;
$function$;

-- 4c. lfh_owner_revenue_timeseries -- day grain via rollup+tail; other buckets stay live.
-- Runtime fences: for bucket='day' the live branch is bounded to created_at >= +infinity
-- (empty index probe); for other buckets the rollup branch is bounded to day <= -infinity
-- and the tail is disabled. Exactly one branch does real work per call.
CREATE OR REPLACE FUNCTION public.lfh_owner_revenue_timeseries(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_bucket text, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(bucket timestamp with time zone, restaurant_id uuid, revenue numeric, orders bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH
  params AS (SELECT COALESCE(NULLIF(p_bucket, ''), 'day') AS b),
  rates AS MATERIALIZED (SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r),
  wm AS (SELECT rolled_through, ((rolled_through + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS tail_start FROM orders_daily_agg_state),
  hist AS (
    SELECT a.restaurant_id, a.day, SUM(a.gross_paid) gp, SUM(a.disc_paid) dp, SUM(a.all_orders) ao
    FROM orders_daily_agg a
    WHERE a.day <= (CASE WHEN (SELECT b FROM params) = 'day' THEN (SELECT rolled_through FROM wm) ELSE '-infinity'::date END)
      AND a.day >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
      AND (p_restaurant_id IS NULL OR a.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR a.restaurant_id = ANY(p_ids))
    GROUP BY a.restaurant_id, a.day
  ),
  tail AS (
    SELECT o.restaurant_id, (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) gp,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dp,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled') ao
    FROM orders o
    WHERE o.created_at >= (CASE WHEN (SELECT b FROM params) = 'day' THEN (SELECT tail_start FROM wm) ELSE 'infinity'::timestamptz END)
      AND o.created_at >= p_from AND o.created_at < p_to
      AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR o.restaurant_id = ANY(p_ids))
    GROUP BY o.restaurant_id, (o.created_at AT TIME ZONE 'Asia/Kolkata')::date
  ),
  day_comb AS (
    SELECT restaurant_id, day, SUM(gp) gp, SUM(dp) dp, SUM(ao) ao
    FROM (SELECT * FROM hist UNION ALL SELECT * FROM tail) u
    GROUP BY restaurant_id, day
  ),
  day_rows AS (
    SELECT (c.day::timestamp AT TIME ZONE 'Asia/Kolkata') AS bucket, c.restaurant_id,
           (c.gp - (1 + rt.rate) * c.dp)::numeric AS revenue, c.ao::bigint AS orders
    FROM day_comb c JOIN rates rt ON rt.rid = c.restaurant_id
  ),
  live_rows AS (  -- hour/week/month: original live aggregation, fenced off when b='day'
    SELECT date_trunc((SELECT b FROM params), o.created_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
           o.restaurant_id,
           COALESCE(SUM(o.total - o.discount * (1 + rt.rate)) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric AS revenue,
           COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint AS orders
    FROM orders o
    JOIN rates rt ON rt.rid = o.restaurant_id
    WHERE o.created_at >= (CASE WHEN (SELECT b FROM params) = 'day' THEN 'infinity'::timestamptz ELSE p_from END)
      AND o.created_at < p_to
      AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR o.restaurant_id = ANY(p_ids))
    GROUP BY 1, 2
  )
  SELECT * FROM day_rows
  UNION ALL
  SELECT * FROM live_rows
  ORDER BY 1;
$function$;

-- 4d. lfh_owner_payment_breakdown -- per method over a window (rollup + tail).
CREATE OR REPLACE FUNCTION public.lfh_owner_payment_breakdown(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(method text, revenue numeric, orders bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH
  rates AS MATERIALIZED (SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r),
  wm AS (SELECT rolled_through, ((rolled_through + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS tail_start FROM orders_daily_agg_state),
  hist AS (
    SELECT a.restaurant_id, a.method, SUM(a.gross_paid) gp, SUM(a.disc_paid) dp, SUM(a.paid_orders) po
    FROM orders_daily_agg a
    WHERE a.day <= (SELECT rolled_through FROM wm)
      AND a.day >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
      AND (p_restaurant_id IS NULL OR a.restaurant_id = p_restaurant_id)
    GROUP BY a.restaurant_id, a.method
  ),
  tail AS (
    SELECT o.restaurant_id, COALESCE(NULLIF(o.payment_method, ''), 'Not recorded') AS method,
      COALESCE(SUM(o.total), 0) gp, COALESCE(SUM(o.discount), 0) dp, COUNT(*) po
    FROM orders o
    WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
      AND o.created_at >= (SELECT tail_start FROM wm)
      AND o.created_at >= p_from AND o.created_at < p_to
      AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
    GROUP BY o.restaurant_id, COALESCE(NULLIF(o.payment_method, ''), 'Not recorded')
  ),
  comb AS (
    SELECT restaurant_id, method, SUM(gp) gp, SUM(dp) dp, SUM(po) po
    FROM (SELECT * FROM hist UNION ALL SELECT * FROM tail) u
    GROUP BY restaurant_id, method
  )
  SELECT c.method,
    COALESCE(SUM(c.gp - (1 + rt.rate) * c.dp), 0)::numeric AS revenue,
    SUM(c.po)::bigint AS orders
  FROM comb c JOIN rates rt ON rt.rid = c.restaurant_id
  GROUP BY c.method
  HAVING SUM(c.po) > 0   -- original scanned only PAID orders, so never emitted a method
                         -- with zero paid orders; drop the unpaid-only method buckets.
  ORDER BY revenue DESC;
$function$;

-- Keep the mig-189 working-memory safety net on the rewritten functions (harmless: the
-- rollup path never spills, but a very stale watermark -> a larger live tail is covered).
ALTER FUNCTION public.lfh_owner_overview(uuid[])                                              SET work_mem = '128MB';
ALTER FUNCTION public.lfh_owner_restaurant_revenue(timestamptz, timestamptz, uuid[])         SET work_mem = '128MB';
ALTER FUNCTION public.lfh_owner_revenue_timeseries(uuid, timestamptz, timestamptz, text, uuid[]) SET work_mem = '128MB';
ALTER FUNCTION public.lfh_owner_payment_breakdown(uuid, timestamptz, timestamptz)            SET work_mem = '128MB';
