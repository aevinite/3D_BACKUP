-- 095_orders_analytics_indexes.sql — speed up the owner/admin analytics.
--
-- The revenue RPCs (lfh_owner_revenue_timeseries / lfh_owner_restaurant_revenue,
-- migration 089) filter `orders` by created_at range + optional restaurant_id and
-- GROUP BY restaurant_id. `orders` had NO index on those columns, so they
-- full-scanned — the dashboard took ~147s under load in the 2026-06-26 stress test.
-- These covering indexes turn that into an index range scan. (CLAUDE.md: index every
-- column we filter by; dashboards must stay cheap.)
CREATE INDEX IF NOT EXISTS idx_orders_created_at        ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_created ON orders (restaurant_id, created_at);
