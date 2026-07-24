-- 185_khata_revenue_by_paid_date.sql
--
-- Owner (2026-07-24): a pay-later (khata) bill's money should count on the day it is
-- COLLECTED, not the day the food was ordered. Today every owner report buckets +
-- windows by orders.created_at, so a bill parked Monday and collected Friday would
-- retroactively appear in MONDAY's numbers the moment it's collected. This recreates
-- every owner money-by-day RPC so a pay-later order's revenue (and its whole row) lands
-- on its collection day.
--
-- THE ONE CHANGE per function: wherever an order's TIME AXIS decides when it counts
-- (window filter, date bucket, hour bucket), swap orders.created_at for:
--     CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at
--          ELSE o.created_at END
-- i.e. only a PAID pay-later order moves to its paid_at; every other order (normal,
-- unpaid, cancelled — none of which has both khata_at AND paid_at) stays on created_at,
-- so all existing report numbers are unchanged. Everything else in each function
-- (paid-only rule mig 113, discount-before-tax mig 126, tax-from-totals mig 121, audit
-- fixes mig 140, category join fix mig 130) is preserved VERBATIM from the deployed defs.
--
-- Privileges: CREATE OR REPLACE keeps each function's existing ACL (the 038 REVOKE/GRANT
-- from the original migrations stays), so no re-grant needed.
--
-- PERF NOTE: the window filter now tests a computed expression, so the (restaurant_id,
-- created_at) index no longer assists the date RANGE — but every query is still scoped by
-- restaurant_id (indexed), so a report reads only ONE restaurant's orders, not the table.
-- Fine at current scale; if a single restaurant's report gets slow later, add an
-- expression index: orders (restaurant_id, (CASE WHEN khata_at IS NOT NULL AND paid_at
-- IS NOT NULL THEN paid_at ELSE created_at END)).

