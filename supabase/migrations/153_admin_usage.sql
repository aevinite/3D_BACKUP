-- 153 — lfh_admin_usage(): per-restaurant USAGE signals for the admin "Usage & cost"
-- view (feature #8, 2026-07-08). ONE server-side aggregation so the admin can see which
-- restaurants are heavy to serve (a cost/egress proxy) WITHOUT the client hauling whole
-- tables. NO food money — counts only (admin sees no earnings, hard rule).
--
-- Returns one row per LIVE (non-deleted) restaurant: order volume over 7/30 days
-- (cancelled excluded), active staff, and configured tables.
CREATE OR REPLACE FUNCTION public.lfh_admin_usage()
RETURNS TABLE (
  restaurant_id uuid,
  orders_7d     bigint,
  orders_30d    bigint,
  staff_total   bigint,
  table_count   int
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    r.id,
    (SELECT count(*) FROM orders o
       WHERE o.restaurant_id = r.id AND o.status <> 'cancelled'
         AND o.created_at >= now() - interval '7 days')  AS orders_7d,
    (SELECT count(*) FROM orders o
       WHERE o.restaurant_id = r.id AND o.status <> 'cancelled'
         AND o.created_at >= now() - interval '30 days') AS orders_30d,
    (SELECT count(*) FROM staff_users s
       WHERE s.restaurant_id = r.id AND s.active = true) AS staff_total,
    COALESCE((SELECT (st.table_count)::int FROM settings st WHERE st.restaurant_id = r.id), 0) AS table_count
  FROM restaurants r
  WHERE r.deleted_at IS NULL
  ORDER BY orders_30d DESC;
$$;

-- New functions are PUBLIC-executable by default — lock to service_role only (CLAUDE.md rule).
REVOKE ALL ON FUNCTION public.lfh_admin_usage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_admin_usage() TO service_role;
