-- 301_a_discount_is_grossed_at_the_rate_it_was_charged.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- THE OWNER'S REVENUE AND THE GUEST'S BILL DISAGREED ABOUT A DISCOUNT (T7 sweep, F16).
--
-- `orders.total` is stored as `subtotal + tax` on the PRE-discount subtotal, so every money
-- surface computes the net as `total - discount x (1 + rate)` (migration 126 put them all on
-- that identity). Migration 284 then made an order REMEMBER the rate it was charged at, so
-- "a rate corrected today cannot re-price a bill taken this morning".
--
-- That second change reached the printed bill, the Z-report and pay-in-parts — and NOT ONE
-- analytics function. Every owner/admin money RPC still resolved the rate as
-- `lfh_effective_tax_rate(restaurant_id)`: the rate configured RIGHT NOW. Deliberately, too —
-- migration 155 hoisted it out of the per-row path because calling it per order was a settings
-- lookup + JSONB parse per row and hit the 8s timeout at ~400k rows.
--
-- So for a DISCOUNTED bill whose rate later changed — or a banquet order carrying its own 18%
-- beside 5% dine-in food — the owner's dashboard and the guest's paper differed by
-- `discount x (rate_now - rate_charged)`. On a 1,000 bill with a 200 discount taken at 5% and
-- the setting later moved to 18%, that is 26 on one bill.
--
-- HOW THIS FIXES IT WITHOUT UNDOING MIGRATION 155.
-- The rate belongs to the ORDER, so the arithmetic that needs it belongs at WRITE time, where
-- one row is in hand and a function call costs nothing. `orders.disc_gross` holds the discount
-- as it actually reduces the bill — `discount x (1 + the rate this order was charged)` — and
-- every reader now subtracts that column instead of re-deriving it from today's settings. The
-- read path gets CHEAPER, not dearer: nine functions stop needing a rate for the discount at all.
--
-- WHAT DOES NOT CHANGE. The reported "discount" figure stays the RAW stored amount, so it still
-- matches the Discount line on the bill and the Z-report; only the NET/revenue and the collected
-- TAX use the grossed figure. `total`, `subtotal`, `discount` and `tax` are untouched on every
-- row — not one stored bill is rewritten (the billing guardrail).
--
-- MEASURED BEFORE WRITING THIS: on the backup database, 0 of 30,532 orders (2,376 of them
-- discounted) currently have a stamped rate that differs from their restaurant's configured rate.
-- So this is a latent fault, and every figure below must come out BYTE-IDENTICAL today — which is
-- exactly how it was verified. It starts mattering the first time a rate is corrected.

-- ── 1. The column, and the one rule that fills it ───────────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS disc_gross numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.orders.disc_gross IS
  'The discount as it actually reduces this bill: discount x (1 + the rate THIS order was charged at, orders.tax_rate — mig 284), falling back to the restaurant''s configured rate for a row with none. Maintained by trg_orders_disc_gross; every analytics reader subtracts this instead of re-deriving it from today''s settings (mig 301).';

CREATE OR REPLACE FUNCTION public.lfh_fill_disc_gross() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $function$
BEGIN
  -- `> 0` on purpose, matching every other reader of orders.tax_rate: a genuine 0 (a composition
  -- restaurant) falls through to the settings, which also answer 0. A NULL rate is a row from
  -- before mig 284 and gets the restaurant's configured rate, which is what it was charged at.
  -- NOT rounded. `numeric` is exact, so summing this column gives precisely
  -- SUM(discount_i x rate_i) — each order grossed at its OWN rate, with no per-row rounding drift
  -- against the old `(1 + rate) x SUM(discount)` (which rounded nowhere either). Rounding here to
  -- 4dp cost ~0.1 paise over 2,376 discounted rows AND widened the numeric scale of every revenue
  -- figure the API returns, which is a gratuitous change to a shape the owner UI already renders.
  NEW.disc_gross :=
    COALESCE(NEW.discount, 0) * (1 + COALESCE(
      NULLIF(NEW.tax_rate, 0),
      lfh_effective_tax_rate(COALESCE(NEW.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid))
    ));
  RETURN NEW;
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_fill_disc_gross() FROM PUBLIC, anon, authenticated;

