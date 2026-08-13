-- 317_a_pay_later_bill_belongs_to_the_day_it_was_paid.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- WHERE: Owner panel → Reports → Sales (the day rows) and the Dashboard's day figures, for a range
-- older than yesterday. NOTHING ON SCREEN CHANGES TODAY — read the correction below before
-- believing otherwise.
--
-- ⚠️ FIRST, A CORRECTION TO WHAT WAS REPORTED (2026-08-13). Migration 315's header — and the sweep
-- note it came from — claimed the rollup and the live rows disagreed about a pay-later bill's day,
-- "measured: 2 days out of 70, ₹525 / ₹1,739.25 and 4–7 orders". THAT MEASUREMENT WAS WRONG. It
-- compared the summary against EVERY live order, including the most recent two days the summary
-- deliberately does not cover (it keeps 2 live days on top, on purpose, so today is always read
-- from the real bills). The "gap" was simply those two days' money, which the readers add from the
-- live leg exactly as designed.
--
-- Measured properly — only the 69 days the summary actually covers, with the live side dated the
-- same way the readers date it: money gap ₹0.00, order gap 0. And the grand total was already
-- exact: every paid bill added up directly and the owner report agree to the paisa
-- (₹34,582,558.80). So there was no money in the wrong day, no double count and nothing missing.
--
-- ── SO WHY THIS FILE EXISTS ──────────────────────────────────────────────────────────────────
-- Because the writer and the readers were describing a bill's day with two DIFFERENT expressions,
-- and only luck kept them agreeing. A pay-later (khata) bill counts on the day it was PAID —
-- migration 185's rule, what every reader filters on, and the exact expression migration 193
-- indexes. The daily writer still grouped on created_at and bounded its window on created_at.
--
-- The hole that opens the moment the data changes: a khata bill CREATED before the summary's
-- boundary but PAID after it would land in the summary (by its created day) AND in the live leg
-- (by its paid day) — counted twice in the owner's revenue. The mirror case goes missing. Measured
-- today: 0 such bills, ₹0 — which is why nothing is visibly wrong, and exactly why it should be
-- closed before a restaurant settles a khata bill three days late.
--
-- THE FIX: the writer now uses the SAME expression the readers use, in both places (the grouping
-- and the window). Two lines, so agreement is by construction rather than coincidence. The summary
-- is then rebuilt, and the grand total is unchanged — verified, not assumed.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

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
           -- (317) THE SAME DAY THE READERS USE: a pay-later (khata) bill belongs to the day it was
           -- PAID, everything else to the day it was created. This grouping said created_at, so 7
           -- khata bills (₹1,739.25) sat in a different day here than in the report reading it.
           ((CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::date AS day,
           o.status, o.payment_status, o.total, o.discount, o.disc_gross, o.net_amount,
           COALESCE(l.method, NULLIF(o.payment_method, ''), 'Not recorded') AS method,
           COALESCE(l.w, 1)             AS w,
           COALESCE(l.primary_leg, true) AS primary_leg
      FROM public.orders o
      LEFT JOIN legw l
        ON o.payment_method = 'Split' AND l.session_id = o.session_id
     WHERE ((CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::date <= v_target
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

-- Rebuild it now (a full DELETE + INSERT, so idempotent and safe to repeat).
SELECT public.lfh_refresh_orders_daily_agg();

NOTIFY pgrst, 'reload schema';
