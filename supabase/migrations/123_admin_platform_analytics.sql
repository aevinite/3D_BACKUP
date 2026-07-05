-- 119_admin_platform_analytics.sql — cross-restaurant OPERATIONAL analytics for
-- the admin panel (Analytics, per-restaurant Report, System health). NO revenue —
-- order COUNTS only (CLAUDE.md hard rule: no food-revenue anywhere in /aevinite).
-- Mirrors the 089_owner_analytics.sql pattern: all aggregation done in ONE grouped
-- SQL query server-side, never N round-trips or a raw-orders fetch to the client.
-- All STABLE SECURITY DEFINER + service_role-only (new funcs are PUBLIC-executable
-- by default — lock them, same gotcha 089/038 already document).

-- Orders-per-day counts. p_restaurant_id NULL = platform-wide (every restaurant,
-- one row per day); non-null = that one restaurant only. Used for the platform
-- trend chart AND the per-restaurant report sparkline (same function, one path).
CREATE OR REPLACE FUNCTION lfh_admin_orders_timeseries(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (bucket date, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (date_trunc('day', o.created_at AT TIME ZONE 'Asia/Kolkata'))::date AS bucket,
         COUNT(*)::bigint AS orders
  FROM orders o
  WHERE o.created_at >= p_from AND o.created_at < p_to
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
  GROUP BY 1
  ORDER BY 1;
$$;

-- Busiest restaurants by ORDER COUNT (not money) over the window, for the
-- Analytics "busiest restaurants" table. "Active tables now" is NOT time-ranged
-- so the API adds it in JS from a separate tiny open-sessions query.
CREATE OR REPLACE FUNCTION lfh_admin_busiest_restaurants(p_from timestamptz, p_to timestamptz, p_limit int)
RETURNS TABLE (restaurant_id uuid, slug text, name text, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.slug, r.name, COUNT(o.id)::bigint AS orders
  FROM restaurants r
  LEFT JOIN orders o ON o.restaurant_id = r.id AND o.created_at >= p_from AND o.created_at < p_to
  GROUP BY r.id, r.slug, r.name
  ORDER BY 4 DESC
  LIMIT GREATEST(COALESCE(p_limit, 10), 1);
$$;

-- Order counts split dine-in vs platform aggregator source (Zomato/Swiggy/
-- takeaway/other), across the whole platform for the window — order counts only.
CREATE OR REPLACE FUNCTION lfh_admin_orders_by_source(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (source text, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'dine_in'::text AS source, COUNT(*)::bigint AS orders
  FROM orders o WHERE o.created_at >= p_from AND o.created_at < p_to
  UNION ALL
  SELECT a.source, COUNT(*)::bigint
  FROM aggregator_orders a WHERE a.created_at >= p_from AND a.created_at < p_to
  GROUP BY a.source;
$$;

-- Cheap PLANNER row-count ESTIMATES (pg_class.reltuples — metadata only, zero
-- table scan) for the System health page's "how big are the big tables" panel.
-- These are approximate (updated by autovacuum/ANALYZE), which is fine and
-- clearly labelled as an estimate in the UI — an exact COUNT(*) on a
-- multi-million-row table is exactly the "hammer the DB" cost this avoids.
CREATE OR REPLACE FUNCTION lfh_admin_table_estimates()
RETURNS TABLE (table_name text, est_rows bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.relname::text, GREATEST(c.reltuples, 0)::bigint
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND c.relname IN ('orders', 'order_items', 'sessions', 'staff_users', 'restaurants');
$$;

DO $$ DECLARE f text;
BEGIN
  FOR f IN SELECT unnest(ARRAY[
    'lfh_admin_orders_timeseries(uuid, timestamptz, timestamptz)',
    'lfh_admin_busiest_restaurants(timestamptz, timestamptz, int)',
    'lfh_admin_orders_by_source(timestamptz, timestamptz)',
    'lfh_admin_table_estimates()'
  ]) LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
