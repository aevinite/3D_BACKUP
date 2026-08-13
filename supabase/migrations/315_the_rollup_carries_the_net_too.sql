-- 315_the_rollup_carries_the_net_too.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- FINISHES WHAT MIGRATION 310 STARTED, on the half it deliberately left named as work.
--
-- The owner, 2026-08-12: "everywhere should be the same data … only that revenue should be taken
-- and calculated elsewhere." 310 made that true for every reader of LIVE orders: the net is a
-- stored column, orders.net_amount, and nobody works it out themselves. But the owner's money
-- screens do not read live orders for the whole window — anything older than two days comes from the
-- pre-aggregated rollups (migs 190/201), and those store gross_paid and disc_gross_paid as TWO
-- columns, so five readers still subtracted one from the other on that path.
--
-- WHERE HE WOULD SEE IT: Owner panel → Dashboard (the revenue tiles + the "vs yesterday" delta) and
-- Owner panel → Reports → Sales / Payment methods, for any range that reaches back beyond today and
-- yesterday. The figures agree with orders.net_amount today — the fallback only bites on a rollup row
-- written before disc_gross existed — so this is the same latent-fault-made-impossible as 310, not a
-- number being corrected.
--
-- WHAT CHANGES: both rollups gain net_paid (and the monthly one net_canc), filled by their own
-- refresh functions with the SAME split-payment weighting the money legs already use; and the five
-- readers take the net from there instead of subtracting. Each keeps gross/discount for the columns
-- that genuinely need them — the Sales report still prints tax from gross − subtotal − discount×rate,
-- and the payment breakdown still shows what was given away.
--
-- Every reader COALESCEs to the old arithmetic for a rollup row that predates the column, so nothing
-- can read as zero during the rollout. The two refreshes are then run at the end of this file, so
-- every row carries the real figure immediately rather than at the next cron.
--
-- PROVED THE SAME WAY 310 WAS, and more directly: on the same rows, the new column and the old
-- expression agree EXACTLY — 2,224 daily rollup rows and 21 monthly rows, drift 0.00 on both the paid
-- and the cancelled figure, and 0 orders whose net_amount disagrees with total − disc_gross.
--
-- ⚠️ AND IT REVEALED SOMETHING ELSE, WHICH THIS FILE DOES NOT FIX. Running the two refreshes moved
-- the rollup boundary forward (what the nightly cron does at 00:20 anyway), and a few figures shifted
-- — because the ROLLUP leg and the LIVE leg do not agree about every day. Measured on French House:
-- over 70 days, 2 days disagree, by ₹525 and 4 orders. The likeliest cause is the DAY an order is
-- filed under: the rollup groups on created_at, while the readers date a pay-later (khata) bill by
-- paid_at, so one bill can sit in a different day in each leg. That is the same "two answers"
-- family as everything else fixed today and it needs its own pass — it is NOT caused by this change
-- (the drift check above is exactly what separates the two).
-- ─────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.orders_daily_agg          ADD COLUMN IF NOT EXISTS net_paid numeric;
ALTER TABLE public.orders_report_monthly_agg ADD COLUMN IF NOT EXISTS net_paid numeric;
ALTER TABLE public.orders_report_monthly_agg ADD COLUMN IF NOT EXISTS net_canc numeric;

COMMENT ON COLUMN public.orders_daily_agg.net_paid IS
  'The stored net for this (restaurant, day, method): SUM(orders.net_amount) over paid, non-cancelled orders, weighted per payment leg exactly as gross_paid is. Every owner money reader sums THIS — see mig 310/315: the net is computed once, never re-derived.';
COMMENT ON COLUMN public.orders_report_monthly_agg.net_paid IS
  'The stored net for this (restaurant, month) over paid, non-cancelled orders. Read instead of gross_paid − disc_gross_paid (mig 315).';
COMMENT ON COLUMN public.orders_report_monthly_agg.net_canc IS
  'The same for CANCELLED orders — what the Sales report prints as "lost value" (mig 315).';

