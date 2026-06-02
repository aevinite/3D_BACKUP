-- v2: leaving a table must NEVER close it. The table stays OPEN until STAFF turn
-- it off — so if the head leaves (or was a mistaken connection), the table stays
-- live and the next guest in becomes the new head. Replaces the 020 behaviour
-- where the last person leaving closed the session.
--
-- Head leaving: ownership passes to the earliest-joined remaining approved member
-- if there is one; otherwise the table just stays open with no members (next
-- joiner becomes head). When the table goes empty, the shared cart is wiped so
-- the next head starts fresh.

CREATE OR REPLACE FUNCTION lfh_leave_session(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_next session_members; v_remaining int; v_transferred boolean := false;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', true, 'already_gone', true); END IF;

  IF v_m.role = 'owner' THEN
    SELECT * INTO v_next FROM session_members
      WHERE session_id = v_m.session_id AND NOT removed AND id <> v_m.id AND approved
      ORDER BY joined_at LIMIT 1;
    UPDATE session_members SET removed = true WHERE id = v_m.id;
    IF v_next.id IS NOT NULL THEN
      UPDATE session_members SET role = 'owner' WHERE id = v_next.id; -- hand the table over
      v_transferred := true;
    END IF;
    -- NOTE: the session is intentionally NOT closed here. Only staff close a table.
  ELSE
    UPDATE session_members SET removed = true WHERE id = v_m.id;
  END IF;

  -- Table now empty (but still open) -> clear the shared cart for the next head.
  SELECT count(*) INTO v_remaining FROM session_members WHERE session_id = v_m.session_id AND NOT removed;
  IF v_remaining = 0 THEN UPDATE sessions SET cart = '[]'::jsonb WHERE id = v_m.session_id; END IF;

  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_m.session_id;
  RETURN json_build_object('ok', true, 'session_closed', false, 'transferred', v_transferred);
END; $$;

GRANT EXECUTE ON FUNCTION lfh_leave_session(text) TO anon;

NOTIFY pgrst, 'reload schema';
