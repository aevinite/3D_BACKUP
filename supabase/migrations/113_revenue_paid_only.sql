-- 113_revenue_paid_only.sql
--
-- Owner (2026-07-02): "the revenue is different in the dashboard [vs the bills
-- section] — it should be like everywhere the same." Root cause: lfh_owner_overview
-- (088) and the five lfh_owner_* analytics RPCs (089) summed (total - discount) for
-- every NON-CANCELLED order — including ones still unpaid — while the Z-report and
-- the Bills tab only ever count a bill once it's actually SETTLED. The 088 comment
-- even claims to "mirror the admin Overview's revenue rule", but
-- app/api/admin/overview/route.ts (the original, single-restaurant admin dashboard)
-- ALREADY filters payment_status = 'paid' — 088/089 just never carried that filter
-- over. This migration is that missing filter, applied consistently everywhere
-- "revenue" is a money figure, so every dashboard/report agrees with the Bills tab
-- (which only ever shows a bill once its money is actually collected).
--
-- Dish/category qty (items ordered) are UNCHANGED — those describe kitchen volume,
-- not money collected, and aren't what disagreed. Only the ₹ revenue columns gain
-- the paid filter, via CREATE OR REPLACE (additive: same signature, same callers).

CREATE OR REPLACE FUNCTION lfh_owner_overview()
RETURNS TABLE (
  restaurant_id    uuid,
  slug             text,
  name             text,
  active           boolean,
  accent_color     text,
  orders_today     bigint,
  revenue_today    numeric,
  orders_all       bigint,
  revenue_all      numeric,
  open_tables      bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  day_start AS (
    SELECT (((now() AT TIME ZONE 'Asia/Kolkata') - interval '5 hours')::date
            + interval '5 hours') AT TIME ZONE 'Asia/Kolkata' AS ts
  ),
  ord AS (
    SELECT
      o.restaurant_id,
      COUNT(*) FILTER (WHERE o.created_at >= (SELECT ts FROM day_start))                          AS orders_today,
      COALESCE(SUM((o.total - o.discount))
        FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
                  AND o.created_at >= (SELECT ts FROM day_start)), 0)                              AS revenue_today,
      COUNT(*)                                                                                     AS orders_all,
      COALESCE(SUM(o.total - o.discount)
        FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)                   AS revenue_all
    FROM orders o
    GROUP BY o.restaurant_id
  ),
  sess AS (
    SELECT s.restaurant_id, COUNT(*) AS open_tables
    FROM sessions s
    WHERE s.status = 'open'
    GROUP BY s.restaurant_id
  )
  SELECT
    r.id, r.slug, r.name, r.active, r.accent_color,
    COALESCE(ord.orders_today, 0)::bigint,
    COALESCE(ord.revenue_today, 0)::numeric,
    COALESCE(ord.orders_all, 0)::bigint,
    COALESCE(ord.revenue_all, 0)::numeric,
    COALESCE(sess.open_tables, 0)::bigint
  FROM restaurants r
  LEFT JOIN ord  ON ord.restaurant_id  = r.id
  LEFT JOIN sess ON sess.restaurant_id = r.id
  ORDER BY r.name;
$$;

CREATE OR REPLACE FUNCTION lfh_owner_restaurant_revenue(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (restaurant_id uuid, slug text, name text, accent_color text, revenue numeric, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.slug, r.name, r.accent_color,
         COALESCE(SUM(o.total - o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(o.id) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid')::bigint
  FROM restaurants r
  LEFT JOIN orders o ON o.restaurant_id = r.id AND o.created_at >= p_from AND o.created_at < p_to
  GROUP BY r.id, r.slug, r.name, r.accent_color
  ORDER BY 5 DESC;
$$;

CREATE OR REPLACE FUNCTION lfh_owner_revenue_timeseries(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz, p_bucket text)
RETURNS TABLE (bucket timestamptz, restaurant_id uuid, revenue numeric, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT date_trunc(COALESCE(NULLIF(p_bucket, ''), 'day'),
                    o.created_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
         o.restaurant_id,
         COALESCE(SUM(o.total - o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid')::bigint
  FROM orders o
  WHERE o.created_at >= p_from AND o.created_at < p_to
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
  GROUP BY 1, 2
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION lfh_owner_hourly(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (hour int, orders bigint, revenue numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXTRACT(hour FROM o.created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint,
         COALESCE(SUM(o.total - o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric
  FROM orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.created_at >= p_from AND o.created_at < p_to
  GROUP BY 1
  ORDER BY 1;
$$;

-- lfh_owner_dish_breakdown / lfh_owner_category_breakdown are left as-is: they
-- report dish/category QTY (kitchen volume), which by design counts every
-- non-cancelled order regardless of payment — not a "revenue" figure, so not
-- part of this consistency fix.

REVOKE EXECUTE ON FUNCTION lfh_owner_overview() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_owner_overview() TO service_role;
DO $$ DECLARE f text;
BEGIN
  FOR f IN SELECT unnest(ARRAY[
    'lfh_owner_restaurant_revenue(timestamptz, timestamptz)',
    'lfh_owner_revenue_timeseries(uuid, timestamptz, timestamptz, text)',
    'lfh_owner_hourly(uuid, timestamptz, timestamptz)'
  ]) LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
