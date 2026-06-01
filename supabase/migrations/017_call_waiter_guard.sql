-- v2: harden lfh_call_waiter so it refuses unless the session is OPEN and the member is
-- APPROVED (mirrors lfh_place_order). A stale token on a closed/never-open table can no
-- longer place a waiter call — closes the "called a waiter on a table that wasn't open" gap.
CREATE OR REPLACE FUNCTION lfh_call_waiter(p_token text, p_reason text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_s sessions; v_active int;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF NOT v_m.approved THEN RETURN json_build_object('ok', false, 'reason', 'not_approved'); END IF;
  IF lfh_is_blocked(v_m.phone, v_s.table_number) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT count(*) INTO v_active FROM waiter_calls WHERE session_id = v_s.id AND NOT resolved;
  IF v_active > 0 THEN RETURN json_build_object('ok', true, 'already_active', true); END IF;
  INSERT INTO waiter_calls(table_number, note, session_id, member_id) VALUES (v_s.table_number, p_reason, v_s.id, v_m.id);
  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  RETURN json_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION lfh_call_waiter(text, text) TO anon;
NOTIFY pgrst, 'reload schema';
