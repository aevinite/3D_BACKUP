-- 200_sales_report_index_friendly.sql
-- Fix the owner Sales report (and every money report built on it — sales / tax /
-- discounts / cancellations / day-summary) timing out on wide windows (12-month view
-- was a hard statement_timeout, ~12s for ONE restaurant — owner round-6, phase-5).
--
-- Root cause: `(p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)` inside a
-- LANGUAGE sql function forces a GENERIC plan (planned once, param could be NULL), so the
-- planner can't trust the restaurant index and SEQ-SCANS all ~398k orders. A literal call
-- uses the index (34ms), but the function's generic plan does not.
--
-- Fix: `o.restaurant_id = ANY(<ids>)` — a scalar-array op that IS index-usable in a
-- generic plan. For a concrete rid it's a 1-element array (index range scan); NULL expands
-- to every restaurant id (admin all-view — same universe as before). Identical results;
-- only the restaurant predicate changed. Verified index scan restored on the dev DB.

-- plan_cache_mode = force_custom_plan: re-plan with the ACTUAL restaurant id every call,
-- so a concrete rid range-scans the index (~140ms) instead of a generic plan that seq-scans
-- all orders. This is the decisive fix; the ANY() form below keeps it index-usable too.
CREATE OR REPLACE FUNCTION public.lfh_owner_sales_report(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz, p_bucket text)
 RETURNS TABLE(bucket timestamptz, orders bigint, paid_orders bigint, subtotal numeric, tax numeric, discount numeric, revenue numeric, cancelled_orders bigint, cancelled_value numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET work_mem TO '128MB' SET plan_cache_mode TO 'force_custom_plan' SET statement_timeout TO '25s'
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
  WHERE o.restaurant_id = ANY (CASE WHEN p_restaurant_id IS NOT NULL THEN ARRAY[p_restaurant_id]
                                    ELSE (SELECT array_agg(id) FROM restaurants) END)
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
  GROUP BY 1
  ORDER BY 1;
$function$;

REVOKE ALL ON FUNCTION public.lfh_owner_sales_report(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_sales_report(uuid, timestamptz, timestamptz, text) TO service_role;