-- ── lfh_owner_sales_report (120/121/126/140) — reports engine ─────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_sales_report(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz, p_bucket text)
 RETURNS TABLE(bucket timestamptz, orders bigint, paid_orders bigint, subtotal numeric, tax numeric, discount numeric, revenue numeric, cancelled_orders bigint, cancelled_value numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH rates AS MATERIALIZED (
    SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r
  )
  SELECT date_trunc(COALESCE(NULLIF(p_bucket, ''), 'day'),
                    (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
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
  WHERE (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
  GROUP BY 1
  ORDER BY 1;
$function$;

-- ── lfh_owner_overview (088/113/121/126/140) — home tiles (today revenue) ──────
CREATE OR REPLACE FUNCTION public.lfh_owner_overview(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(restaurant_id uuid, slug text, name text, active boolean, accent_color text, orders_today bigint, revenue_today numeric, orders_all bigint, revenue_all numeric, open_tables bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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
                         AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start))                          AS orders_today,
      COALESCE(SUM(o.total - o.discount * (1 + rt.rate))
        FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
                  AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)), 0)                              AS revenue_today,
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

-- ── lfh_owner_restaurant_revenue (089/113/126/140) ────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_restaurant_revenue(p_from timestamptz, p_to timestamptz, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(restaurant_id uuid, slug text, name text, accent_color text, revenue numeric, orders bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH rates AS MATERIALIZED (
    SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r
  )
  SELECT r.id, r.slug, r.name, r.accent_color,
         COALESCE(SUM(o.total - o.discount * (1 + rt.rate)) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(o.id) FILTER (WHERE o.status <> 'cancelled')::bigint
  FROM restaurants r
  LEFT JOIN orders o ON o.restaurant_id = r.id
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
  LEFT JOIN rates rt ON rt.rid = r.id
  WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
  GROUP BY r.id, r.slug, r.name, r.accent_color
  ORDER BY 5 DESC;
$function$;

-- ── lfh_owner_revenue_timeseries (089/113/126/140) ────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_revenue_timeseries(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz, p_bucket text, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(bucket timestamptz, restaurant_id uuid, revenue numeric, orders bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH rates AS MATERIALIZED (
    SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r
  )
  SELECT date_trunc(COALESCE(NULLIF(p_bucket, ''), 'day'),
                    (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
         o.restaurant_id,
         COALESCE(SUM(o.total - o.discount * (1 + rt.rate)) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint
  FROM orders o
  JOIN rates rt ON rt.rid = o.restaurant_id
  WHERE (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
    AND (p_ids IS NULL OR o.restaurant_id = ANY(p_ids))
  GROUP BY 1, 2
  ORDER BY 1;
$function$;

-- ── lfh_owner_dish_breakdown (089/113) — dishes sold in the window ────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_dish_breakdown(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(title text, qty bigint, revenue numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT it->>'title' AS title,
         COALESCE(SUM((it->>'qty')::numeric), 0)::bigint AS qty,
         COALESCE(SUM((it->>'qty')::numeric * (it->>'price')::numeric) FILTER (WHERE o.payment_status = 'paid'), 0)::numeric AS revenue
  FROM orders o
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS it
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status <> 'cancelled'
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
    AND COALESCE(it->>'title', '') <> ''
  GROUP BY it->>'title'
  ORDER BY 3 DESC;
$function$;

-- ── lfh_owner_category_breakdown (089/113/130) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_category_breakdown(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(category text, qty bigint, revenue numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(mi.category, 'Other') AS category,
         COALESCE(SUM((it->>'qty')::numeric), 0)::bigint AS qty,
         COALESCE(SUM((it->>'qty')::numeric * (it->>'price')::numeric) FILTER (WHERE o.payment_status = 'paid'), 0)::numeric AS revenue
  FROM orders o
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS it
  LEFT JOIN menu_items mi ON mi.restaurant_id = o.restaurant_id AND mi.id::text = (it->>'id')
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status <> 'cancelled'
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
  GROUP BY 1
  ORDER BY 3 DESC;
$function$;

-- ── lfh_owner_hourly (089/113/126) — hour-of-day pattern ──────────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_hourly(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(hour integer, orders bigint, revenue numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXTRACT(hour FROM (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::int AS hour,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint,
         COALESCE(SUM(o.total - o.discount * (1 + (SELECT lfh_effective_tax_rate(p_restaurant_id)))) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric
  FROM orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
  GROUP BY 1
  ORDER BY 1;
$function$;

-- ── lfh_owner_samehour_compare (127) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_samehour_compare(p_restaurant_id uuid, p_starts timestamptz[], p_elapsed interval)
 RETURNS TABLE(window_start timestamptz, revenue numeric, orders bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT s.window_start,
         COALESCE(SUM(o.total - o.discount * (1 + (SELECT lfh_effective_tax_rate(p_restaurant_id))))
           FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(o.id) FILTER (WHERE o.status <> 'cancelled')::bigint
  FROM unnest(p_starts) AS s(window_start)
  LEFT JOIN orders o ON o.restaurant_id = p_restaurant_id
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= s.window_start
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < s.window_start + p_elapsed
  GROUP BY s.window_start
  ORDER BY s.window_start DESC;
$function$;

-- ── lfh_owner_payment_trend (127) — revenue by method by day ──────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_payment_trend(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(day date, method text, revenue numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT ((CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::date AS day,
         COALESCE(NULLIF(TRIM(o.payment_method), ''), 'Not recorded') AS method,
         COALESCE(SUM(o.total - o.discount * (1 + (SELECT lfh_effective_tax_rate(p_restaurant_id)))), 0)::numeric
  FROM orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status <> 'cancelled' AND o.payment_status = 'paid'
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
  GROUP BY 1, 2
  ORDER BY 1;
$function$;

-- ── lfh_owner_records (127) — best day / biggest bill / fastest hour / star dish ─
-- The paid CTE's date column now carries the collection day, so best-day / biggest-bill /
-- fastest-hour all reckon a pay-later bill on the day it was collected. The 30-day
-- star-dish window uses the same axis. Regulars keys on session_members.joined_at (a
-- seating event, not money) — deliberately unchanged.
CREATE OR REPLACE FUNCTION public.lfh_owner_records(p_restaurant_id uuid)
 RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH paid AS (
    SELECT o.id, o.session_id, o.table_number,
           (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AS created_at,
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
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= now() - interval '30 days'
      AND COALESCE(it->>'title', '') <> ''
    GROUP BY 1 ORDER BY 2 DESC LIMIT 1
  ),
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

NOTIFY pgrst, 'reload schema';
