-- 337_a_report_reads_the_takings_not_the_discount.sql — T11 sweep, 2026-08-18
--
-- WHERE THE OWNER SEES IT
--   Owner → Dashboard → the Revenue tile, "Revenue over time", "Revenue · this month vs last".
--   Owner → Reports → Sales, with the period on "12 months" / "FY" / "All time" → the newest
--     month's row and the last bar of the chart.
--   Owner → Reports → Payments → the per-method table, the donut and "Total collected".
--   Owner → Reports → Day summary → "Settlement · how the money arrived".
--
-- WHAT WAS WRONG. Three report functions are built the same way: a `hist` block that reads the
-- pre-summed rollup for older days/months, and a live `tail` (or `mtail`) block for the days the
-- rollup has not frozen yet, glued together with `SELECT * FROM hist UNION ALL SELECT * FROM tail`.
-- In all three, `hist` listed its columns … net, dpg … and the live branch listed the same pair the
-- other way round, … dpg, net … . A UNION ALL takes its column NAMES from the FIRST branch only, and
-- the wrapper then adds them up BY NAME — so every row that came from the live branch had its
-- takings and its grossed discount swapped. The money figure the screen printed for a live day was
-- that day's DISCOUNT, not its takings.
--
-- lfh_owner_sales_report rotates four columns rather than two (net, netc, dpg, dcg against
-- dpg, dcg, net, netc), which is why its tax column — computed as gp - sp - (dpg - dp) — came out
-- LARGE AND NEGATIVE for the current month rather than merely small.
--
-- MEASURED ON THE BACKUP BEFORE THIS FIX (read-only, French House, rollup watermark 2026-08-15):
--     IST day   really took (SUM net_amount)   that day's grossed discount   what the chart returned
--     15 Aug    ₹2,646.00                      ₹0.00                          ₹2,646     OK (rollup)
--     16 Aug    ₹1,323.00                      ₹0.00                          ₹0         X
--     17 Aug    ₹23,268.00                     ₹0.00                          ₹0         X
--   and Reports → Sales → 12 months printed, for a month that really took ₹3,69,511:
--     Aug 26   691   386   ₹3,66,731   −₹3,55,394   ₹5,530   ₹5,807   1,030
--   ₹5,807 is exactly that month's grossed discount, and the GST cell is negative because it is
--   derived from the swapped pair. On a day with no discount the wrong figure is ₹0, which reads as
--   "no trading yet" rather than as a fault — which is why this survived two sweeps.
--
-- THE FIX. Name the columns explicitly on BOTH sides of every UNION ALL, in one order. Reordering
-- the live branch alone would work today and break again the next time someone adds a column to one
-- half; naming them means column ORDER can never decide the answer again. Nothing else in any of the
-- three bodies is touched — same fences, same khata/pay-later dating (migs 185/317), same tax rate
-- handling, same work_mem and timeouts.
--
-- NOT ONE STORED BILL IS REWRITTEN. total, subtotal, discount, tax, disc_gross, net_amount and
-- tax_rate are untouched on every row (the billing guardrail). This is a READ path only: three
-- CREATE OR REPLACE statements, which also keep the existing grants.
--
-- WHY THIS FILE AND NOT AN EDIT IN 315/321: those two are the newest definitions of these bodies,
-- and a database that has already applied them needs a NEW statement to pick the correction up.
-- The bodies below were taken from the TRUE LATEST definition of each function computed across the
-- whole folder — lfh_owner_revenue_timeseries and lfh_owner_payment_breakdown from 321,
-- lfh_owner_sales_report from 315 (321 does not redefine it). That distinction is migration 270's
-- scar and 321's own warning; getting it wrong would revert the rollup's net column.
--
-- lfh_owner_restaurant_revenue and lfh_owner_overview have the same two halves but join them BY
-- NAME (h.net / t.net_all) instead of stacking them, so they were always correct and are NOT
-- touched here. That is exactly why one page could show two different totals for one window.

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
    SELECT a.restaurant_id, a.day, SUM(a.gross_paid) gp, SUM(a.disc_paid) dp,
           SUM(COALESCE(a.net_paid, a.gross_paid - COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id))))) net,
           SUM(COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id)))) dpg,
           SUM(a.all_orders) ao
    FROM orders_daily_agg a
    WHERE a.day <= (CASE WHEN (SELECT b FROM params) = 'day' THEN (SELECT rolled_through FROM wm) ELSE '-infinity'::date END)
      AND a.day >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
      AND a.day <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date
      AND (p_restaurant_id IS NULL OR a.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR a.restaurant_id = ANY(p_ids))
    GROUP BY a.restaurant_id, a.day
  ),
  tail AS (
    SELECT o.restaurant_id, ((CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::date AS day,
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) gp,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dp,
      COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dpg,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) net,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled') ao
    FROM orders o
    WHERE (o.created_at >= (CASE WHEN (SELECT b FROM params) = 'day' THEN (SELECT tail_start FROM wm) ELSE 'infinity'::timestamptz END)
           OR (o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL
               AND o.paid_at >= (CASE WHEN (SELECT b FROM params) = 'day' THEN (SELECT tail_start FROM wm) ELSE 'infinity'::timestamptz END)))
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
      AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR o.restaurant_id = ANY(p_ids))
    GROUP BY o.restaurant_id, ((CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::date
  ),
  day_comb AS (
    SELECT restaurant_id, day, SUM(gp) gp, SUM(dp) dp, SUM(dpg) dpg, SUM(net) net, SUM(ao) ao
    FROM (SELECT restaurant_id, day, gp, dp, net, dpg, ao FROM hist
          UNION ALL
          SELECT restaurant_id, day, gp, dp, net, dpg, ao FROM tail) u
    GROUP BY restaurant_id, day
  ),
  day_rows AS (
    SELECT (c.day::timestamp AT TIME ZONE 'Asia/Kolkata') AS bucket, c.restaurant_id,
           -- (315) one stored net, instead of subtracting two stored columns from each other.
         c.net::numeric AS revenue, c.ao::bigint AS orders
    FROM day_comb c JOIN rates rt ON rt.rid = c.restaurant_id
  ),
  live_rows AS (  -- hour/week/month: original live aggregation, fenced off when b='day'
    SELECT date_trunc((SELECT b FROM params), (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
           o.restaurant_id,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric AS revenue,
           COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint AS orders
    FROM orders o
    JOIN rates rt ON rt.rid = o.restaurant_id
    WHERE (CASE WHEN (SELECT b FROM params) = 'day' THEN 'infinity'::timestamptz ELSE p_from END) <= (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END)
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
    SELECT a.restaurant_id, a.method, SUM(a.gross_paid) gp, SUM(a.disc_paid) dp,
           SUM(COALESCE(a.net_paid, a.gross_paid - COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id))))) net,
           SUM(COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id)))) dpg,
           SUM(a.paid_orders) po
    FROM orders_daily_agg a
    WHERE a.day <= (SELECT rolled_through FROM wm)
      AND a.day >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
      AND a.day <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date
      AND (p_restaurant_id IS NULL OR a.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR a.restaurant_id = ANY (p_ids))
    GROUP BY a.restaurant_id, a.method
  ),
  -- the live tail's split legs, same shape as the rollup's
  legs AS (
    SELECT sp.session_id, sp.method, SUM(sp.amount) AS amt
      FROM session_payments sp
     WHERE sp.reversed_at IS NULL
       AND (p_restaurant_id IS NULL OR sp.restaurant_id = p_restaurant_id)
       AND (p_ids IS NULL OR sp.restaurant_id = ANY (p_ids))
     GROUP BY sp.session_id, sp.method
    HAVING SUM(sp.amount) > 0
  ),
  legw AS (
    SELECT session_id, method,
           amt / SUM(amt) OVER (PARTITION BY session_id) AS w,
           (ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY amt DESC, method) = 1) AS primary_leg
      FROM legs
  ),
  tail AS (
    SELECT o.restaurant_id,
           COALESCE(l.method, NULLIF(o.payment_method, ''), 'Not recorded') AS method,
           COALESCE(SUM(o.total    * COALESCE(l.w, 1)), 0) gp,
           COALESCE(SUM(o.discount * COALESCE(l.w, 1)), 0) dp,
           COALESCE(SUM(o.disc_gross * COALESCE(l.w, 1)), 0) dpg,
           COALESCE(SUM(o.net_amount * COALESCE(l.w, 1)), 0) net,
           COUNT(*) FILTER (WHERE COALESCE(l.primary_leg, true)) po
    FROM orders o
    LEFT JOIN legw l ON o.payment_method = 'Split' AND l.session_id = o.session_id
    WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
      AND (o.created_at >= (SELECT tail_start FROM wm)
           OR (o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL AND o.paid_at >= (SELECT tail_start FROM wm)))
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) <  p_to
      AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR o.restaurant_id = ANY (p_ids))
    GROUP BY o.restaurant_id, COALESCE(l.method, NULLIF(o.payment_method, ''), 'Not recorded')
  ),
  comb AS (
    SELECT restaurant_id, method, SUM(gp) gp, SUM(dp) dp, SUM(dpg) dpg, SUM(net) net, SUM(po) po
    FROM (SELECT restaurant_id, method, gp, dp, net, dpg, po FROM hist
          UNION ALL
          SELECT restaurant_id, method, gp, dp, net, dpg, po FROM tail) u
    GROUP BY restaurant_id, method
  )
  SELECT c.method,
    -- (315) one stored net, instead of subtracting two stored columns from each other.
         COALESCE(SUM(c.net), 0)::numeric AS revenue,
    SUM(c.po)::bigint AS orders
  FROM comb c JOIN rates rt ON rt.rid = c.restaurant_id
  GROUP BY c.method
  -- was `HAVING SUM(c.po) > 0` — which would hide the non-primary method of every split bill, the
  -- exact money this migration exists to surface. A method with real money and no order count is a
  -- legitimate answer now.
  HAVING SUM(c.po) > 0 OR SUM(c.gp) <> 0
  ORDER BY revenue DESC;
