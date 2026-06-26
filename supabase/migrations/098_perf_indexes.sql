-- 098_perf_indexes.sql — composite (restaurant_id, …) indexes for three hot paths.
--
-- These tables are ALWAYS filtered by restaurant_id (tenant scoping) and then
-- sorted/filtered by created_at or status on their hottest queries (staff-action
-- log, live waiter calls, aggregator/platform order board). Today only the
-- single-column restaurant_id index exists, so Postgres filters by tenant via the
-- index but then sorts/filters created_at/status with an extra step. The composite
-- indexes below let those queries do one index range scan instead. (CLAUDE.md:
-- index every column we filter by; dashboards/panels must stay cheap.)
CREATE INDEX IF NOT EXISTS idx_staff_actions_restaurant_created ON staff_actions (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_waiter_calls_restaurant_created ON waiter_calls (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aggregator_orders_restaurant_status ON aggregator_orders (restaurant_id, status);
