-- 230_floor_live_orders_index.sql — index the live-floor predicate the Table view asks for.
--
-- CONTEXT: the error log carries "GET summary — canceling statement due to statement timeout"
-- (manager route, latest 2026-07-30). lfh_table_view_summary is TIER 1 of the Table view — what
-- the manager panel and every waiter tablet load and poll — so a timeout there means the floor
-- doesn't draw.
--
-- WHAT THE MEASUREMENTS ACTUALLY SAY (be careful here — a first pass through the network said
-- 3-16s and that was WRONG; this machine's link to the Mumbai DB was stalling, and the untouched
-- lfh_floor_bundle "slowed down" in the same breath, which gave the lie away). Measured
-- server-side with EXPLAIN ANALYZE, where the network cannot distort it, on 398,364 orders:
--     lfh_table_view_summary, whole floor : ~99 ms
--     lfh_table_view_summary, one table   : ~25 ms
--     lfh_floor_bundle,       whole floor : ~9 ms
-- So the function is NOT slow in the database, and this migration does NOT claim to fix the
-- timeout. That row came from contention on a dev stack several sessions were hammering; the
-- code defect behind it has NOT been located, and pretending otherwise would bury it.
--
-- WHAT THIS DOES EARN: the summary loops table by table asking for each table's LIVE orders
-- (NOT archived, not cancelled). The only index that could serve that was
--   idx_orders_rest_table (restaurant_id, table_number)
-- which spans EVERY row — all 398k, including years of archived history — so each iteration
-- walks a table's whole history and discards the archived rows. The partial index below holds
-- ONLY the rows actually on the floor (38 here — the index is 16 kB) and matches the predicate
-- exactly. pg_stat_user_indexes confirms both new indexes are being chosen. An index cannot
-- change a result; this is purely how fast the same answer is found, and it keeps the walk
-- proportional to the floor instead of to the history as the order table grows.
--
-- Plain CREATE INDEX (not CONCURRENTLY): a migration runs in a transaction, and on a table this
-- size it takes a moment and briefly blocks writes to `orders`. Run it off-peak.

CREATE INDEX IF NOT EXISTS idx_orders_floor_live
  ON orders (restaurant_id, table_number)
  WHERE NOT archived AND status <> 'cancelled';

-- Same shape for the per-table session lookup inside the loop: the existing
-- idx_sessions_table_status is (table_number, status) with NO restaurant_id, so every
-- restaurant's tables share index entries and each lookup filters afterwards.
CREATE INDEX IF NOT EXISTS idx_sessions_rest_table_open
  ON sessions (restaurant_id, table_number, last_activity_at DESC)
  WHERE status = 'open';

ANALYZE orders;
ANALYZE sessions;
