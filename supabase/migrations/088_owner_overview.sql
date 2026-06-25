-- 088_owner_overview.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Phase 4: the OWNER overview RPC — one row per restaurant of headline numbers,
-- for the all-restaurants dashboard (`/owner`).
--
-- WHY an RPC (not N client queries / JS row-scanning): an owner with many
-- restaurants must NOT cost one round-trip per restaurant, nor download every
-- order to sum it in JS. This does ALL the aggregation in Postgres in a single
-- query — GROUP BY restaurant_id over the (restaurant_id-indexed) orders +
-- sessions tables — and returns one tiny pre-summed row per restaurant. The
-- "today" boundary uses the same 05:00 IST business-day rollover the counters
-- use (migration 044/080), so "today" matches what the rest of the app calls a
-- day. Revenue counts non-cancelled orders, net of per-order discount, mirroring
-- the admin Overview's revenue rule (app/api/admin/overview/route.ts).
--
-- SECURITY: staff/owner-only. Like every staff RPC (see CLAUDE.md gotcha +
-- migration 038), new functions are PUBLIC-executable by default, so we REVOKE
-- from PUBLIC/anon/authenticated and GRANT only to service_role. The /owner API
-- calls it with the service-role key behind the admin cookie gate.
-- ─────────────────────────────────────────────────────────────────────────

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
  -- Start of the current business day (05:00 IST rollover, like the counters).
  day_start AS (
    SELECT (((now() AT TIME ZONE 'Asia/Kolkata') - interval '5 hours')::date
            + interval '5 hours') AT TIME ZONE 'Asia/Kolkata' AS ts
  ),
  -- One pass over orders → per-restaurant counts + discounted revenue. Revenue
  -- excludes cancelled orders and is net of each order's discount (admin rule).
  ord AS (
    SELECT
      o.restaurant_id,
      COUNT(*) FILTER (WHERE o.created_at >= (SELECT ts FROM day_start))                          AS orders_today,
      COALESCE(SUM((o.total - o.discount))
        FILTER (WHERE o.status <> 'cancelled'
                  AND o.created_at >= (SELECT ts FROM day_start)), 0)                              AS revenue_today,
      COUNT(*)                                                                                     AS orders_all,
      COALESCE(SUM(o.total - o.discount) FILTER (WHERE o.status <> 'cancelled'), 0)                AS revenue_all
    FROM orders o
    GROUP BY o.restaurant_id
  ),
  -- One pass over sessions → currently open tables per restaurant.
  sess AS (
    SELECT s.restaurant_id, COUNT(*) AS open_tables
    FROM sessions s
    WHERE s.status = 'open'
    GROUP BY s.restaurant_id
  )
  SELECT
    r.id,
    r.slug,
    r.name,
    r.active,
    r.accent_color,
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

-- Staff/owner-only: lock it down to the service role (the /owner API holds it).
REVOKE EXECUTE ON FUNCTION lfh_owner_overview() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_owner_overview() TO service_role;

NOTIFY pgrst, 'reload schema';
