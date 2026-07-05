-- 127_owner_crazy_dashboard.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Owner "crazy dashboard" RPCs (owner, 2026-07-05): the same-hour honest
-- comparison, the payment-method-by-day trend, and the all-time records strip.
-- Same discipline as 089/126: ONE grouped query each, tiny pre-summed rows,
-- revenue = total − discount×(1+rate) on paid non-cancelled orders (the
-- mig-126 discount-before-tax rule), IST bucketing, STABLE SECURITY DEFINER,
-- service_role-only (new functions are PUBLIC-executable by default — lock!).
-- ─────────────────────────────────────────────────────────────────────────

-- A) Same-elapsed-time comparison (the Restroworks trick): revenue for N windows
--    each cut at the SAME elapsed duration, so "today till 5pm" is compared to
--    "last Saturday till 5pm", never to a full day. The caller passes the window
--    starts; p_elapsed is the shared cut length.
CREATE OR REPLACE FUNCTION lfh_owner_samehour_compare(
  p_restaurant_id uuid, p_starts timestamptz[], p_elapsed interval)
RETURNS TABLE (window_start timestamptz, revenue numeric, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.window_start,
         COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id)))
           FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(o.id) FILTER (WHERE o.status <> 'cancelled')::bigint
  FROM unnest(p_starts) AS s(window_start)
  LEFT JOIN orders o ON o.restaurant_id = p_restaurant_id
    AND o.created_at >= s.window_start
    AND o.created_at < s.window_start + p_elapsed
  GROUP BY s.window_start
  ORDER BY s.window_start DESC;
$$;
REVOKE EXECUTE ON FUNCTION lfh_owner_samehour_compare(uuid, timestamptz[], interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_owner_samehour_compare(uuid, timestamptz[], interval) TO service_role;

-- B) Payment methods per IST day → the stacked "how money arrives" trend.
--    NULL/'' method reads as "Not recorded" (same rule as mig 110).
CREATE OR REPLACE FUNCTION lfh_owner_payment_trend(
  p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (day date, method text, revenue numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
         COALESCE(NULLIF(TRIM(o.payment_method), ''), 'Not recorded') AS method,
         COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id))), 0)::numeric
  FROM orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status <> 'cancelled' AND o.payment_status = 'paid'
    AND o.created_at >= p_from AND o.created_at < p_to
  GROUP BY 1, 2
  ORDER BY 1;
$$;
REVOKE EXECUTE ON FUNCTION lfh_owner_payment_trend(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_owner_payment_trend(uuid, timestamptz, timestamptz) TO service_role;

-- C) Records strip ("your numbers worth bragging about"): best day, biggest bill
--    (per-session so a table's merged bill counts as ONE), fastest hour, star dish
--    (30d), returning named customers (30d). One call → five tiny rows as JSONB.
--    All-time scans are bounded by the (restaurant_id, created_at) index; this is
--    an on-demand dashboard call, never polled.
CREATE OR REPLACE FUNCTION lfh_owner_records(p_restaurant_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH paid AS (
    SELECT o.id, o.session_id, o.table_number, o.created_at,
           (o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id))) AS rev
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
$$;
REVOKE EXECUTE ON FUNCTION lfh_owner_records(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_owner_records(uuid) TO service_role;
