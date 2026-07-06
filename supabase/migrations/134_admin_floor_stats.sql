-- 134_admin_floor_stats.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Admin Live Floor: per-restaurant ORDER COUNTS for the platform summary strip
-- (owner 2026-07-06: "on top they see all detail of all restaurants — how much
-- order going and everything — at that time").
--
-- WHY an RPC (same reasoning as lfh_owner_overview, migration 088): the admin
-- must NOT download today's order rows to count them in JS. One indexed pass
-- over TODAY's orders (idx_orders_restaurant_created, migration 095), grouped
-- by restaurant, returns one tiny row per restaurant. "Today" uses the same
-- 05:00 IST business-day rollover as the counters (migrations 044/080).
--
-- NO revenue columns ON PURPOSE — the admin panel shows no earnings anywhere
-- (owner 2026-07-03); counts only. active/unpaid mirror the admin Overview's
-- definitions (app/api/admin/overview/route.ts) so the two screens agree.
--
-- SECURITY (CLAUDE.md gotcha, migration 038): new functions are
-- PUBLIC-executable by default → REVOKE from PUBLIC/anon/authenticated, GRANT
-- only to service_role. /api/admin/floor calls it behind the admin cookie gate.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION lfh_admin_floor_stats()
RETURNS TABLE (
  restaurant_id uuid,
  orders_today  bigint,
  active_orders bigint,
  unpaid_orders bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH day_start AS (
    SELECT (((now() AT TIME ZONE 'Asia/Kolkata') - interval '5 hours')::date
            + interval '5 hours') AT TIME ZONE 'Asia/Kolkata' AS ts
  )
  SELECT
    o.restaurant_id,
    COUNT(*)                                                                        AS orders_today,
    COUNT(*) FILTER (WHERE NOT o.archived
                       AND o.status IN ('received', 'preparing'))                   AS active_orders,
    COUNT(*) FILTER (WHERE NOT o.archived
                       AND o.status <> 'cancelled'
                       AND o.payment_status <> 'paid')                              AS unpaid_orders
  FROM orders o
  WHERE o.created_at >= (SELECT ts FROM day_start)
  GROUP BY o.restaurant_id;
$$;

REVOKE EXECUTE ON FUNCTION lfh_admin_floor_stats() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_admin_floor_stats() TO service_role;

NOTIFY pgrst, 'reload schema';
