-- ============================================================================
-- 228_customer_views.sql — what the admin and owner Customers pages read
--
-- Owner, 2026-07-30: a Customers tab in the admin panel and the owner panel, showing
-- every guest and which restaurant they belong to.
--
-- Two rules shape this file:
--  · The ADMIN never sees a restaurant's earnings, so its function returns COUNTS only.
--  · The OWNER sees their own money, but only for ONE guest at a time (a per-customer
--    read on an index), never a spend column computed for a whole page of guests —
--    that would be an aggregate over every bill on every page load.
-- ============================================================================

-- ── 1. find a guest's bills quickly ─────────────────────────────────────────
-- The owner's customer detail asks "which bills belong to this number?" — without this
-- index that is a scan of every session the restaurant ever had.
CREATE INDEX IF NOT EXISTS idx_sessions_cust_phone
  ON sessions (restaurant_id, cust_phone)
  WHERE cust_phone IS NOT NULL;

-- ── 2. admin: how many guests per restaurant (NO money) ─────────────────────
-- One grouped read instead of shipping every customer row to the server to be counted
-- in JavaScript. Feeds the little "guests per restaurant" bar list.
DROP FUNCTION IF EXISTS lfh_admin_customer_spread();
CREATE OR REPLACE FUNCTION lfh_admin_customer_spread()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(x ORDER BY x.guests DESC), '[]'::json)
    FROM (
      SELECT c.restaurant_id,
             COUNT(*)::int                                              AS guests,
             COUNT(*) FILTER (WHERE c.visits >= 2)::int                 AS regulars,
             COUNT(*) FILTER (WHERE c.blocked)::int                     AS blocked
        FROM customers c
       GROUP BY c.restaurant_id
    ) x;
$$;

-- ── 3. owner: ONE guest's history, with money ───────────────────────────────
-- Their own restaurants only (the caller passes the ALREADY-authorised id list from
-- ownerScope — never a raw request parameter). Returns that guest's bills newest first,
-- each with its net total, plus the lifetime figures for the header. Discount comes off
-- BEFORE tax, matching billMath and every other money view in the app.
DROP FUNCTION IF EXISTS lfh_owner_customer_bills(uuid[], text, integer);
CREATE OR REPLACE FUNCTION lfh_owner_customer_bills(
  p_restaurant_ids uuid[],
  p_phone          text,
  p_limit          integer DEFAULT 20
)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone text := lfh_phone10(p_phone);
  v_bills json;
  v_tot   numeric := 0;
  v_count int := 0;
  v_first timestamptz;
  v_last  timestamptz;
BEGIN
  IF v_phone IS NULL OR p_restaurant_ids IS NULL OR array_length(p_restaurant_ids, 1) IS NULL THEN
    RETURN json_build_object('bills', '[]'::json, 'lifetime', 0, 'bill_count', 0);
  END IF;

  WITH s AS (
    SELECT ses.id, ses.restaurant_id, ses.bill_no, ses.invoice_no, ses.table_number,
           ses.opened_at, ses.closed_at, ses.cust_name,
           COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL), 0) AS gross,
           COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL), 0) AS disc
      FROM sessions ses
      LEFT JOIN orders o ON o.session_id = ses.id
     WHERE ses.restaurant_id = ANY(p_restaurant_ids)
       AND ses.cust_phone = v_phone
       AND ses.deleted_at IS NULL
     GROUP BY ses.id
     -- A bill whose orders were ALL cancelled has nothing on it; it isn't a visit and
     -- must not appear as a ₹0 line (caught while testing on dev data).
    HAVING COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL), 0) > 0
     ORDER BY ses.opened_at DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
  )
  SELECT COALESCE(json_agg(json_build_object(
           'session_id', s.id, 'restaurant_id', s.restaurant_id, 'bill_no', s.bill_no,
           'invoice_no', s.invoice_no, 'table_number', s.table_number,
           'at', COALESCE(s.closed_at, s.opened_at), 'name', s.cust_name,
           'total', ROUND(GREATEST(0, s.gross - s.disc), 2)) ORDER BY COALESCE(s.closed_at, s.opened_at) DESC), '[]'::json)
    INTO v_bills FROM s;

  -- lifetime figures over ALL of this guest's bills (not just the page shown)
  SELECT COUNT(*)::int,
         COALESCE(SUM(GREATEST(0, t.gross - t.disc)), 0),
         MIN(t.at), MAX(t.at)
    INTO v_count, v_tot, v_first, v_last
    FROM (
      SELECT ses.id,
             COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL), 0) AS gross,
             COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL), 0) AS disc,
             COALESCE(ses.closed_at, ses.opened_at) AS at
        FROM sessions ses
        LEFT JOIN orders o ON o.session_id = ses.id
       WHERE ses.restaurant_id = ANY(p_restaurant_ids)
         AND ses.cust_phone = v_phone
         AND ses.deleted_at IS NULL
       GROUP BY ses.id
      HAVING COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL), 0) > 0
    ) t;

  RETURN json_build_object(
    'phone', v_phone, 'bills', v_bills, 'bill_count', v_count,
    'lifetime', ROUND(v_tot, 2),
    'avg_bill', CASE WHEN v_count > 0 THEN ROUND(v_tot / v_count, 2) ELSE 0 END,
    'first_bill', v_first, 'last_bill', v_last);
END $$;

-- staff-only (new functions are PUBLIC-executable by default — migration-038 gotcha)
REVOKE ALL ON FUNCTION lfh_admin_customer_spread()                   FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_admin_customer_spread()                   TO service_role;
REVOKE ALL ON FUNCTION lfh_owner_customer_bills(uuid[], text, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_owner_customer_bills(uuid[], text, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
