-- 382 — the admin Restaurants list stops counting CANCELLED orders as activity
-- (sweep #9, terminal 30, item 1 — migrations 079–154)
--
-- WHAT WAS WRONG, measured on the dev stack 2026-09-15:
--   The admin console → Restaurants list shows a one-word status pill per restaurant plus a
--   note, both derived from lfh_admin_restaurant_health() (migration 149). Two of its four
--   signals counted EVERY order, cancelled ones included:
--
--     • orders_24h    = count(*) over the last 24 hours, no status filter
--     • last_order_at = max(created_at), no status filter
--
--   So on that screen, right now:
--     · My Little French House read "Healthy · 8 orders/24h". The honest count was ZERO —
--       all eight of those orders were cancelled.
--     · Green Bowl's "last order" pointed at a cancelled order SEVEN DAYS newer than its
--       last real one, which moves it between the Quiet and Dormant badges.
--     · Taco Fiesta was a day out; Pizza Palace two seconds.
--
--   `app/aevinite/restaurants/page.tsx` → healthStatus() turns orders_24h > 0 straight into
--   "Healthy", and ages last_order_at into "ordered today" / "last order Nd ago" / "Dormant".
--   A restaurant that took no real trade therefore reads as busy, and a dormant one reads as
--   quiet. Nobody's money is wrong — this function deliberately carries no money at all — but
--   the number on the screen is wrong, and it is the number the admin uses to decide who needs
--   attention.
--
-- WHY IT IS A RULE AND NOT A PREFERENCE:
--   Migration 137 set exactly this rule for the other three admin count functions, and its
--   header says why: "one restaurant shows two different order counts depending on which panel
--   you look at — the exact 'same number, two answers' class we're stamping out… align admin to
--   the owner definition (exclude cancelled)." Migration 139 then did the same for 'orders
--   today' and the floor stats. Migration 149 landed AFTER both and never adopted it — the last
--   admin count still disagreeing with every other one.
--
--   open_issues and staff_online are untouched: neither reads the orders table.
--
-- COST: none. `idx_orders_analytics_covering` is (restaurant_id, created_at) INCLUDE (status, …),
-- so `status` is already in the index payload — both signals stay index-only reads. No new index,
-- no new column, no data rewritten. CREATE OR REPLACE keeps the existing GRANTs; they are restated
-- below anyway, because a fresh database running this file alone must still lock the function down
-- (the migration-038 lesson: a new function is PUBLIC-executable by default).
--
-- Guarded by `npm run verify:admin-counts-cancelled`, which reads the live body of every admin
-- function that counts orders and fails when one of them forgets the filter.

CREATE OR REPLACE FUNCTION public.lfh_admin_restaurant_health()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(json_agg(json_build_object(
           'restaurant_id', r.id,
           'last_order_at', lo.last_at,
           'orders_24h',    COALESCE(o24.c, 0),
           'open_issues',   COALESCE(iss.c, 0),
           'staff_online',  COALESCE(so.c, 0)
         )), '[]'::json)
  FROM restaurants r
  LEFT JOIN LATERAL (
    -- A cancelled order is not trade, so it is not this restaurant's "last order" either.
    SELECT max(created_at) AS last_at FROM orders
    WHERE restaurant_id = r.id AND status <> 'cancelled'
  ) lo ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS c FROM orders
    WHERE restaurant_id = r.id AND created_at >= now() - interval '24 hours'
      AND status <> 'cancelled'
  ) o24 ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS c FROM issues
    WHERE restaurant_id = r.id AND status = 'open'
  ) iss ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS c FROM staff_users
    WHERE restaurant_id = r.id AND active = true
      AND last_seen_at >= now() - interval '3 minutes'
  ) so ON true
  WHERE r.deleted_at IS NULL;
$function$;

REVOKE ALL ON FUNCTION public.lfh_admin_restaurant_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_admin_restaurant_health() TO service_role;

NOTIFY pgrst, 'reload schema';
