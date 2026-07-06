-- 139_admin_orders_today_exclude_cancelled.sql
-- BUG (admin audit 2026-07-06): two admin RPCs still COUNT cancelled orders, while the
-- KPI numbers next to them EXCLUDE cancelled (mig 137). That produced the exact
-- "same number, two answers" the app is stamping out:
--   • Platform Analytics: the KPI tile / "busiest" / "by source" excluded cancelled, but
--     the TREND CHART (the 4-arg hourly/daily overload of lfh_admin_orders_timeseries,
--     mig 129) did NOT — so "0 orders today" sat on top of a chart full of bars.
--   • Live floor: lfh_admin_floor_stats.orders_today = COUNT(*) with no status filter,
--     so the floor showed "4 orders today" while the Dashboard overview (excludes
--     cancelled) showed "0" for the same platform, same day.
-- Fix: add `o.status <> 'cancelled'` to BOTH, matching mig 137's definition. This keeps
-- ONE meaning of "orders" everywhere in the admin panel.
--
-- Base versions: 4-arg timeseries = mig 129 (only definition); floor_stats = mig 134
-- (only definition). No later migration redefines either (verified before editing).

-- 1) The 4-arg (hourly/daily) analytics trend overload — add the cancelled exclusion.
CREATE OR REPLACE FUNCTION lfh_admin_orders_timeseries(
  p_restaurant_id uuid, p_from timestamptz, p_to timestamptz, p_bucket text)
RETURNS TABLE (bucket timestamptz, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT date_trunc(
           CASE WHEN p_bucket = 'hour' THEN 'hour' ELSE 'day' END,
           o.created_at AT TIME ZONE 'Asia/Kolkata'
         ) AT TIME ZONE 'Asia/Kolkata' AS bucket,
         COUNT(*)::bigint AS orders
  FROM orders o
  WHERE o.created_at >= p_from AND o.created_at < p_to
    AND o.status <> 'cancelled'
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
  GROUP BY 1
  ORDER BY 1;
$$;

REVOKE EXECUTE ON FUNCTION lfh_admin_orders_timeseries(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_admin_orders_timeseries(uuid, timestamptz, timestamptz, text) TO service_role;

-- 2) Live-floor per-restaurant stats — exclude cancelled from orders_today so it mirrors
--    the Dashboard overview (which already excludes cancelled). active/unpaid already
--    exclude cancelled via their own FILTERs; only the headline orders_today was raw.
--    ADDITIVE: also return paid_today (bills settled today) + cancelled_today so the new
--    admin "Today" tab can reuse this ONE snapshot (no extra fetch/poll — egress-free).
-- The return signature grows (adds paid_today + cancelled_today), and Postgres refuses to
-- CHANGE the OUT columns of an existing function via CREATE OR REPLACE — so DROP it first.
-- No-arg overload, so this drop is unambiguous; nothing else defines lfh_admin_floor_stats().
DROP FUNCTION IF EXISTS lfh_admin_floor_stats();
CREATE OR REPLACE FUNCTION lfh_admin_floor_stats()
RETURNS TABLE (
  restaurant_id   uuid,
  orders_today    bigint,
  active_orders   bigint,
  unpaid_orders   bigint,
  paid_today      bigint,
  cancelled_today bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH day_start AS (
    SELECT (((now() AT TIME ZONE 'Asia/Kolkata') - interval '5 hours')::date
            + interval '5 hours') AT TIME ZONE 'Asia/Kolkata' AS ts
  )
  SELECT
    o.restaurant_id,
    COUNT(*) FILTER (WHERE o.status <> 'cancelled')                                 AS orders_today,
    COUNT(*) FILTER (WHERE NOT o.archived
                       AND o.status IN ('received', 'preparing'))                   AS active_orders,
    COUNT(*) FILTER (WHERE NOT o.archived
                       AND o.status <> 'cancelled'
                       AND o.payment_status <> 'paid')                              AS unpaid_orders,
    COUNT(*) FILTER (WHERE o.status <> 'cancelled'
                       AND o.payment_status = 'paid')                               AS paid_today,
    COUNT(*) FILTER (WHERE o.status = 'cancelled')                                  AS cancelled_today
  FROM orders o
  WHERE o.created_at >= (SELECT ts FROM day_start)
  GROUP BY o.restaurant_id;
$$;

REVOKE EXECUTE ON FUNCTION lfh_admin_floor_stats() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_admin_floor_stats() TO service_role;

NOTIFY pgrst, 'reload schema';
