-- 202_owner_report_month_fingerprint.sql
--
-- Cuts the LAST slow bit of a cold/refresh WIDE owner report.
-- The compute-on-view cache (mig 196) decides "did the data change?" via
-- lfh_owner_orders_fingerprint, which for a wide range (12m / FY / all-time) FULL-SCANS
-- all ~398k orders (~9.5s: it reads greatest() of 5 timestamp columns per row). Cache HITS
-- never pay it (they're ~0.2s), but every COLD open / Refresh does. Now that wide reports
-- read the monthly rollup (mig 201), their output only changes from (a) the current-month
-- live tail or (b) the nightly rebuild folding edited history in -- so the change-detector
-- can be derived the SAME way instead of scanning all history.
--
-- WIN-WIN, no new load:
--   * READ load DROPS: the wide fingerprint reads ~60 rollup rows + the current-month tail
--     (~48k, already covered by idx_orders_created_covering => ~35ms) instead of ~398k rows.
--   * NO new index, NO per-order trigger -> zero extra WRITE load. The only new write is one
--     timestamp bumped by the already-nightly rebuild.
--   * The DASHBOARD's fingerprint is UNTOUCHED (the route uses this only for month-bucket
--     reports), so nothing there recomputes more often.
--   * A fingerprint can only change WHEN a report recomputes, never the stored numbers -- the
--     payload is always freshly computed by the penny-verified report function.
--
-- Correctness: refreshed_at bumps on every nightly rebuild (captures edited/late history
-- folding into frozen months); the tail's count + max-activity captures every new order,
-- payment, cancellation or edit in the current month. Frozen months can't change a wide
-- report's output between rebuilds, so not reacting to an intra-day edit of old data is
-- correct (the output is identical until the rebuild).

-- ── 1. a single "last rebuilt" signal on the state row (set nightly, not per-order) ─
ALTER TABLE public.orders_report_monthly_agg_state
  ADD COLUMN IF NOT EXISTS refreshed_at timestamptz NOT NULL DEFAULT now();

-- ── 2. bump refreshed_at inside the existing nightly rebuild ─────────────────────
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

  UPDATE public.orders_report_monthly_agg_state
     SET rolled_through_month = v_target, refreshed_at = now()
   WHERE only_one;
END;
$function$;
REVOKE ALL ON FUNCTION public.lfh_refresh_orders_report_monthly_agg() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_refresh_orders_report_monthly_agg() TO service_role;

-- keep refreshed_at honest for the current data
SELECT public.lfh_refresh_orders_report_monthly_agg();

-- ── 3. the cheap month-report change-detector (rollup + current-month tail) ───────
-- Same shape as lfh_owner_orders_fingerprint ("<count>:<max-activity-epoch>") so the
-- cache treats it identically -- just sourced from the rollup + tail, not a full scan.
CREATE OR REPLACE FUNCTION public.lfh_owner_report_month_fingerprint(p_ids uuid[], p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH
  wm AS (
    SELECT rolled_through_month, refreshed_at,
           ((date_trunc('month', rolled_through_month) + interval '1 month')::timestamp
              AT TIME ZONE 'Asia/Kolkata') AS tail_start
    FROM orders_report_monthly_agg_state
  ),
  frozen AS (
    SELECT COALESCE(SUM(a.all_orders + a.canc_orders), 0) AS cnt
    FROM orders_report_monthly_agg a
    WHERE a.month <= (SELECT rolled_through_month FROM wm)
      AND a.month >= date_trunc('month', (p_from AT TIME ZONE 'Asia/Kolkata'))::date
      AND (p_ids IS NULL OR a.restaurant_id = ANY (p_ids))
  ),
  tail AS (
    SELECT count(*) AS cnt,
           max(greatest(o.created_at, o.edited_at, o.paid_at, o.cancelled_at, o.deleted_at)) AS act
    FROM orders o
    WHERE o.created_at >= (SELECT tail_start FROM wm)
      AND o.created_at <  p_to
      AND (p_ids IS NULL OR o.restaurant_id = ANY (p_ids))
  )
  SELECT ((SELECT cnt FROM frozen) + (SELECT cnt FROM tail))::text || ':' ||
         coalesce(extract(epoch FROM greatest((SELECT refreshed_at FROM wm), (SELECT act FROM tail)))::bigint::text, '0');
$function$;
REVOKE ALL ON FUNCTION public.lfh_owner_report_month_fingerprint(uuid[], timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_report_month_fingerprint(uuid[], timestamptz, timestamptz) TO service_role;
