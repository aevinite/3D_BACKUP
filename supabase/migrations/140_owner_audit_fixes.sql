-- 140: Owner-panel audit fixes (2026-07-06; renumbered from 138 — 138/139 taken on main)
--
-- A) EGRESS/COST: the owner revenue RPCs summed the WHOLE platform every load
--    (and every 60s auto-refresh), then threw all but the owner's rows away in JS
--    — even a single-restaurant owner's "vs yesterday" delta scanned every tenant.
--    Add a p_ids uuid[] filter so the DATABASE only aggregates the caller's
--    restaurants (uses the orders(restaurant_id,...) index). NULL = all (admin).
-- B) RATINGS: give the existing guest `feedback` table management columns
--    (acknowledged / note) + an index + a scoped summary RPC, so owners AND
--    managers can see and handle guest star-ratings.
-- C) MATH: the Cancellations "lost value" used SUM(total - discount), inconsistent
--    with paid-revenue's discount-before-tax rule. Bring it in line.
--
-- All recreated bodies are based on the HIGHEST existing version (migration 126),
-- per the "a later CREATE OR REPLACE from a stale copy silently reverts a fix" rule.
-- New/replaced functions are PUBLIC-executable by default → REVOKE + GRANT service_role.

-- ─────────────────────────────────────────────────────────────────────────────
-- A1) lfh_owner_restaurant_revenue — scope by p_ids (was: whole-platform scan)
DROP FUNCTION IF EXISTS lfh_owner_restaurant_revenue(timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION lfh_owner_restaurant_revenue(
  p_from timestamptz, p_to timestamptz, p_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (restaurant_id uuid, slug text, name text, accent_color text, revenue numeric, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.slug, r.name, r.accent_color,
         COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id))) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(o.id) FILTER (WHERE o.status <> 'cancelled')::bigint
  FROM restaurants r
  LEFT JOIN orders o ON o.restaurant_id = r.id AND o.created_at >= p_from AND o.created_at < p_to
  WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
  GROUP BY r.id, r.slug, r.name, r.accent_color
  ORDER BY 5 DESC;
$$;

-- A2) lfh_owner_revenue_timeseries — add p_ids (group-scope call passes the owner's ids)
DROP FUNCTION IF EXISTS lfh_owner_revenue_timeseries(uuid, timestamptz, timestamptz, text);
CREATE OR REPLACE FUNCTION lfh_owner_revenue_timeseries(
  p_restaurant_id uuid, p_from timestamptz, p_to timestamptz, p_bucket text, p_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (bucket timestamptz, restaurant_id uuid, revenue numeric, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT date_trunc(COALESCE(NULLIF(p_bucket, ''), 'day'),
                    o.created_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
         o.restaurant_id,
         COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id))) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint
  FROM orders o
  WHERE o.created_at >= p_from AND o.created_at < p_to
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
    AND (p_ids IS NULL OR o.restaurant_id = ANY(p_ids))
  GROUP BY 1, 2
  ORDER BY 1;
$$;

-- A3) lfh_owner_overview — scope both the orders scan and the restaurant list by p_ids
DROP FUNCTION IF EXISTS lfh_owner_overview();
CREATE OR REPLACE FUNCTION lfh_owner_overview(p_ids uuid[] DEFAULT NULL)
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH
  day_start AS (
    SELECT (((now() AT TIME ZONE 'Asia/Kolkata') - interval '5 hours')::date
            + interval '5 hours') AT TIME ZONE 'Asia/Kolkata' AS ts
  ),
  ord AS (
    SELECT
      o.restaurant_id,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled'
                         AND o.created_at >= (SELECT ts FROM day_start))                          AS orders_today,
      COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id)))
        FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
                  AND o.created_at >= (SELECT ts FROM day_start)), 0)                              AS revenue_today,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled')                                              AS orders_all,
      COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id)))
        FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)                   AS revenue_all
    FROM orders o
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
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C) lfh_owner_sales_report — cancelled "lost value" now uses discount-before-tax
--    (total - discount*(1+rate)), matching the paid-revenue formula on line 7.
--    Signature UNCHANGED (callers untouched). Based on migration 126.
CREATE OR REPLACE FUNCTION lfh_owner_sales_report(
  p_restaurant_id uuid,
  p_from timestamptz,
  p_to   timestamptz,
  p_bucket text
)
RETURNS TABLE (
  bucket           timestamptz,
  orders           bigint,
  paid_orders      bigint,
  subtotal         numeric,
  tax              numeric,
  discount         numeric,
  revenue          numeric,
  cancelled_orders bigint,
  cancelled_value  numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT date_trunc(COALESCE(NULLIF(p_bucket, ''), 'day'),
                    o.created_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid')::bigint,
         COALESCE(SUM(o.subtotal) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COALESCE(SUM(o.total - o.subtotal - o.discount * lfh_effective_tax_rate(o.restaurant_id)) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id))) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(*) FILTER (WHERE o.status = 'cancelled')::bigint,
         COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id))) FILTER (WHERE o.status = 'cancelled'), 0)::numeric
  FROM orders o
  WHERE o.created_at >= p_from AND o.created_at < p_to
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
  GROUP BY 1
  ORDER BY 1;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B) RATINGS management: columns on the existing guest feedback table (mig 037).
--    feedback already carries restaurant_id (mig 078) — add the "handled" workflow.
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS acknowledged    boolean NOT NULL DEFAULT false;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS acknowledged_by text;   -- who handled it (name/role)
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS staff_note      text;   -- internal note / reply
-- The ratings list + summary always filter by restaurant and sort by recency.
CREATE INDEX IF NOT EXISTS idx_feedback_rid_created ON feedback (restaurant_id, created_at DESC);

-- B2) lfh_ratings_summary — pre-aggregated average + star distribution + unhandled
--     count for a set of restaurants (never scans another tenant; NULL/[] = nothing).
CREATE OR REPLACE FUNCTION lfh_ratings_summary(
  p_ids uuid[], p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL
)
RETURNS TABLE (total bigint, avg numeric, s1 bigint, s2 bigint, s3 bigint, s4 bigint, s5 bigint, unhandled bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::bigint,
         COALESCE(ROUND(AVG(rating)::numeric, 2), 0),
         COUNT(*) FILTER (WHERE rating = 1)::bigint,
         COUNT(*) FILTER (WHERE rating = 2)::bigint,
         COUNT(*) FILTER (WHERE rating = 3)::bigint,
         COUNT(*) FILTER (WHERE rating = 4)::bigint,
         COUNT(*) FILTER (WHERE rating = 5)::bigint,
         COUNT(*) FILTER (WHERE NOT acknowledged)::bigint
  FROM feedback
  WHERE restaurant_id = ANY(p_ids)
    AND (p_from IS NULL OR created_at >= p_from)
    AND (p_to   IS NULL OR created_at <  p_to);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTS: staff-only (service_role). New/replaced functions default to PUBLIC.
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION lfh_owner_restaurant_revenue(timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION lfh_owner_revenue_timeseries(uuid, timestamptz, timestamptz, text, uuid[]) FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION lfh_owner_overview(uuid[]) FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION lfh_ratings_summary(uuid[], timestamptz, timestamptz) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION lfh_owner_restaurant_revenue(timestamptz, timestamptz, uuid[]) TO service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION lfh_owner_revenue_timeseries(uuid, timestamptz, timestamptz, text, uuid[]) TO service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION lfh_owner_overview(uuid[]) TO service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION lfh_ratings_summary(uuid[], timestamptz, timestamptz) TO service_role';
END $$;