-- AFTER the mig-284/288 rate stamp and the mig-296 discount clamp, so it reads their final values.
-- Name chosen to sort last among the BEFORE triggers on orders (Postgres fires them alphabetically).
DROP TRIGGER IF EXISTS zz_orders_disc_gross ON public.orders;
CREATE TRIGGER zz_orders_disc_gross
  BEFORE INSERT OR UPDATE OF discount, tax_rate, restaurant_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.lfh_fill_disc_gross();

-- Backfill every existing row. Discount-free rows are already 0 by the column default.
UPDATE public.orders o
   SET disc_gross = o.discount * (1 + COALESCE(NULLIF(o.tax_rate, 0),
                     lfh_effective_tax_rate(o.restaurant_id)))
 WHERE COALESCE(o.discount, 0) <> 0;

-- ── 2. The two pre-aggregated rollups carry it too ──────────────────────────────────────────
-- Readers COALESCE onto the old maths, so a rollup that has not been refreshed yet still answers
-- exactly as it does today rather than under-subtracting. Both are refreshed at the end of this file.
ALTER TABLE public.orders_daily_agg          ADD COLUMN IF NOT EXISTS disc_gross_paid numeric;
ALTER TABLE public.orders_report_monthly_agg ADD COLUMN IF NOT EXISTS disc_gross_paid numeric;
ALTER TABLE public.orders_report_monthly_agg ADD COLUMN IF NOT EXISTS disc_gross_canc numeric;


-- ── 3. The daily rollup builder — split-leg weighted, like every other measure in it 
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
  INSERT INTO public.orders_daily_agg (restaurant_id, day, method, gross_paid, disc_paid, paid_orders, all_orders, disc_gross_paid)
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
           o.status, o.payment_status, o.total, o.discount, o.disc_gross,
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
         COALESCE(SUM(e.disc_gross * e.w) FILTER (WHERE e.status <> 'cancelled' AND e.payment_status = 'paid'), 0)
    FROM exp e
   GROUP BY 1, 2, 3
  -- NOT filtered on the primary-leg count: the non-primary method of a split carries real money and
  -- no count, and dropping it here is how the card half of every split bill would have vanished.
  HAVING COUNT(*) FILTER (WHERE e.status <> 'cancelled') > 0;

  UPDATE public.orders_daily_agg_state SET rolled_through = v_target WHERE only_one;
END;
$function$;

-- ── 4. The monthly report rollup builder ──────────────────────────────────────
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
     gross_paid, sub_paid, disc_paid, gross_canc, disc_canc, disc_gross_paid, disc_gross_canc)
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
         COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status =  'cancelled'), 0)
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

-- ── 5. lfh_owner_overview — revenue_today / revenue_all ───────────────────────
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
      COUNT(*) FILTER (WHERE o.status <> 'cancelled') ao_all,
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
        AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)), 0) gp_today,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
        AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)), 0) dp_today,
      COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
        AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)), 0) dpg_today,
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
    (COALESCE(t.gp_today, 0) - COALESCE(t.dpg_today, 0))::numeric,
    (COALESCE(h.ao, 0) + COALESCE(t.ao_all, 0))::bigint,
    ((COALESCE(h.gp, 0) + COALESCE(t.gp_all, 0)) - (COALESCE(h.dpg, 0) + COALESCE(t.dpg_all, 0)))::numeric,
    COALESCE(sess.open_tables, 0)::bigint
  FROM restaurants r
  JOIN rates rt ON rt.rid = r.id
  LEFT JOIN hist h ON h.restaurant_id = r.id
  LEFT JOIN tail t ON t.restaurant_id = r.id
  LEFT JOIN sess ON sess.restaurant_id = r.id
  WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
  ORDER BY r.name;
$function$;

-- ── 6. lfh_owner_payment_breakdown — revenue per payment method ───────────────
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
    SELECT restaurant_id, method, SUM(gp) gp, SUM(dp) dp, SUM(dpg) dpg, SUM(po) po
    FROM (SELECT * FROM hist UNION ALL SELECT * FROM tail) u
    GROUP BY restaurant_id, method
  )
  SELECT c.method,
    COALESCE(SUM(c.gp - c.dpg), 0)::numeric AS revenue,
    SUM(c.po)::bigint AS orders
  FROM comb c JOIN rates rt ON rt.rid = c.restaurant_id
  GROUP BY c.method
  -- was `HAVING SUM(c.po) > 0` — which would hide the non-primary method of every split bill, the
  -- exact money this migration exists to surface. A method with real money and no order count is a
  -- legitimate answer now.
  HAVING SUM(c.po) > 0 OR SUM(c.gp) <> 0
  ORDER BY revenue DESC;
