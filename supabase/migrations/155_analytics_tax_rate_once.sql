-- 155_analytics_tax_rate_once.sql
--
-- WHY: after the demo-history seed (2026-07-20) the orders table holds ~400k rows,
-- and every owner/admin analytics RPC was calling lfh_effective_tax_rate(o.restaurant_id)
-- PER ORDER ROW inside its SUM. That function does a settings lookup + JSONB parse per
-- call, so lfh_owner_overview(null) ran ~800k settings lookups and died at the DB's 8s
-- statement timeout → the admin dashboard hung and /api/admin/analytics 500'd (it fails
-- the whole response when any sub-query errors). The owner panel overview uses the same
-- RPC, so it broke too.
--
-- FIX (semantics unchanged — same numbers, same signatures, callers untouched):
--   1. Resolve the tax rate ONCE:
--      - single-restaurant functions: (SELECT lfh_effective_tax_rate(p_restaurant_id))
--        → an InitPlan, evaluated once per query, not per row.
--      - multi-restaurant functions: a rates CTE marked MATERIALIZED, joined by
--        restaurant_id. MATERIALIZED is load-bearing: a plain CTE referenced once gets
--        inlined by the planner and the function call is pushed back down to per-row.
--   2. Covering indexes so the analytics aggregates are index-only scans instead of
--      seq scans + per-row heap fetches over the (now ~160MB) orders heap. The INCLUDE
--      lists carry EVERY column these RPCs aggregate (subtotal + payment_method matter:
--      without them sales_report/payment_breakdown still heap-fetched 398k rows and
--      timed out). They supersede idx_orders_created_at (same key, wider payload),
--      which is dropped. Applied live 2026-07-21 via CREATE INDEX CONCURRENTLY; the
--      plain IF NOT EXISTS here is for fresh environments.
--
-- Measured on prod: lfh_owner_overview(null) 8s-timeout → ~0.4s warm;
-- 6-month sales report / payment breakdown 8s-timeout → ~0.2–0.4s.
-- All bodies below are based on the LIVE definitions (pg_get_functiondef, 2026-07-21),
-- not on older migration copies (see "migration recreate reverts a fix" lesson).
-- CREATE OR REPLACE preserves each function's existing GRANTs.

CREATE INDEX IF NOT EXISTS idx_orders_analytics_covering
  ON orders (restaurant_id, created_at)
  INCLUDE (status, payment_status, total, discount, subtotal, payment_method);
CREATE INDEX IF NOT EXISTS idx_orders_created_covering
  ON orders (created_at)
  INCLUDE (restaurant_id, status, payment_status);
DROP INDEX IF EXISTS idx_orders_overview_covering; -- interim shape, superseded above
DROP INDEX IF EXISTS idx_orders_created_at;        -- plain key, superseded above

