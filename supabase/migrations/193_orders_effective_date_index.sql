-- 188 — index the analytics "effective date" so the owner reports engine range-scans
-- instead of reading every order for a restaurant.
--
-- WHY: mig 185 (Pay Later) changed lfh_owner_sales_report's date filter from o.created_at
-- to  CASE WHEN khata_at IS NOT NULL AND paid_at IS NOT NULL THEN paid_at ELSE created_at END
-- (khata bills count on their PAID date). A btree on created_at (idx_orders_analytics_covering)
-- cannot cover a CASE expression, so every reports/day-summary/tax call fell back to
-- "Index Scan on restaurant_id → Filter", reading ALL of a restaurant's orders and discarding
-- 99% in memory (e.g. 20,870 rows read for 24 matches on a 7-day window). Cheap when the cache
-- is warm, but heavy enough under concurrent owner/dashboard load to hit the statement timeout
-- (57014) — which is exactly what made Sales / Day-summary / Tax feel broken.
--
-- This expression index matches the filter EXACTLY (same CASE, same column order), so the
-- planner does a (restaurant_id, effective_date) range scan touching only the rows in the
-- window. It also covers the same expression used by lfh_owner_overview's "today" filter.
-- Additive and safe: no data change, existing indexes untouched.
CREATE INDEX IF NOT EXISTS idx_orders_effective_date
  ON public.orders (
    restaurant_id,
    (CASE WHEN khata_at IS NOT NULL AND paid_at IS NOT NULL THEN paid_at ELSE created_at END)
  );

ANALYZE public.orders;
