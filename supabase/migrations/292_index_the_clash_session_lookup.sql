-- 292 — index the lookup the offline clash check actually makes.
--
-- WHAT ASKS FOR IT
--   lib/clash.ts → replayClash() answers "has this table moved on since the person acted?" with
--
--     select id, status, closed_at, created_at from sessions
--      where restaurant_id = $1 and table_number = $2
--      order by created_at desc limit 1
--
--   It deliberately does NOT filter by status: it needs the table's NEWEST session whatever state
--   it is in, because "closed and billed since you did this" is one of the answers it must give.
--
-- WHY NEITHER EXISTING INDEX FITS
--   · idx_sessions_rest_table_open (mig 230) is (restaurant_id, table_number, last_activity_at DESC)
--     but PARTIAL — `where status = 'open'`. A query that must see closed sessions cannot use it,
--     and its sort column is not the one we order by.
--   · idx_sessions_table_status (mig 014) is (table_number, status) with no restaurant_id — mig 267's
--     own notes call it "rid-less (pre-tenancy shape) … they match wider then filter, which costs a
--     little". So the planner matched every restaurant's rows for that table number, filtered by
--     restaurant, then sorted `created_at` with no index to help.
--
--   `sessions` grows by roughly one row per party per table per day, so that cost climbs with the
--   restaurant's age — and it is paid on the offline-replay path, which by definition runs just
--   after the system has been struggling. Exactly the "index every column we filter by" rule.
--
-- SAFE BY CONSTRUCTION: additive, IF NOT EXISTS, no data change, nothing reads differently. It
-- simply gives that one query an index whose shape matches it — restaurant, then table, then the
-- newest first — so it is an index scan of one row instead of a filter-and-sort.
CREATE INDEX IF NOT EXISTS idx_sessions_rest_table_created
  ON sessions (restaurant_id, table_number, created_at DESC);

COMMENT ON INDEX idx_sessions_rest_table_created IS
  'Serves lib/clash.ts replayClash(): newest session for a table REGARDLESS of status. Do not make this partial — the closed sessions are the ones it needs to find.';