-- ── lfh_owner_overview: MATERIALIZED rates join (was 2 per-row calls) ─────────
CREATE OR REPLACE FUNCTION public.lfh_owner_overview(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(restaurant_id uuid, slug text, name text, active boolean, accent_color text, orders_today bigint, revenue_today numeric, orders_all bigint, revenue_all numeric, open_tables bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH
  day_start AS (
    SELECT (((now() AT TIME ZONE 'Asia/Kolkata') - interval '5 hours')::date
            + interval '5 hours') AT TIME ZONE 'Asia/Kolkata' AS ts
  ),
  rates AS MATERIALIZED (
    SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r
  ),
  ord AS (
    SELECT
      o.restaurant_id,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled'
                         AND o.created_at >= (SELECT ts FROM day_start))                          AS orders_today,
      COALESCE(SUM(o.total - o.discount * (1 + rt.rate))
        FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
                  AND o.created_at >= (SELECT ts FROM day_start)), 0)                              AS revenue_today,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled')                                              AS orders_all,
      COALESCE(SUM(o.total - o.discount * (1 + rt.rate))
        FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)                   AS revenue_all
    FROM orders o
    JOIN rates rt ON rt.rid = o.restaurant_id
    WHERE (p_ids IS NULL OR o.restaurant_id = ANY(p_ids))
    GROUP BY o.restaurant_id
  ),
  sess AS (
    SELECT s.restaurant_id, COUNT(*) AS open_tables
    FROM sessions s
    WHERE s.status = 'open'
      AND (p_ids IS NULL OR s.restaurant_id = ANY(p_ids))
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
  WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
  ORDER BY r.name;
$function$;

-- ── lfh_owner_restaurant_revenue: MATERIALIZED rates join ─────────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_restaurant_revenue(p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(restaurant_id uuid, slug text, name text, accent_color text, revenue numeric, orders bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH rates AS MATERIALIZED (
    SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r
  )
  SELECT r.id, r.slug, r.name, r.accent_color,
         COALESCE(SUM(o.total - o.discount * (1 + rt.rate)) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(o.id) FILTER (WHERE o.status <> 'cancelled')::bigint
  FROM restaurants r
  LEFT JOIN orders o ON o.restaurant_id = r.id AND o.created_at >= p_from AND o.created_at < p_to
  LEFT JOIN rates rt ON rt.rid = r.id
  WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
  GROUP BY r.id, r.slug, r.name, r.accent_color
  ORDER BY 5 DESC;
$function$;

-- ── lfh_owner_revenue_timeseries: MATERIALIZED rates join (rid can be NULL) ──
CREATE OR REPLACE FUNCTION public.lfh_owner_revenue_timeseries(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_bucket text, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(bucket timestamp with time zone, restaurant_id uuid, revenue numeric, orders bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH rates AS MATERIALIZED (
    SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r
  )
  SELECT date_trunc(COALESCE(NULLIF(p_bucket, ''), 'day'),
                    o.created_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
         o.restaurant_id,
         COALESCE(SUM(o.total - o.discount * (1 + rt.rate)) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint
  FROM orders o
  JOIN rates rt ON rt.rid = o.restaurant_id
  WHERE o.created_at >= p_from AND o.created_at < p_to
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
    AND (p_ids IS NULL OR o.restaurant_id = ANY(p_ids))
  GROUP BY 1, 2
  ORDER BY 1;
$function$;

-- ── lfh_owner_sales_report: MATERIALIZED rates join (rid can be NULL; 3 calls) ─
CREATE OR REPLACE FUNCTION public.lfh_owner_sales_report(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_bucket text)
 RETURNS TABLE(bucket timestamp with time zone, orders bigint, paid_orders bigint, subtotal numeric, tax numeric, discount numeric, revenue numeric, cancelled_orders bigint, cancelled_value numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH rates AS MATERIALIZED (
    SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r
  )
  SELECT date_trunc(COALESCE(NULLIF(p_bucket, ''), 'day'),
                    o.created_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid')::bigint,
         COALESCE(SUM(o.subtotal) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COALESCE(SUM(o.total - o.subtotal - o.discount * rt.rate) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COALESCE(SUM(o.total - o.discount * (1 + rt.rate)) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(*) FILTER (WHERE o.status = 'cancelled')::bigint,
         COALESCE(SUM(o.total - o.discount * (1 + rt.rate)) FILTER (WHERE o.status = 'cancelled'), 0)::numeric
  FROM orders o
  JOIN rates rt ON rt.rid = o.restaurant_id
  WHERE o.created_at >= p_from AND o.created_at < p_to
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
  GROUP BY 1
  ORDER BY 1;
$function$;

-- ── lfh_owner_payment_breakdown: MATERIALIZED rates join (rid can be NULL) ────
CREATE OR REPLACE FUNCTION public.lfh_owner_payment_breakdown(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(method text, revenue numeric, orders bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH rates AS MATERIALIZED (
    SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r
  )
  SELECT COALESCE(NULLIF(o.payment_method, ''), 'Not recorded') AS method,
         COALESCE(SUM(o.total - o.discount * (1 + rt.rate)), 0)::numeric AS revenue,
         COUNT(*)::bigint AS orders
  FROM orders o
  JOIN rates rt ON rt.rid = o.restaurant_id
  WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
    AND o.created_at >= p_from AND o.created_at < p_to
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
  GROUP BY 1
  ORDER BY 2 DESC;
$function$;

-- ── lfh_owner_hourly: single rid → InitPlan (evaluated once) ──────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_hourly(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(hour integer, orders bigint, revenue numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXTRACT(hour FROM o.created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint,
         COALESCE(SUM(o.total - o.discount * (1 + (SELECT lfh_effective_tax_rate(p_restaurant_id)))) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric
  FROM orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.created_at >= p_from AND o.created_at < p_to
  GROUP BY 1
  ORDER BY 1;
$function$;

-- ── lfh_owner_payment_trend: single rid → InitPlan ────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_payment_trend(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(day date, method text, revenue numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
         COALESCE(NULLIF(TRIM(o.payment_method), ''), 'Not recorded') AS method,
         COALESCE(SUM(o.total - o.discount * (1 + (SELECT lfh_effective_tax_rate(p_restaurant_id)))), 0)::numeric
  FROM orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status <> 'cancelled' AND o.payment_status = 'paid'
    AND o.created_at >= p_from AND o.created_at < p_to
  GROUP BY 1, 2
  ORDER BY 1;
$function$;

-- ── lfh_owner_samehour_compare: single rid → InitPlan ─────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_samehour_compare(p_restaurant_id uuid, p_starts timestamp with time zone[], p_elapsed interval)
 RETURNS TABLE(window_start timestamp with time zone, revenue numeric, orders bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.window_start,
         COALESCE(SUM(o.total - o.discount * (1 + (SELECT lfh_effective_tax_rate(p_restaurant_id))))
           FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(o.id) FILTER (WHERE o.status <> 'cancelled')::bigint
  FROM unnest(p_starts) AS s(window_start)
  LEFT JOIN orders o ON o.restaurant_id = p_restaurant_id
    AND o.created_at >= s.window_start
    AND o.created_at < s.window_start + p_elapsed
  GROUP BY s.window_start
  ORDER BY s.window_start DESC;
$function$;

-- ── lfh_owner_records: single rid → InitPlan (all-time scan, worst offender) ──
CREATE OR REPLACE FUNCTION public.lfh_owner_records(p_restaurant_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH paid AS (
    SELECT o.id, o.session_id, o.table_number, o.created_at,
           (o.total - o.discount * (1 + (SELECT lfh_effective_tax_rate(p_restaurant_id)))) AS rev
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
      AND o.created_at >= now() - interval '30 days'
      AND COALESCE(it->>'title', '') <> ''
    GROUP BY 1 ORDER BY 2 DESC LIMIT 1
  ),
  -- Guest names live on session_members (the head who gave a name), NOT on orders.
  -- A "regular" = the same name on 2+ distinct sessions in the last 30 days.
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
