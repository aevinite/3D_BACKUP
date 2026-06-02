-- v2: WAITER-CONTROLLED OPENING — reverses the auto-open from migration 018.
--
-- New rule (decided 2026-06-02): guests do NOT open tables. Staff open a table's
-- session from the editor floor (/api/sessions/open). The QR is only for
-- autofilling the table number. To order, the session must ALREADY be open.
-- A guest who lands on a not-open table uses the REQUEST flow (lfh_request),
-- which pops on the editor for staff to action.
--
-- So lfh_join_session no longer creates a session: if none is open it returns
-- 'no_open_session'. Everything else (head = first joiner, guests need approval,
-- location enforced, blocklist) stays the same.

CREATE OR REPLACE FUNCTION lfh_join_session(p_table text, p_name text, p_lat double precision, p_lng double precision)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_session sessions; v_token text; v_role text; v_approved boolean; v_count int; v_member uuid;
BEGIN
  IF lfh_is_blocked(NULL, p_table) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  IF NOT lfh_geo_ok(p_lat, p_lng) THEN RETURN json_build_object('ok', false, 'reason', 'too_far'); END IF;

  -- Staff must have opened the table first. No auto-open.
  SELECT * INTO v_session FROM sessions WHERE table_number = p_table AND status = 'open' LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_open_session'); END IF;

  SELECT count(*) INTO v_count FROM session_members WHERE session_id = v_session.id AND NOT removed;
  v_token := replace(gen_random_uuid()::text, '-', '');
  IF v_count = 0 THEN
    v_role := 'owner'; v_approved := true;            -- first guest at an opened table = head
  ELSE
    v_role := 'guest'; v_approved := v_session.auto_approve;
  END IF;

  INSERT INTO session_members(session_id, name, token, role, approved, location_ok)
    VALUES (v_session.id, p_name, v_token, v_role, v_approved, true)
    RETURNING id INTO v_member;
  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_session.id;

  RETURN json_build_object('ok', true, 'token', v_token, 'member_id', v_member,
    'session_id', v_session.id, 'role', v_role, 'approved', v_approved);
END; $$;

GRANT EXECUTE ON FUNCTION lfh_join_session(text, text, double precision, double precision) TO anon;

NOTIFY pgrst, 'reload schema';
