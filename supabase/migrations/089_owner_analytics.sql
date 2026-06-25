-- 089_owner_analytics.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Owner dashboard analytics RPCs (the drill-down charts). Each does ALL its
-- aggregation in Postgres in ONE grouped query and returns tiny pre-summed rows
-- — never N round-trips, never scanning orders in JS (accuracy + egress).
-- Revenue = SUM(total - discount) for non-cancelled orders (matches the admin
-- Overview + lfh_owner_overview rule). Times bucketed in Asia/Kolkata.
-- All STABLE SECURITY DEFINER + service_role-only (the /owner API holds the key
-- behind the admin cookie gate; new funcs are PUBLIC-executable by default — lock).
-- ─────────────────────────────────────────────────────────────────────────

-- Revenue + orders PER restaurant over a window → "who earns more" bar + group totals.
CREATE OR REPLACE FUNCTION lfh_owner_restaurant_revenue(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (restaurant_id uuid, slug text, name text, accent_color text, revenue numeric, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.slug, r.name, r.accent_color,
         COALESCE(SUM(o.total - o.discount) FILTER (WHERE o.status <> 'cancelled'), 0)::numeric,
         COUNT(o.id) FILTER (WHERE o.status <> 'cancelled')::bigint
  FROM restaurants r
  LEFT JOIN orders o ON o.restaurant_id = r.id AND o.created_at >= p_from AND o.created_at < p_to
  GROUP BY r.id, r.slug, r.name, r.accent_color
  ORDER BY 5 DESC;
$$;

-- Revenue/orders per time bucket → line charts. p_restaurant_id NULL = ALL
-- restaurants (one row per bucket per restaurant, for multi-line). p_bucket: 'hour'|'day'|'week'.
CREATE OR REPLACE FUNCTION lfh_owner_revenue_timeseries(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz, p_bucket text)
RETURNS TABLE (bucket timestamptz, restaurant_id uuid, revenue numeric, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT date_trunc(COALESCE(NULLIF(p_bucket, ''), 'day'),
                    o.created_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
         o.restaurant_id,
         COALESCE(SUM(o.total - o.discount) FILTER (WHERE o.status <> 'cancelled'), 0)::numeric,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint
  FROM orders o
  WHERE o.created_at >= p_from AND o.created_at < p_to
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
  GROUP BY 1, 2
  ORDER BY 1;
$$;

-- Per-dish qty + revenue (dish table + top dishes). Aggregates from orders.items
-- (JSONB, always populated: {title, slug, qty, price}) rather than the order_items
-- denormalization (which can be empty for non-dine-in / imported orders). Gross
-- dish revenue = qty * unit price.
CREATE OR REPLACE FUNCTION lfh_owner_dish_breakdown(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (title text, qty bigint, revenue numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT it->>'title' AS title,
         COALESCE(SUM((it->>'qty')::numeric), 0)::bigint AS qty,
         COALESCE(SUM((it->>'qty')::numeric * (it->>'price')::numeric), 0)::numeric AS revenue
  FROM orders o
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS it
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status <> 'cancelled'
    AND o.created_at >= p_from AND o.created_at < p_to
    AND COALESCE(it->>'title', '') <> ''
  GROUP BY it->>'title'
  ORDER BY 3 DESC;
$$;

-- Per-category revenue (donut). Aggregates from orders.items (JSONB); category
-- resolved via menu_items by (restaurant_id, slug).
CREATE OR REPLACE FUNCTION lfh_owner_category_breakdown(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (category text, qty bigint, revenue numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(mi.category, 'Other') AS category,
         COALESCE(SUM((it->>'qty')::numeric), 0)::bigint AS qty,
         COALESCE(SUM((it->>'qty')::numeric * (it->>'price')::numeric), 0)::numeric AS revenue
  FROM orders o
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS it
  LEFT JOIN menu_items mi ON mi.restaurant_id = o.restaurant_id AND mi.slug = (it->>'slug')
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status <> 'cancelled'
    AND o.created_at >= p_from AND o.created_at < p_to
  GROUP BY 1
  ORDER BY 3 DESC;
$$;

-- Orders/revenue by hour-of-day (busy times), 0–23 in IST.
CREATE OR REPLACE FUNCTION lfh_owner_hourly(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (hour int, orders bigint, revenue numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXTRACT(hour FROM o.created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint,
         COALESCE(SUM(o.total - o.discount) FILTER (WHERE o.status <> 'cancelled'), 0)::numeric
  FROM orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.created_at >= p_from AND o.created_at < p_to
  GROUP BY 1
  ORDER BY 1;
$$;

-- Lock all five to service_role only (REVOKE the default PUBLIC execute).
DO $$ DECLARE f text;
BEGIN
  FOR f IN SELECT unnest(ARRAY[
    'lfh_owner_restaurant_revenue(timestamptz, timestamptz)',
    'lfh_owner_revenue_timeseries(uuid, timestamptz, timestamptz, text)',
    'lfh_owner_dish_breakdown(uuid, timestamptz, timestamptz)',
    'lfh_owner_category_breakdown(uuid, timestamptz, timestamptz)',
    'lfh_owner_hourly(uuid, timestamptz, timestamptz)'
  ]) LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
