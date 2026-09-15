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

-- ⚠️ RUN-ALONE GUARD (sweep #9, T29, 2026-09-15).
-- BOTH indexes above are RETIRED, and each was dropped with its reason on the line:
--   · idx_orders_created_at        — migration 155: superseded by the covering analytics indexes,
--     "same key, wider payload". The covering ones carry EVERY column these RPCs aggregate, so the
--     plain key index serves no plan the covering one does not serve better.
--   · idx_orders_restaurant_created — migration 267: "(rid, created_at) — same key as the covering
--     index, minus the INCLUDEs", under F12, "strictly redundant with the leading column of another
--     index on the same table".
-- 267 also says what a redundant index on THIS table costs: `orders` carried 15 indexes and takes
-- ~550k lifetime inserts, "and the measured order ceiling (100 simultaneous orders in ~2s) is
-- exactly when this cost is paid" — a rush is precisely when you cannot afford it.
--
-- A FULL re-seed already ends correctly (155 and 267 both sort after this file). The hole is the
-- PARTIAL run CLAUDE.md recommends, which puts both back in one step. Idempotent, and safe where
-- neither exists.
DROP INDEX IF EXISTS idx_orders_created_at;
DROP INDEX IF EXISTS idx_orders_restaurant_created;