-- ── the two writers: store the net ───────────────────────────────────────────────────────────
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
  INSERT INTO public.orders_daily_agg (restaurant_id, day, method, gross_paid, disc_paid, paid_orders, all_orders, disc_gross_paid, net_paid)
  WITH legs AS (
    SELECT sp.session_id, sp.method, SUM(sp.amount) AS amt
      FROM public.session_payments sp
     WHERE sp.reversed_at IS NULL
     GROUP BY sp.session_id, sp.method
    HAVING SUM(sp.amount) > 0
  ),
  legw AS (
    SELECT session_id, method,
           amt / SUM(amt) OVER (PARTITION BY session_id) AS w,
           (ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY amt DESC, method) = 1) AS primary_leg
      FROM legs
  ),
  exp AS (
    SELECT o.restaurant_id,
           (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
           o.status, o.payment_status, o.total, o.discount, o.disc_gross, o.net_amount,
           COALESCE(l.method, NULLIF(o.payment_method, ''), 'Not recorded') AS method,
           COALESCE(l.w, 1)             AS w,
           COALESCE(l.primary_leg, true) AS primary_leg
      FROM public.orders o
      LEFT JOIN legw l
        ON o.payment_method = 'Split' AND l.session_id = o.session_id
     WHERE (o.created_at AT TIME ZONE 'Asia/Kolkata')::date <= v_target
  )
  SELECT e.restaurant_id, e.day, e.method,
         COALESCE(SUM(e.total    * e.w) FILTER (WHERE e.status <> 'cancelled' AND e.payment_status = 'paid'), 0),
         COALESCE(SUM(e.discount * e.w) FILTER (WHERE e.status <> 'cancelled' AND e.payment_status = 'paid'), 0),
         COUNT(*) FILTER (WHERE e.status <> 'cancelled' AND e.payment_status = 'paid' AND e.primary_leg),
         COUNT(*) FILTER (WHERE e.status <> 'cancelled' AND e.primary_leg),
         COALESCE(SUM(e.disc_gross * e.w) FILTER (WHERE e.status <> 'cancelled' AND e.payment_status = 'paid'), 0),
         -- (315) THE NET, stored once, weighted the same way the money legs are: every reader now
         -- sums THIS instead of subtracting two stored columns from each other.
         COALESCE(SUM(e.net_amount * e.w) FILTER (WHERE e.status <> 'cancelled' AND e.payment_status = 'paid'), 0)
    FROM exp e
   GROUP BY 1, 2, 3
  -- NOT filtered on the primary-leg count: the non-primary method of a split carries real money and
  -- no count, and dropping it here is how the card half of every split bill would have vanished.
  HAVING COUNT(*) FILTER (WHERE e.status <> 'cancelled') > 0;

  UPDATE public.orders_daily_agg_state SET rolled_through = v_target WHERE only_one;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lfh_refresh_orders_report_monthly_agg()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target date := (date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')) - interval '1 month')::date;
BEGIN
  DELETE FROM public.orders_report_monthly_agg;
  INSERT INTO public.orders_report_monthly_agg
    (restaurant_id, month, paid_orders, all_orders, canc_orders,
     gross_paid, sub_paid, disc_paid, gross_canc, disc_canc, disc_gross_paid, disc_gross_canc, net_paid, net_canc)
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
         COALESCE(SUM(o.discount) FILTER (WHERE o.status =  'cancelled'), 0),
         COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0),
         COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status =  'cancelled'), 0),
         -- (315) the net, stored once — paid and cancelled, the two figures the report prints.
         COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0),
         COALESCE(SUM(o.net_amount) FILTER (WHERE o.status =  'cancelled'), 0)
  FROM public.orders o
  WHERE date_trunc('month',
          (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END)
            AT TIME ZONE 'Asia/Kolkata')::date <= v_target
  GROUP BY 1, 2;

  UPDATE public.orders_report_monthly_agg_state
     SET rolled_through_month = v_target, refreshed_at = now()
   WHERE only_one;
END;
$function$;


-- ── the five readers: take the net from the rollup instead of subtracting two columns ────────
CREATE OR REPLACE FUNCTION public.lfh_owner_overview(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(restaurant_id uuid, slug text, name text, active boolean, accent_color text, orders_today bigint, revenue_today numeric, orders_all bigint, revenue_all numeric, open_tables bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH
  -- + p_ids: don't compute a tax rate for restaurants this caller will never see.
  rates AS MATERIALIZED (
    SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate
    FROM restaurants r
    WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
  ),
  wm AS (SELECT rolled_through, ((rolled_through + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS tail_start FROM orders_daily_agg_state),
  day_start AS (
    SELECT (((now() AT TIME ZONE 'Asia/Kolkata') - interval '5 hours')::date
            + interval '5 hours') AT TIME ZONE 'Asia/Kolkata' AS ts
  ),
  hist AS (
    SELECT a.restaurant_id, SUM(a.gross_paid) gp, SUM(a.disc_paid) dp,
           -- (315) the stored net. COALESCEd for a rollup row written before the column existed,
           -- which is the only way this can differ from the line below it.
           SUM(COALESCE(a.net_paid, a.gross_paid - COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id))))) net,
           SUM(COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id)))) dpg,
           SUM(a.all_orders) ao
    FROM orders_daily_agg a
    WHERE a.day <= (SELECT rolled_through FROM wm)
      -- + p_ids: the sibling `tail` and `sess` CTEs always had this; `hist` never did.
      AND (p_ids IS NULL OR a.restaurant_id = ANY(p_ids))
    GROUP BY a.restaurant_id
  ),
  tail AS (
    SELECT o.restaurant_id,
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) gp_all,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dp_all,
      COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dpg_all,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) net_all,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled') ao_all,
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
        AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)), 0) gp_today,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
        AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)), 0) dp_today,
      COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
        AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)), 0) dpg_today,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
             AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)), 0) net_today,
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
    -- (315) one stored net, instead of subtracting two stored columns from each other.
    COALESCE(t.net_today, 0)::numeric,
    (COALESCE(h.ao, 0) + COALESCE(t.ao_all, 0))::bigint,
    (COALESCE(h.net, 0) + COALESCE(t.net_all, 0))::numeric,
    COALESCE(sess.open_tables, 0)::bigint
  FROM restaurants r
  JOIN rates rt ON rt.rid = r.id
  LEFT JOIN hist h ON h.restaurant_id = r.id
  LEFT JOIN tail t ON t.restaurant_id = r.id
  LEFT JOIN sess ON sess.restaurant_id = r.id
  WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
  ORDER BY r.name;
