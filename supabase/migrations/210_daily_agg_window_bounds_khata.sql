-- 210_daily_agg_window_bounds_khata.sql
--
-- Two owner-visible correctness fixes in the daily-rollup read stack (found via the
-- owner's Day-summary screenshot: a day with ZERO sales showed ~₹30 days of settlement).
--
-- (A) MISSING END-DATE BOUND. lfh_owner_payment_breakdown, lfh_owner_restaurant_revenue
--     and lfh_owner_revenue_timeseries read orders_daily_agg with `day >= p_from` but no
--     upper bound, so any window that ends BEFORE the rollup watermark (a single past day,
--     "yesterday", "last month") silently sums every rolled day from p_from through the
--     watermark. The Day summary's settlement box was the loudest symptom (~₹3.0M shown
--     for a day whose sales were ₹0). Each hist now also requires
--       a.day < (p_to AT TIME ZONE 'Asia/Kolkata')::date
--     (sargable; correct because p_to is always an IST midnight for past windows, and a
--     mid-day p_to only ever means "now", whose day is never frozen in the rollup).
--     This is the SOURCE fix for the "latent p_to bug" PR #486 worked around client-side.
--
-- (B) KHATA RULE REGRESSION. Mig 185 (owner-approved): a pay-later bill counts on the day
--     it is COLLECTED (paid_at), not the day it was ordered. Mig 190 rebuilt these
--     functions on orders_daily_agg using created_at only, silently reverting that rule
--     for payments / per-restaurant revenue / timeseries / overview (mig 201 restored it
--     only for lfh_owner_sales_report). The rollup refresh and every live tail now use the
--     same effective date the sales report uses:
--       eff = CASE WHEN khata_at IS NOT NULL AND paid_at IS NOT NULL THEN paid_at
--                  ELSE created_at END
--     so settlement, per-restaurant tiles and the timeseries reconcile with the reports.
--     Tails keep an index-friendly probe (created_at >= bound OR khata-paid_at >= bound —
--     the 203-mtail pattern; idx_orders_khata_paid_at covers the paid_at side, and the
--     eff filter itself is covered by idx_orders_effective_date when restaurant-scoped).
--     Note (same accepted trade as mig 201): a khata order created in a FROZEN day and
--     paid later is counted in all_orders on both days until the next nightly rebuild
--     (money is never double-counted); self-heals in <=24h.
--
-- No signature changes (CREATE OR REPLACE keeps ACLs); grants re-asserted anyway.
-- Backfill: both rollups rebuilt at the end so the new attribution applies immediately.

-- ── 1. refresh: bucket the daily rollup by the khata-aware effective date ───────
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
         ((CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END)
            AT TIME ZONE 'Asia/Kolkata')::date                                  AS day,
         COALESCE(NULLIF(o.payment_method, ''), 'Not recorded')                  AS method,
         COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0),
         COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0),
         COUNT(*) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'),
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')
  FROM public.orders o
  WHERE ((CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END)
           AT TIME ZONE 'Asia/Kolkata')::date <= v_target
  GROUP BY 1, 2, 3
  HAVING COUNT(*) FILTER (WHERE o.status <> 'cancelled') > 0;   -- drop cancelled-only buckets

  UPDATE public.orders_daily_agg_state SET rolled_through = v_target WHERE only_one;
END;
$function$;
REVOKE ALL ON FUNCTION public.lfh_refresh_orders_daily_agg() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_refresh_orders_daily_agg() TO service_role;

-- ── 2. lfh_owner_payment_breakdown — end-date bound + khata effective date ──────
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
      AND a.day <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date + CASE WHEN p_to = date_trunc('day', p_to AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' THEN 0 ELSE 1 END
      AND (p_restaurant_id IS NULL OR a.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR a.restaurant_id = ANY (p_ids))
    GROUP BY a.restaurant_id, a.method
  ),
  tail AS (
    SELECT o.restaurant_id, COALESCE(NULLIF(o.payment_method, ''), 'Not recorded') AS method,
      COALESCE(SUM(o.total), 0) gp, COALESCE(SUM(o.discount), 0) dp, COUNT(*) po
    FROM orders o
    WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
      AND (o.created_at >= (SELECT tail_start FROM wm)
           OR (o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL AND o.paid_at >= (SELECT tail_start FROM wm)))
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) <  p_to
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

-- ── 3. lfh_owner_restaurant_revenue — end-date bound + khata effective date ─────
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
      AND a.day <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date + CASE WHEN p_to = date_trunc('day', p_to AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' THEN 0 ELSE 1 END
    GROUP BY a.restaurant_id
  ),
  tail AS (
    SELECT o.restaurant_id,
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) gp,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dp,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled') ao
    FROM orders o
    WHERE (o.created_at >= (SELECT tail_start FROM wm)
           OR (o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL AND o.paid_at >= (SELECT tail_start FROM wm)))
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) <  p_to
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

-- ── 4. lfh_owner_revenue_timeseries — end-date bound + khata effective date ─────
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
      AND a.day <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date + CASE WHEN p_to = date_trunc('day', p_to AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' THEN 0 ELSE 1 END
      AND (p_restaurant_id IS NULL OR a.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR a.restaurant_id = ANY(p_ids))
    GROUP BY a.restaurant_id, a.day
  ),
  tail AS (
    SELECT o.restaurant_id,
      ((CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::date AS day,
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) gp,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dp,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled') ao
    FROM orders o
    WHERE (o.created_at >= (CASE WHEN (SELECT b FROM params) = 'day' THEN (SELECT tail_start FROM wm) ELSE 'infinity'::timestamptz END)
           OR (o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL
               AND o.paid_at >= (CASE WHEN (SELECT b FROM params) = 'day' THEN (SELECT tail_start FROM wm) ELSE 'infinity'::timestamptz END)))
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) <  p_to
      AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR o.restaurant_id = ANY(p_ids))
    GROUP BY o.restaurant_id, ((CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::date
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
  live_rows AS (  -- hour/week/month: live aggregation on the effective date, fenced off when b='day'
    SELECT date_trunc((SELECT b FROM params),
             (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
           o.restaurant_id,
           COALESCE(SUM(o.total - o.discount * (1 + rt.rate)) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric AS revenue,
           COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint AS orders
    FROM orders o
    JOIN rates rt ON rt.rid = o.restaurant_id
    WHERE (o.created_at >= (CASE WHEN (SELECT b FROM params) = 'day' THEN 'infinity'::timestamptz ELSE p_from END)
           OR (o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL
               AND o.paid_at >= (CASE WHEN (SELECT b FROM params) = 'day' THEN 'infinity'::timestamptz ELSE p_from END)))
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (CASE WHEN (SELECT b FROM params) = 'day' THEN 'infinity'::timestamptz ELSE p_from END)
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
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

-- ── 5. lfh_owner_overview — khata effective date in the live tail ───────────────
-- (all-time hist needs no window bound; "today" now reckons a khata bill on its
-- collection day, matching the reports.)
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
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
        AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)), 0) gp_today,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
        AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)), 0) dp_today,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled'
        AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)) ao_today
    FROM orders o
    WHERE (o.created_at >= (SELECT tail_start FROM wm)
           OR (o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL AND o.paid_at >= (SELECT tail_start FROM wm)))
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
REVOKE ALL ON FUNCTION public.lfh_owner_overview(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_overview(uuid[]) TO service_role;

-- ── 6. rebuild both rollups under the corrected attribution ─────────────────────
SELECT public.lfh_refresh_orders_daily_agg();
SELECT public.lfh_refresh_orders_report_monthly_agg();
