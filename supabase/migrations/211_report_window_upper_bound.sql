-- 211_report_window_upper_bound.sql
--
-- ONE owner-visible correctness bug (from the owner's Day-summary screenshot: a day with
-- ZERO sales showed ~₹3,008,383 of settlement / "money collected").
--
-- CAUSE — missing END-DATE bound in the daily-rollup readers. lfh_owner_payment_breakdown,
-- lfh_owner_restaurant_revenue and lfh_owner_revenue_timeseries read the frozen rollup
-- (orders_daily_agg) with `a.day >= p_from` but NO upper bound. So any window that ends
-- BEFORE the rollup watermark — a single past day, "yesterday", "last month" — silently
-- summed every rolled day from p_from all the way through the watermark. The Day summary's
-- settlement box was the loudest symptom (₹3.0M for a day whose actual sales were ₹0).
-- (The live tails already carry `created_at < p_to`, so only the rollup halves were wrong.)
--
-- FIX — add the symmetric upper bound `a.day < (p_to AT TIME ZONE 'Asia/Kolkata')::date` to
-- each hist CTE. It's sargable and strictly MORE restrictive (never slower), and correct for
-- every window: p_to is an IST-midnight boundary for past windows (so day D is included iff
-- the window reaches D+1), and a mid-day "…to now" p_to only ever drops today, which is never
-- frozen in the rollup anyway (the live tail owns it). Verified: a zero-sales past day now
-- returns ₹0 settlement, and settlement reconciles to sales_report to the rupee (dev DB).
--
-- Everything else in each function is preserved VERBATIM from the deployed defs (mig 190 for
-- revenue/timeseries, mig 203 for payment_breakdown with its p_ids grouped-call path). No
-- signature/GRANT change; CREATE OR REPLACE keeps ACLs (re-asserted anyway). NO change to the
-- rollup refresh or its buckets — pay-later (khata) paid-day attribution already lives in
-- lfh_owner_sales_report (mig 201), which is what the reports use.

-- ── lfh_owner_payment_breakdown (mig 203 + p_to bound) ──────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_payment_breakdown(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(method text, revenue numeric, orders bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '128MB'
AS $function$
  WITH
  rates AS MATERIALIZED (SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r),
  wm AS (SELECT rolled_through, ((rolled_through + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS tail_start FROM orders_daily_agg_state),
  hist AS (
    SELECT a.restaurant_id, a.method, SUM(a.gross_paid) gp, SUM(a.disc_paid) dp, SUM(a.paid_orders) po
    FROM orders_daily_agg a
    WHERE a.day <= (SELECT rolled_through FROM wm)
      AND a.day >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
      AND a.day <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date
      AND (p_restaurant_id IS NULL OR a.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR a.restaurant_id = ANY (p_ids))
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
      AND (p_ids IS NULL OR o.restaurant_id = ANY (p_ids))
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
  HAVING SUM(c.po) > 0
  ORDER BY revenue DESC;
$function$;
REVOKE ALL ON FUNCTION public.lfh_owner_payment_breakdown(uuid, timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_payment_breakdown(uuid, timestamptz, timestamptz, uuid[]) TO service_role;

-- ── lfh_owner_restaurant_revenue (mig 190 + p_to bound) ─────────────────────────
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
      AND a.day <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date
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
REVOKE ALL ON FUNCTION public.lfh_owner_restaurant_revenue(timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_restaurant_revenue(timestamptz, timestamptz, uuid[]) TO service_role;

-- ── lfh_owner_revenue_timeseries (mig 190 + p_to bound on the day-rollup hist) ──
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
      AND a.day <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date
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
REVOKE ALL ON FUNCTION public.lfh_owner_revenue_timeseries(uuid, timestamptz, timestamptz, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_revenue_timeseries(uuid, timestamptz, timestamptz, text, uuid[]) TO service_role;

-- ── restore the daily rollup's ORIGINAL created_at bucketing (mig 190, verbatim) ──
-- (Defensive: an interim build of THIS migration briefly rebuilt orders_daily_agg by the
-- khata effective date, which regressed dashboard read performance. This re-asserts the
-- committed created_at definition and rebuilds so the rollup matches the deployed engine.)
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
  HAVING COUNT(*) FILTER (WHERE o.status <> 'cancelled') > 0;

  UPDATE public.orders_daily_agg_state SET rolled_through = v_target WHERE only_one;
END;
$function$;
REVOKE ALL ON FUNCTION public.lfh_refresh_orders_daily_agg() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_refresh_orders_daily_agg() TO service_role;
SELECT public.lfh_refresh_orders_daily_agg();
