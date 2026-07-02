-- 114_open_table_rpc.sql
--
-- "Open table" felt slow (owner report, 2026-07-02: detail panel stuck showing "not
-- open" for 5+ seconds after tapping the tile's quick Open button). Root cause turned
-- out to be two separate problems:
--   1. A client-side redraw dedup bug (fixed in app.js — the fingerprint that gates
--      re-rendering never included the selected table's SESSION row, only its orders).
--   2. THIS one: POST /sessions/open made FOUR sequential round-trips to the DB (check
--      table_count, check for an existing session, insert-or-update it, approve pending
--      requests) — each one a separate network hop from the serverless function to
--      Postgres. Mirrors the exact problem lfh_staff_open_all_tables (migration 102)
--      already solved for the BULK case — this is that same fix for the single-table
--      case: all four steps in ONE server-side round-trip.
--
-- Returns the session row as jsonb on success, or {"error": "..."} if the table number
-- is out of range — the API route checks for that key instead of throwing, so the
-- friendly "Table N doesn't exist" message survives unchanged.
CREATE OR REPLACE FUNCTION lfh_staff_open_table(p_restaurant_id uuid, p_table text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_max      int;
  v_num      int;
  v_existing sessions;
  v_row      sessions;
BEGIN
  v_num := NULLIF(p_table, '')::int;
  IF v_num IS NULL OR v_num < 1 THEN
    RETURN jsonb_build_object('error', 'invalid table number');
  END IF;

  SELECT COALESCE(table_count, 0) INTO v_max FROM settings WHERE restaurant_id = p_restaurant_id;
  IF v_max > 0 AND v_num > v_max THEN
    RETURN jsonb_build_object('error', format('Table %s doesn''t exist — tables are 1–%s.', v_num, v_max));
  END IF;

  SELECT * INTO v_existing FROM sessions
    WHERE restaurant_id = p_restaurant_id AND table_number = p_table AND status <> 'closed'
    LIMIT 1;

  IF FOUND THEN
    UPDATE sessions
       SET status = 'open', opened_by = 'waiter',
           opened_at = COALESCE(v_existing.opened_at, now()), last_activity_at = now()
     WHERE id = v_existing.id
     RETURNING * INTO v_row;
  ELSE
    INSERT INTO sessions (table_number, status, opened_by, opened_at, last_activity_at, restaurant_id)
    VALUES (p_table, 'open', 'waiter', now(), now(), p_restaurant_id)
    RETURNING * INTO v_row;
  END IF;

  -- Opening the table answers any pending "asked to open" request for it.
  UPDATE requests SET status = 'approved'
    WHERE restaurant_id = p_restaurant_id AND table_number = p_table AND status = 'pending';

  RETURN to_jsonb(v_row);
END; $$;

-- Lock down: service-role only (the editor endpoint calls it via supabaseAdmin).
REVOKE EXECUTE ON FUNCTION lfh_staff_open_table(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_staff_open_table(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
