-- 121_owner_overview_noncancelled_orders.sql
--
-- FIX (2026-07-05): lfh_owner_overview's orders_today / orders_all used COUNT(*)
-- with NO status filter, so they counted CANCELLED orders — while every analytics
-- RPC (089) counts orders with FILTER (WHERE status <> 'cancelled'). Result: the
-- same restaurant showed a different order count on the /owner card (370 all-time)
-- vs its drill-in KPI (288) — the card silently included 82 cancelled orders. The
-- migration-113 comment even CLAIMS overview "stays a plain non-cancelled ORDER
-- count", but the SQL never filtered. This aligns it, so order volume agrees
-- everywhere (the owner's "same number everywhere" rule). Revenue was already
-- paid-only and is unchanged. CREATE OR REPLACE — same signature, same callers.

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
      COUNT(*) FILTER (WHERE o.status <> 'cancelled'
                         AND o.created_at >= (SELECT ts FROM day_start))                          AS orders_today,
      COALESCE(SUM((o.total - o.discount))
        FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
                  AND o.created_at >= (SELECT ts FROM day_start)), 0)                              AS revenue_today,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled')                                              AS orders_all,
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
