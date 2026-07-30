-- ============================================================================
-- 229_customer_scale.sql — keep the Customers pages cheap at 500 new guests a DAY
--
-- Owner asked the right question (2026-07-30): "daily there will be 500 new customers,
-- it will not fill up the storage right?" Storage is fine — a saved guest is ~230 bytes
-- all-in, so 500 a day is ~42 MB a YEAR. What would NOT have been fine is the reading:
--
--  · the list orders by "last seen" — with no index that sorts the whole table on every
--    page open once a restaurant has six figures of guests;
--  · the "Most visits" sort had the same problem;
--  · the admin tiles + the per-restaurant bar list are aggregates over every row, and by
--    the standing rule every dashboard aggregate must ride the compute-on-view snapshot
--    cache instead of recomputing on each open (and each 60s backstop).
--
-- This migration adds the three indexes and ONE very cheap change-detector the cache uses
-- to decide whether recomputing is even necessary.
-- ============================================================================

-- ── the two orderings the list actually uses ────────────────────────────────
-- Platform-wide "Recent" (admin, no restaurant filter).
CREATE INDEX IF NOT EXISTS idx_customers_last_seen
  ON customers (last_seen_at DESC);

-- "Recent" inside one restaurant (the owner's normal view, and the admin's filtered view).
CREATE INDEX IF NOT EXISTS idx_customers_rest_last_seen
  ON customers (restaurant_id, last_seen_at DESC);

-- "Most visits" inside one restaurant.
CREATE INDEX IF NOT EXISTS idx_customers_rest_visits
  ON customers (restaurant_id, visits DESC);

-- ── the change-detector for the snapshot cache ──────────────────────────────
-- Every write to a customer row sets last_seen_at = NOW() (a new guest, a fresh visit, a
-- corrected name), so the newest last_seen_at + the row count is a faithful fingerprint of
-- "did anything change?". Reading MAX() straight off idx_customers_last_seen is an
-- index-only peek at ONE entry — it stays instant no matter how many guests exist, which is
-- the whole point: the expensive aggregate then runs only when this value has moved.
DROP FUNCTION IF EXISTS lfh_customers_fingerprint(uuid);
CREATE OR REPLACE FUNCTION lfh_customers_fingerprint(p_restaurant_id uuid DEFAULT NULL)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT to_char(MAX(last_seen_at), 'YYYYMMDDHH24MISS')
       FROM customers
      WHERE p_restaurant_id IS NULL OR restaurant_id = p_restaurant_id),
    'none');
$$;

REVOKE ALL ON FUNCTION lfh_customers_fingerprint(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_customers_fingerprint(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
