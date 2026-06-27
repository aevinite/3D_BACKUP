-- 104_scale_indexes_orders.sql
-- 7×300 SCALE (owner 2026-06-27): under 7 restaurants × 300 tables hammered simultaneously
-- (~200 writes/sec total, verified 14k writes / 0 errors), the floor-summary RPC + the targeted
-- per-table refetch filter orders by (restaurant_id, table_number) and by active status per
-- restaurant. These indexes cover those hot filters. (Already applied to prod via the Management
-- API during the load test; committed here so the repo matches.) IF NOT EXISTS = idempotent.
CREATE INDEX IF NOT EXISTS idx_orders_rest_table  ON orders (restaurant_id, table_number);
CREATE INDEX IF NOT EXISTS idx_orders_rest_active ON orders (restaurant_id, status) WHERE NOT archived;
ANALYZE orders;
