-- 146 — lfh_admin_restaurant_health(): one-glance "is this restaurant alive?" signal
-- for the admin Restaurants list, computed for EVERY restaurant in ONE round-trip.
--
-- The admin panel shows NO earnings (hard rule), so this returns only ACTIVITY signals,
-- never money: when the last order was, how many orders in the last 24h, how many OPEN
-- issues, and how many staff are currently online. The app derives a Healthy / Quiet /
-- Dormant badge from these client-side.
--
-- Egress-safe: all the per-restaurant work is aggregated server-side (counts + one max()),
-- so only a tiny JSON summary leaves the DB — no order/issue rows. It's an on-demand admin
-- read (not a hot/polled path). Staff-only: revoked from public/anon/authenticated, granted
-- to service_role (called with the service-role key behind the admin-cookie gate).

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
    SELECT max(created_at) AS last_at FROM orders WHERE restaurant_id = r.id
  ) lo ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS c FROM orders
    WHERE restaurant_id = r.id AND created_at >= now() - interval '24 hours'
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
