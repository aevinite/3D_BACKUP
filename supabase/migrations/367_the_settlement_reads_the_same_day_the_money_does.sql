-- 367_the_settlement_reads_the_same_day_the_money_does.sql — T11 sweep #7, 2026-08-27
--
-- WHERE THE OWNER SEES IT
--   Owner → Reports → Day summary → the "Settlement · how the money arrived" panel, read against
--     the "TOTAL COLLECTED" tile at the top of the SAME sheet. They disagreed.
--   Owner → Reports → Payments, with the period on "Today" or "Yesterday" → "Total collected",
--     "bills settled", the per-method table and the donut.
--   Owner → Dashboard → the payment-method card (same function, same two business-day windows).
--
-- WHAT WAS WRONG. A restaurant's day runs 05:00 IST → 05:00 IST, and the whole console agrees on
-- that: `range=day` (the day sheet), `range=today` and `range=yesterday` all ask for a BUSINESS
-- day. But `orders_daily_agg.day` is the IST CALENDAR date — `(o.created_at AT TIME ZONE
-- 'Asia/Kolkata')::date`, migration 190 — so the rollup simply has no way to answer a 05:00
-- window.
--
-- lfh_owner_sales_report knows this. Its `fences` CTE only lets the rollup answer a MONTH bucket
-- and reads live orders for everything else, which is why the day sheet's money lines are right.
-- lfh_owner_payment_breakdown had no fence at all: its `hist` branch fenced on
--   a.day >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
--   a.day <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date
-- which rounds 05:00→05:00 out to the whole calendar day — picking up 00:00–05:00 of the day
-- asked for (which belongs to the PREVIOUS business day) and dropping 00:00–05:00 of the next
-- (which belongs to this one).
--
-- MEASURED ON THE BACKUP BEFORE THIS FIX (read-only, French House, forced recompute each time).
-- "BIZ" = what the day sheet asked for; "CAL" = the plain calendar day:
--     business day   Total collected tile   Settlement panel   the calendar day's money
--     20 Aug         ₹12,558  (13 bills)    ₹9,660  (10)       ₹9,660  (10)
--     21 Aug         ₹31,773  (31 bills)    ₹5,796  (6)        ₹5,796  (6)
--     22 Aug         ₹94,952  (118 bills)   ₹1,23,386 (145)    ₹1,23,386 (145)
--     23 Aug         ₹0       (0 bills)     ₹441    (1)        ₹441    (1)
--   The Settlement column is EXACTLY the calendar day's figure on all four — that is the proof of
--   the mechanism, not a coincidence. 23 Aug is the one that reads worst on screen: the sheet says
--   "Nothing has been billed on this day yet" and then lists Cash ₹441 underneath it.
--   26 Aug (today) agreed, because today is past the rollup watermark and answered by the live
--   tail, which was always fenced on the real timestamps. That is why this only shows on a PAST
--   day and never on the one you are looking at while it happens.
--
-- THE FIX. One `fences` CTE, the same shape lfh_owner_sales_report already uses: the rollup is
-- allowed to answer only when p_from really is IST midnight. When it is not, hist_max_day drops to
-- '-infinity' (the rollup contributes nothing) and tail_start drops to '-infinity' (the live
-- branch, which was always fenced on the exact timestamps, covers the whole window). Nothing else
-- in the body is touched: same UNION ALL with its columns named on both sides (mig 337), same
-- split-payment leg weighting, same khata/pay-later dating (migs 185/317), same work_mem, same
-- HAVING that keeps a split bill's non-primary method.
--
-- WHAT DOES NOT CHANGE. Every window that starts at IST midnight — 7 days, 30 days, this month,
-- last month, 12 months, FY, all time, and every custom range — still reads the rollup exactly as
-- it did. Only the three business-day windows move, and each is one day of live orders on an
-- indexed column, which is far less work than lfh_owner_sales_report already does for a 30-day
-- report.
--
-- NOT ONE STORED BILL IS REWRITTEN. total, subtotal, discount, tax, disc_gross, net_amount,
-- payment_method and tax_rate are untouched on every row (the billing guardrail). This is a READ
-- path only: one CREATE OR REPLACE, which keeps the existing grants.
--
-- lfh_owner_revenue_timeseries has a fence of its own (rollup only when p_bucket = 'day') and is
-- NOT touched: every day-bucket window this app asks for starts at IST midnight, and the two
-- business-day ranges ask for HOUR buckets, which already skip the rollup. It is correct today —
-- but it is correct because of the bucket, not because of the alignment, so if a day-bucket
-- business-day window is ever added it will need the same fence. npm run verify:owner-reports now
-- says so out loud.

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
  -- ── THE ROLLUP IS KEYED BY THE IST CALENDAR DAY, SO IT CANNOT ANSWER A 05:00 WINDOW ────────
  -- orders_daily_agg.day is (o.created_at AT TIME ZONE 'Asia/Kolkata')::date (mig 190), i.e. a
  -- CALENDAR day. `hist` below fenced on ((p_from|p_to) AT TIME ZONE 'Asia/Kolkata')::date, which
  -- silently rounds a BUSINESS-day window (05:00 IST -> 05:00 IST) out to whole calendar days.
  -- So use the rollup ONLY when p_from really is IST midnight; otherwise read the live orders for
  -- the whole window, exactly the way lfh_owner_sales_report's own `fences` CTE already does for
  -- every non-month bucket. That is why the money side of the day sheet was right and this side
  -- was not.
  fences AS (
    SELECT (p_from = date_trunc('day', p_from AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS use_rollup
  ),
  bounds AS (
    SELECT CASE WHEN (SELECT use_rollup FROM fences) THEN (SELECT rolled_through FROM wm)
                ELSE '-infinity'::date END AS hist_max_day,
           CASE WHEN (SELECT use_rollup FROM fences) THEN (SELECT tail_start FROM wm)
                ELSE '-infinity'::timestamptz END AS tail_start
  ),
  hist AS (
    SELECT a.restaurant_id, a.method, SUM(a.gross_paid) gp, SUM(a.disc_paid) dp,
           SUM(COALESCE(a.net_paid, a.gross_paid - COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id))))) net,
           SUM(COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id)))) dpg,
           SUM(a.paid_orders) po
    FROM orders_daily_agg a
    WHERE a.day <= (SELECT hist_max_day FROM bounds)
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
      AND (o.created_at >= (SELECT tail_start FROM bounds)
           OR (o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL AND o.paid_at >= (SELECT tail_start FROM bounds)))
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
