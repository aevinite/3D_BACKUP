-- 199_owner_heatmap.sql
-- Day-of-week × hour "busy heatmap" for the owner dashboard (2026-07-26 merge redesign).
--
-- One tiny pre-summed grid (≤ 7×24 rows) per call — the dashboard's new heatmap card
-- reads THIS instead of ever scanning orders in JS. Semantics mirror lfh_owner_hourly
-- exactly (mig 185): effective date = paid_at for settled khata orders else created_at,
-- IST wall-clock, orders = non-cancelled count, revenue = paid-only and net of
-- discount-before-tax via each restaurant's own lfh_effective_tax_rate.
--
-- Scope: p_restaurant_id = one restaurant; NULL = the p_ids set (an owner's portfolio,
-- mig-190 pattern); both NULL = whole platform (admin all-view only — the API route
-- always passes the caller's authorized scope, same as every other lfh_owner_* RPC).

CREATE OR REPLACE FUNCTION public.lfh_owner_heatmap(
  p_restaurant_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_ids uuid[] DEFAULT NULL
) RETURNS TABLE(dow integer, hr integer, orders bigint, revenue numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXTRACT(dow  FROM (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::int AS dow,
         EXTRACT(hour FROM (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::int AS hr,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint AS orders,
         COALESCE(SUM(o.total - o.discount * (1 + (SELECT lfh_effective_tax_rate(o.restaurant_id))))
           FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric AS revenue
  FROM orders o
  WHERE (CASE WHEN p_restaurant_id IS NOT NULL THEN o.restaurant_id = p_restaurant_id
              WHEN p_ids IS NOT NULL THEN o.restaurant_id = ANY(p_ids)
              ELSE TRUE END)
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
  GROUP BY 1, 2
  ORDER BY 1, 2;
$function$;

-- Staff-only function discipline (mig 038 gotcha): new functions are PUBLIC-executable
-- by default — lock to the server's service role only.
REVOKE ALL ON FUNCTION public.lfh_owner_heatmap(uuid, timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_heatmap(uuid, timestamptz, timestamptz, uuid[]) TO service_role;