$function$;

CREATE OR REPLACE FUNCTION public.lfh_owner_sales_report(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_bucket text, p_ids uuid[] DEFAULT NULL::uuid[])
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
                          WHEN p_ids IS NOT NULL THEN p_ids
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
           a.gross_paid gp, a.sub_paid sp, a.disc_paid dp, a.gross_canc gc, a.disc_canc dc,
           COALESCE(a.net_paid, a.gross_paid - COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id)))) net,
           COALESCE(a.net_canc, a.gross_canc - COALESCE(a.disc_gross_canc, a.disc_canc * (1 + lfh_effective_tax_rate(a.restaurant_id)))) netc,
           COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id))) dpg,
           COALESCE(a.disc_gross_canc, a.disc_canc * (1 + lfh_effective_tax_rate(a.restaurant_id))) dcg
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
           COALESCE(SUM(o.discount) FILTER (WHERE o.status =  'cancelled'), 0) dc,
           COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dpg,
           COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status =  'cancelled'), 0) dcg,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) net,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status =  'cancelled'), 0) netc
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
           SUM(gp) gp, SUM(sp) sp, SUM(dp) dp, SUM(gc) gc, SUM(dc) dc, SUM(dpg) dpg, SUM(dcg) dcg, SUM(net) net, SUM(netc) netc
    FROM (SELECT restaurant_id, month, ao, po, co, gp, sp, dp, gc, dc, net, netc, dpg, dcg FROM hist
          UNION ALL
          SELECT restaurant_id, month, ao, po, co, gp, sp, dp, gc, dc, net, netc, dpg, dcg FROM mtail) u
    GROUP BY restaurant_id, month
  ),
  month_rows AS (
    SELECT (c.month::timestamp AT TIME ZONE 'Asia/Kolkata')            AS bucket,
           SUM(c.ao)::bigint                                            AS orders,
           SUM(c.po)::bigint                                            AS paid_orders,
           COALESCE(SUM(c.sp), 0)::numeric                              AS subtotal,
           COALESCE(SUM(c.gp - c.sp - (c.dpg - c.dp)), 0)::numeric      AS tax,
           COALESCE(SUM(c.dp), 0)::numeric                              AS discount,
           -- (315) one stored net, instead of subtracting two stored columns from each other.
         COALESCE(SUM(c.net), 0)::numeric                             AS revenue,
           SUM(c.co)::bigint                                            AS cancelled_orders,
           COALESCE(SUM(c.netc), 0)::numeric                            AS cancelled_value
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
           COALESCE(SUM(o.total - o.subtotal - (o.disc_gross - o.discount)) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
           COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
           COUNT(*) FILTER (WHERE o.status = 'cancelled')::bigint,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status = 'cancelled'), 0)::numeric
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

NOTIFY pgrst, 'reload schema';
