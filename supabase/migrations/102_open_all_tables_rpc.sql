-- 102_open_all_tables_rpc.sql
-- INSTANT "Open all" (owner 2026-06-27): the manager's "Open all" fired ONE POST /sessions/open
-- PER table (300 tables → 300 round-trips to the Sydney DB, browser-capped at ~6 concurrent →
-- many seconds, and the tiles only flipped to "open" AFTER all finished). This RPC opens every
-- not-yet-open table in ONE server-side call (one round-trip, one transaction) — mirrors the
-- single-open endpoint's logic exactly:
--   • a table is "open" if it has a non-'closed' session;
--   • for each table 1..table_count WITHOUT one → INSERT a session (status open, opened_by waiter,
--     opened_at + last_activity_at now) — the trg_assign_bill INSERT trigger still assigns bill_no;
--   • approve any PENDING open/join requests across the floor (those tables are now open);
--   • return how many were opened.
-- The client pairs this with optimistic tiles (flip to "Open" instantly), so it FEELS instant too.
-- service-role only (the editor endpoint calls it via supabaseAdmin).

CREATE OR REPLACE FUNCTION lfh_staff_open_all_tables(p_restaurant_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count  int;
  v_opened int := 0;
  v_t      int;
BEGIN
  SELECT COALESCE(table_count, 0) INTO v_count FROM settings WHERE restaurant_id = p_restaurant_id;
  IF v_count IS NULL OR v_count < 1 THEN
    RETURN json_build_object('opened', 0);
  END IF;

  FOR v_t IN 1..v_count LOOP
    IF NOT EXISTS (
      SELECT 1 FROM sessions
      WHERE restaurant_id = p_restaurant_id AND table_number = v_t::text AND status <> 'closed'
    ) THEN
      INSERT INTO sessions (table_number, status, opened_by, opened_at, last_activity_at, restaurant_id)
      VALUES (v_t::text, 'open', 'waiter', now(), now(), p_restaurant_id);
      v_opened := v_opened + 1;
    END IF;
  END LOOP;

  -- The whole floor is open now → clear any pending access/join requests for real tables.
  UPDATE requests SET status = 'approved'
    WHERE restaurant_id = p_restaurant_id AND status = 'pending'
      AND table_number IN (SELECT generate_series(1, v_count)::text);

  RETURN json_build_object('opened', v_opened);
END; $$;

-- Lock down: service-role only (the editor endpoint calls it via supabaseAdmin).
REVOKE EXECUTE ON FUNCTION lfh_staff_open_all_tables(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_staff_open_all_tables(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