$function$;

-- ── 7. lfh_owner_restaurant_revenue ───────────────────────────────────────────
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
      COUNT(*) FILTER (WHERE o.status <> 'cancelled') ao
    FROM orders o
    WHERE o.created_at >= (SELECT tail_start FROM wm)
      AND o.created_at >= p_from AND o.created_at < p_to
    GROUP BY o.restaurant_id
  )
  SELECT r.id, r.slug, r.name, r.accent_color,
    ((COALESCE(h.gp, 0) + COALESCE(t.gp, 0)) - (COALESCE(h.dpg, 0) + COALESCE(t.dpg, 0)))::numeric AS revenue,
    (COALESCE(h.ao, 0) + COALESCE(t.ao, 0))::bigint AS orders
  FROM restaurants r
  JOIN rates rt ON rt.rid = r.id
  LEFT JOIN hist h ON h.restaurant_id = r.id
  LEFT JOIN tail t ON t.restaurant_id = r.id
  WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
  ORDER BY revenue DESC;
$function$;

-- ── 8. lfh_owner_revenue_timeseries ───────────────────────────────────────────
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
      COUNT(*) FILTER (WHERE o.status <> 'cancelled') ao
    FROM orders o
    WHERE o.created_at >= (CASE WHEN (SELECT b FROM params) = 'day' THEN (SELECT tail_start FROM wm) ELSE 'infinity'::timestamptz END)
      AND o.created_at >= p_from AND o.created_at < p_to
      AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR o.restaurant_id = ANY(p_ids))
    GROUP BY o.restaurant_id, (o.created_at AT TIME ZONE 'Asia/Kolkata')::date
  ),
  day_comb AS (
    SELECT restaurant_id, day, SUM(gp) gp, SUM(dp) dp, SUM(dpg) dpg, SUM(ao) ao
    FROM (SELECT * FROM hist UNION ALL SELECT * FROM tail) u
    GROUP BY restaurant_id, day
  ),
  day_rows AS (
    SELECT (c.day::timestamp AT TIME ZONE 'Asia/Kolkata') AS bucket, c.restaurant_id,
           (c.gp - c.dpg)::numeric AS revenue, c.ao::bigint AS orders
    FROM day_comb c JOIN rates rt ON rt.rid = c.restaurant_id
  ),
  live_rows AS (  -- hour/week/month: original live aggregation, fenced off when b='day'
    SELECT date_trunc((SELECT b FROM params), o.created_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
           o.restaurant_id,
           COALESCE(SUM(o.total - o.disc_gross) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric AS revenue,
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

-- ── 9. lfh_owner_sales_report — revenue, collected tax and cancelled value ────
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
           COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status =  'cancelled'), 0) dcg
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
           SUM(gp) gp, SUM(sp) sp, SUM(dp) dp, SUM(gc) gc, SUM(dc) dc, SUM(dpg) dpg, SUM(dcg) dcg
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
           COALESCE(SUM(c.gp - c.dpg), 0)::numeric                      AS revenue,
           SUM(c.co)::bigint                                            AS cancelled_orders,
           COALESCE(SUM(c.gc - c.dcg), 0)::numeric                      AS cancelled_value
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
           COALESCE(SUM(o.total - o.disc_gross) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
           COUNT(*) FILTER (WHERE o.status = 'cancelled')::bigint,
           COALESCE(SUM(o.total - o.disc_gross) FILTER (WHERE o.status = 'cancelled'), 0)::numeric
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

-- ── 10. lfh_owner_hourly ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_hourly(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(hour integer, orders bigint, revenue numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXTRACT(hour FROM (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::int AS hour,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint,
         COALESCE(SUM(o.total - o.disc_gross) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric
  FROM orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
  GROUP BY 1
  ORDER BY 1;
$function$;

-- ── 11. lfh_owner_records ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_records(p_restaurant_id uuid)
 RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH paid AS (
    SELECT o.id, o.session_id, o.table_number,
           (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AS created_at,
           (o.total - o.disc_gross) AS rev
    FROM orders o
    WHERE o.restaurant_id = p_restaurant_id
      AND o.status <> 'cancelled' AND o.payment_status = 'paid'
  ),
  best_day AS (
    SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS d, SUM(rev) AS v
    FROM paid GROUP BY 1 ORDER BY 2 DESC LIMIT 1
  ),
  big_bill AS (
    SELECT COALESCE(session_id::text, 'solo:' || id::text) AS k,
           MAX(table_number) AS tbl, SUM(rev) AS v
    FROM paid GROUP BY 1 ORDER BY 3 DESC LIMIT 1
  ),
  fast_hour AS (
    SELECT date_trunc('hour', created_at AT TIME ZONE 'Asia/Kolkata') AS h, COUNT(*) AS n
    FROM paid GROUP BY 1 ORDER BY 2 DESC LIMIT 1
  ),
  star_dish AS (
    SELECT it->>'title' AS title, SUM((it->>'qty')::numeric)::bigint AS qty
    FROM orders o
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS it
    WHERE o.restaurant_id = p_restaurant_id AND o.status <> 'cancelled'
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= now() - interval '30 days'
      AND COALESCE(it->>'title', '') <> ''
    GROUP BY 1 ORDER BY 2 DESC LIMIT 1
  ),
  regulars AS (
    SELECT COUNT(*) AS n FROM (
      SELECT LOWER(TRIM(m.name))
      FROM session_members m
      WHERE m.restaurant_id = p_restaurant_id
        AND m.joined_at >= now() - interval '30 days'
        AND COALESCE(TRIM(m.name), '') <> ''
      GROUP BY 1
      HAVING COUNT(DISTINCT m.session_id) >= 2
    ) rc
  )
  SELECT jsonb_build_object(
    'bestDay',  (SELECT jsonb_build_object('date', d, 'revenue', ROUND(v, 2)) FROM best_day),
    'bigBill',  (SELECT jsonb_build_object('table', tbl, 'revenue', ROUND(v, 2)) FROM big_bill),
    'fastHour', (SELECT jsonb_build_object('at', h, 'orders', n) FROM fast_hour),
    'starDish', (SELECT jsonb_build_object('title', title, 'qty', qty) FROM star_dish),
    'regulars', (SELECT n FROM regulars)
  );
$function$;

-- ── 12. lfh_owner_payment_trend ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_payment_trend(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(day date, method text, revenue numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT ((CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::date AS day,
         COALESCE(NULLIF(TRIM(o.payment_method), ''), 'Not recorded') AS method,
         COALESCE(SUM(o.total - o.disc_gross), 0)::numeric
  FROM orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status <> 'cancelled' AND o.payment_status = 'paid'
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
  GROUP BY 1, 2
  ORDER BY 1;
$function$;

-- ── 13. lfh_owner_heatmap ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_heatmap(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(dow integer, hr integer, orders bigint, revenue numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH rates AS (
    -- one row per restaurant this call can touch; the rate is read once, not once per order
    SELECT r.id, lfh_effective_tax_rate(r.id) AS rate
      FROM restaurants r
     WHERE (CASE WHEN p_restaurant_id IS NOT NULL THEN r.id = p_restaurant_id
                 WHEN p_ids IS NOT NULL THEN r.id = ANY(p_ids)
                 ELSE TRUE END)
  )
  SELECT EXTRACT(dow  FROM (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::int AS dow,
         EXTRACT(hour FROM (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::int AS hr,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint AS orders,
         COALESCE(SUM(o.total - o.disc_gross)
           FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric AS revenue
  FROM orders o
  LEFT JOIN rates rt ON rt.id = o.restaurant_id
  WHERE (CASE WHEN p_restaurant_id IS NOT NULL THEN o.restaurant_id = p_restaurant_id
              WHEN p_ids IS NOT NULL THEN o.restaurant_id = ANY(p_ids)
              ELSE TRUE END)
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
  GROUP BY 1, 2
  ORDER BY 1, 2;
$function$;


-- ── 14. Fill the new rollup columns now, so the COALESCE fallback is never actually needed ──
SELECT public.lfh_refresh_orders_daily_agg();
SELECT public.lfh_refresh_orders_report_monthly_agg();

NOTIFY pgrst, 'reload schema';
