-- 137_admin_counts_exclude_cancelled.sql
-- BUG (owner report 2026-07-06): the ADMIN dashboards count CANCELLED orders in their
-- order totals / busiest-restaurants / trend / by-source, while the OWNER dashboards for the
-- SAME restaurant EXCLUDE cancelled (mig 121 explicitly aligned the owner card to its drill-in
-- at 288, not 370). So one restaurant shows two different order counts depending on which panel
-- you look at — the exact "same number, two answers" class we're stamping out. App rule is
-- "the same number everywhere"; align admin to the owner definition (exclude cancelled).
--
-- Redefines the three admin count RPCs to add `o.status <> 'cancelled'`. busiest keeps the
-- deleted_at guard from mig 135. by_source only filters the dine-in (orders-table) leg;
-- aggregator_orders has its own lifecycle and is left untouched.

CREATE OR REPLACE FUNCTION lfh_admin_orders_timeseries(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (bucket date, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (date_trunc('day', o.created_at AT TIME ZONE 'Asia/Kolkata'))::date AS bucket,
         COUNT(*)::bigint AS orders
  FROM orders o
  WHERE o.created_at >= p_from AND o.created_at < p_to
    AND o.status <> 'cancelled'
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
  GROUP BY 1
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION lfh_admin_busiest_restaurants(p_from timestamptz, p_to timestamptz, p_limit int)
RETURNS TABLE (restaurant_id uuid, slug text, name text, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.slug, r.name, COUNT(o.id)::bigint AS orders
  FROM restaurants r
  LEFT JOIN orders o ON o.restaurant_id = r.id AND o.created_at >= p_from AND o.created_at < p_to
                    AND o.status <> 'cancelled'
  WHERE r.deleted_at IS NULL
  GROUP BY r.id, r.slug, r.name
  ORDER BY 4 DESC
  LIMIT GREATEST(COALESCE(p_limit, 10), 1);
$$;

CREATE OR REPLACE FUNCTION lfh_admin_orders_by_source(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (source text, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'dine_in'::text AS source, COUNT(*)::bigint AS orders
  FROM orders o WHERE o.created_at >= p_from AND o.created_at < p_to
    AND o.status <> 'cancelled'
  UNION ALL
  SELECT a.source, COUNT(*)::bigint
  FROM aggregator_orders a WHERE a.created_at >= p_from AND a.created_at < p_to
  GROUP BY a.source;
$$;

DO $$ DECLARE f text;
BEGIN
  FOR f IN SELECT unnest(ARRAY[
    'lfh_admin_orders_timeseries(uuid, timestamptz, timestamptz)',
    'lfh_admin_busiest_restaurants(timestamptz, timestamptz, int)',
    'lfh_admin_orders_by_source(timestamptz, timestamptz)'
  ]) LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