$function$;;

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
    SELECT a.restaurant_id, SUM(a.gross_paid) gp, SUM(a.disc_paid) dp,
           SUM(COALESCE(a.net_paid, a.gross_paid - COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id))))) net,
           SUM(COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id)))) dpg,
           SUM(a.all_orders) ao
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
      COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dpg,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) net,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled') ao
    FROM orders o
    WHERE o.created_at >= (SELECT tail_start FROM wm)
      AND o.created_at >= p_from AND o.created_at < p_to
    GROUP BY o.restaurant_id
  )
  SELECT r.id, r.slug, r.name, r.accent_color,
    -- (315) one stored net, instead of subtracting two stored columns from each other.
         (COALESCE(h.net, 0) + COALESCE(t.net, 0))::numeric AS revenue,
    (COALESCE(h.ao, 0) + COALESCE(t.ao, 0))::bigint AS orders
  FROM restaurants r
  JOIN rates rt ON rt.rid = r.id
  LEFT JOIN hist h ON h.restaurant_id = r.id
  LEFT JOIN tail t ON t.restaurant_id = r.id
  WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
  ORDER BY revenue DESC;
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
      AND o.created_at >= (SELECT tail_start FROM wm)
      AND o.created_at >= p_from AND o.created_at < p_to
      AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR o.restaurant_id = ANY (p_ids))
    GROUP BY o.restaurant_id, COALESCE(l.method, NULLIF(o.payment_method, ''), 'Not recorded')
  ),
  comb AS (
    SELECT restaurant_id, method, SUM(gp) gp, SUM(dp) dp, SUM(dpg) dpg, SUM(net) net, SUM(po) po
    FROM (SELECT * FROM hist UNION ALL SELECT * FROM tail) u
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
    SELECT o.restaurant_id, (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) gp,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dp,
      COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dpg,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) net,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled') ao
    FROM orders o
    WHERE o.created_at >= (CASE WHEN (SELECT b FROM params) = 'day' THEN (SELECT tail_start FROM wm) ELSE 'infinity'::timestamptz END)
      AND o.created_at >= p_from AND o.created_at < p_to
      AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR o.restaurant_id = ANY(p_ids))
    GROUP BY o.restaurant_id, (o.created_at AT TIME ZONE 'Asia/Kolkata')::date
  ),
  day_comb AS (
    SELECT restaurant_id, day, SUM(gp) gp, SUM(dp) dp, SUM(dpg) dpg, SUM(net) net, SUM(ao) ao
    FROM (SELECT * FROM hist UNION ALL SELECT * FROM tail) u
    GROUP BY restaurant_id, day
  ),
  day_rows AS (
    SELECT (c.day::timestamp AT TIME ZONE 'Asia/Kolkata') AS bucket, c.restaurant_id,
           -- (315) one stored net, instead of subtracting two stored columns from each other.
         c.net::numeric AS revenue, c.ao::bigint AS orders
    FROM day_comb c JOIN rates rt ON rt.rid = c.restaurant_id
  ),
  live_rows AS (  -- hour/week/month: original live aggregation, fenced off when b='day'
    SELECT date_trunc((SELECT b FROM params), o.created_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
           o.restaurant_id,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric AS revenue,
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
    FROM (SELECT * FROM hist UNION ALL SELECT * FROM mtail) u
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

-- ── fill it now, so no screen waits for tomorrow's cron ──────────────────────────────────────
-- Both refreshes are full rebuilds (DELETE + INSERT), so this is idempotent and cheap to repeat.
SELECT public.lfh_refresh_orders_daily_agg();
SELECT public.lfh_refresh_orders_report_monthly_agg();

NOTIFY pgrst, 'reload schema';
