-- 347 · Usage & cost can be asked about any window
--
-- ⚠ MIGRATION NUMBER: next free after 346. CREATE OR REPLACE only — correct at any number, and it
--   rewrites no data, so it needs no lfh_already_applied guard.
--
-- Admin → Usage & cost could only ever answer ONE question: 30-day order volume, biggest first.
-- Not "what did last week look like", not "who has the most staff" (owner, 2026-08-20 — decision
-- 19). Sorting is free on the page (ten rows, already fetched — no query changes for it). A WINDOW
-- is not: lfh_admin_usage (mig 153) hard-codes `now() - interval '7 days'` and `'30 days'`.
--
-- This is that function with the window as arguments, and nothing else changed — same live-tenants
-- filter, same three counts, same one round-trip and no per-restaurant fan-out. Egress-wise it is
-- the same shape as the call it replaces: aggregate counts computed in the database, only the
-- totals crossing the wire. The scan rides idx_orders_analytics_covering (restaurant_id, created_at),
-- so a 90-day window is an index range, not a table scan.
--
-- mig 153 STAYS as it is: the default view still calls it for the 7-day and 30-day pair the page
-- shows side by side, and two callers of one hard-coded function is not a reason to break it.
CREATE OR REPLACE FUNCTION public.lfh_admin_usage_range(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(restaurant_id uuid, orders_range bigint, staff_total bigint, table_count integer)
LANGUAGE sql
STABLE
AS $$
  SELECT
    r.id,
    (SELECT count(*) FROM orders o
       WHERE o.restaurant_id = r.id AND o.status <> 'cancelled'
         AND o.created_at >= p_from AND o.created_at < p_to)  AS orders_range,
    (SELECT count(*) FROM staff_users s
       WHERE s.restaurant_id = r.id AND s.active = true)      AS staff_total,
    COALESCE((SELECT (st.table_count)::int FROM settings st WHERE st.restaurant_id = r.id), 0) AS table_count
  FROM restaurants r
  WHERE r.deleted_at IS NULL
  ORDER BY orders_range DESC;
$$;

-- A NEW FUNCTION IS PUBLIC-EXECUTABLE UNTIL YOU SAY OTHERWISE (the mig 038/267 lesson; guarded by
-- npm run verify:grants). This one reads every tenant's order volume and staff count, so it is
-- service-role only — exactly like the lfh_admin_usage it is modelled on.
REVOKE ALL ON FUNCTION public.lfh_admin_usage_range(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_admin_usage_range(timestamptz, timestamptz) TO service_role;
