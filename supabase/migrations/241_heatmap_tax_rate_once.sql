-- 241_heatmap_tax_rate_once.sql
--
-- THE BUG. The owner's busiest-times heatmap could not finish. It looked up the restaurant's tax
-- rate INSIDE its SUM, keyed on the row's own restaurant:
--
--     SUM(o.total - o.discount * (1 + (SELECT lfh_effective_tax_rate(o.restaurant_id))))
--
-- so `lfh_effective_tax_rate` — a STABLE function that reads `settings` — ran once PER ORDER ROW.
-- Measured on one busy demo tenant over 2026 (≈50k rows in range, 399k in the table): 10.8–11.9s on
-- one run and 8.2–16.3s on another — it varies with what else the instance is doing, and that
-- variance is the point, because the limit it has to beat is fixed. The app cancels a statement at
-- **8 SECONDS** (PostgREST logs in as
-- `authenticator`, whose role settings carry statement_timeout=8s — not the 120s database default;
-- proven on the app path: a 5s query returns 200, a 20s query is cancelled at 8.8s with 57014).
-- So over a long range this report did not merely run slow, it **always failed**, and the owner saw
-- "This report took too long to build."
--
-- It was the ONLY offender. Of the 16 functions that use `lfh_effective_tax_rate`, the other 15
-- already resolve it once — `lfh_owner_hourly` passes the parameter, so Postgres evaluates it a
-- single time. The heatmap could not copy that idiom verbatim because it accepts `p_ids` as well as
-- `p_restaurant_id`, so rows in one call can belong to different restaurants with different rates.
--
-- THE FIX. Resolve each restaurant's rate ONCE into a tiny CTE (one row per restaurant, 15 rows
-- here) and join it.
--
-- Two details that keep the money identical rather than merely close:
--   · it is a LEFT JOIN, not a JOIN. An inner join would DROP an order whose restaurant_id has no
--     row in `restaurants` (an orphan), silently removing real money from the report. A left join
--     keeps every row the old WHERE clause kept, so the row set is unchanged.
--   · the rate falls back to `lfh_effective_tax_rate(o.restaurant_id)` when the CTE has no row for
--     that order, which is exactly what the old per-row subquery did. So an orphan is priced the
--     same way it was before — the per-row call survives only for the rows that genuinely need it,
--     and there are normally none.
-- Everything else is verbatim: the effective-date CASE (which matches idx_orders_effective_date),
-- the restaurant filter, the cancelled/paid filters, the Asia/Kolkata bucketing, GROUP BY and
-- ORDER BY, and the STABLE SECURITY DEFINER + search_path attributes.
--
-- PROVED, not assumed. This decides money, so the answers were compared rather than reasoned about:
-- `node scripts/verify-heatmap-parity.mjs` calls the old and new function for every restaurant over
-- several ranges — including all restaurants in ONE call, the only shape where rows carry different
-- tax rates — and requires EXACT equality of every bucket. **62 comparisons, identical**, orders and
-- revenue alike. The comparison was then checked against a deliberate fault (the rate nudged by
-- 0.01) and caught it (revenue 14 899.50 vs 14 896.25), so it is not blind.
--
-- WHAT IT ACTUALLY BUYS — measured, and less than I first assumed. The per-row function call was a
-- real cost but NOT the dominant one; the scan itself is (399k orders, a 281 MB table on an instance
-- with 224 MB of shared_buffers, so it cannot be cached):
--
--   one busy tenant, all of 2026     8 209–16 266 ms  CANCELLED  ->  4 513– 6 676 ms  finishes
--   all 15 restaurants, all of 2026 34 716–35 646 ms  CANCELLED  -> 12 544–21 012 ms  STILL CANCELLED
--
-- So this fixes the single-restaurant heatmap, which is what an owner of one restaurant opens, and
-- it halves the cost everywhere. It does NOT fix the whole-portfolio heatmap over a long range —
-- that still exceeds 8s and still fails. Finishing that needs the range pre-aggregated by
-- day-of-week and hour (the daily rollup cannot serve it: it has no hour dimension), which is a
-- bigger piece of work and is written up in docs/FLOOR-TIMEOUT-WATCH.md rather than smuggled in
-- here. Nothing about this migration blocks that; it removes a plain waste in the meantime.

CREATE OR REPLACE FUNCTION public.lfh_owner_heatmap(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(dow integer, hr integer, orders bigint, revenue numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH rates AS (
    -- one row per restaurant this call can touch; the rate is read once, not once per order
    SELECT r.id, lfh_effective_tax_rate(r.id) AS rate
      FROM restaurants r
     WHERE (CASE WHEN p_restaurant_id IS NOT NULL THEN r.id = p_restaurant_id
                 WHEN p_ids IS NOT NULL THEN r.id = ANY(p_ids)
                 ELSE TRUE END)
  )
  SELECT EXTRACT(dow  FROM (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::int AS dow,
         EXTRACT(hour FROM (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::int AS hr,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint AS orders,
         COALESCE(SUM(o.total - o.discount * (1 + COALESCE(rt.rate, (SELECT lfh_effective_tax_rate(o.restaurant_id)))))
           FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric AS revenue
  FROM orders o
  LEFT JOIN rates rt ON rt.id = o.restaurant_id
  WHERE (CASE WHEN p_restaurant_id IS NOT NULL THEN o.restaurant_id = p_restaurant_id
              WHEN p_ids IS NOT NULL THEN o.restaurant_id = ANY(p_ids)
              ELSE TRUE END)
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
  GROUP BY 1, 2
  ORDER BY 1, 2;
$function$;

-- Unchanged from what it already carries (captured from pg_proc.proacl): only postgres and
-- service_role may execute it. Stated so a rebuild from this folder alone lands the same grants.
REVOKE ALL ON FUNCTION public.lfh_owner_heatmap(uuid, timestamp with time zone, timestamp with time zone, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_heatmap(uuid, timestamp with time zone, timestamp with time zone, uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
