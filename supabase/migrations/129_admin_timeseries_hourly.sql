-- Admin analytics "Today" range: HOURLY buckets (adaptive time-axis rule — a
-- one-day window must tick by hours, never one flat day bucket).
--
-- ADDITIVE: a 4-arg OVERLOAD of lfh_admin_orders_timeseries. The existing 3-arg
-- day-bucket version stays untouched (the per-restaurant Report still calls it);
-- PostgREST picks the overload by the named args the caller sends.

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
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
  GROUP BY 1
  ORDER BY 1;
$$;

-- Staff-only, like every admin RPC (migration 038 rule).
REVOKE EXECUTE ON FUNCTION lfh_admin_orders_timeseries(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_admin_orders_timeseries(uuid, timestamptz, timestamptz, text) TO service_role;

NOTIFY pgrst, 'reload schema';
