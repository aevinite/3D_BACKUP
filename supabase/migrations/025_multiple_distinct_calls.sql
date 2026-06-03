-- v2: allow MULTIPLE DISTINCT waiter calls per session at once.
--
-- Before, lfh_call_waiter blocked any new call while ANY call was unresolved
-- ("one active call per session"). So if a guest tapped Water and then Napkins,
-- only Water was recorded — Napkins was silently dropped. Now each DIFFERENT
-- request (Water, Napkins, Clean table…) is its own active call and they all show
-- as separate emojis on the floor; only an identical, still-pending request is
-- de-duped (tapping Water twice won't make two Water calls).
--
-- Everything else is unchanged: still requires an OPEN session and an APPROVED
-- member, still respects the blocklist.

CREATE OR REPLACE FUNCTION lfh_call_waiter(p_token text, p_reason text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_s sessions; v_dup int;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF NOT v_m.approved THEN RETURN json_build_object('ok', false, 'reason', 'not_approved'); END IF;
  IF lfh_is_blocked(v_m.phone, v_s.table_number) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  -- De-dupe only the SAME request: if this exact reason is already pending for the
  -- session, don't add a second identical one. Different reasons are allowed to stack.
  SELECT count(*) INTO v_dup FROM waiter_calls
    WHERE session_id = v_s.id AND NOT resolved AND note IS NOT DISTINCT FROM p_reason;
  IF v_dup > 0 THEN RETURN json_build_object('ok', true, 'already_active', true); END IF;
  INSERT INTO waiter_calls(table_number, note, session_id, member_id) VALUES (v_s.table_number, p_reason, v_s.id, v_m.id);
  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  RETURN json_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION lfh_call_waiter(text, text) TO anon;

NOTIFY pgrst, 'reload schema';
