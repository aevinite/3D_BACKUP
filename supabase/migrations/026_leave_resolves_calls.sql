-- Bug: after a guest LEFT a table, their waiter requests (Water, Clean table…)
-- stayed active on the floor. Leaving should clear them. This updates
-- lfh_leave_session so that:
--   • the leaver's own unresolved waiter calls are resolved (they're gone), and
--   • if the table is now EMPTY, ALL its remaining calls are resolved and its
--     pending requests denied (nobody's there to serve), plus the cart is cleared.
-- Placed ORDERS are intentionally left untouched — they must persist for the bill.

CREATE OR REPLACE FUNCTION lfh_leave_session(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_next session_members; v_remaining int; v_transferred boolean := false; v_table text;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', true, 'already_gone', true); END IF;
  SELECT table_number INTO v_table FROM sessions WHERE id = v_m.session_id;

  -- The leaver's own pending calls go with them (water/napkins/clean shouldn't
  -- keep flagging the floor once the person who asked has left).
  UPDATE waiter_calls SET resolved = true WHERE member_id = v_m.id AND NOT resolved;

  IF v_m.role = 'owner' THEN
    SELECT * INTO v_next FROM session_members
      WHERE session_id = v_m.session_id AND NOT removed AND id <> v_m.id AND approved
      ORDER BY joined_at LIMIT 1;
    UPDATE session_members SET removed = true WHERE id = v_m.id;
    IF v_next.id IS NOT NULL THEN
      UPDATE session_members SET role = 'owner' WHERE id = v_next.id; -- hand the table over
      v_transferred := true;
    END IF;
    -- The session is NOT closed here (only staff close a table); it stays open.
  ELSE
    UPDATE session_members SET removed = true WHERE id = v_m.id;
  END IF;

  -- Table now empty (still open) -> wipe the leftover live state for the next guest.
  SELECT count(*) INTO v_remaining FROM session_members WHERE session_id = v_m.session_id AND NOT removed;
  IF v_remaining = 0 THEN
    UPDATE sessions      SET cart = '[]'::jsonb WHERE id = v_m.session_id;
    UPDATE waiter_calls  SET resolved = true   WHERE session_id = v_m.session_id AND NOT resolved;
    UPDATE requests      SET status = 'denied'  WHERE table_number = v_table AND status = 'pending';
  END IF;

  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_m.session_id;
  RETURN json_build_object('ok', true, 'session_closed', false, 'transferred', v_transferred);
END; $$;

GRANT EXECUTE ON FUNCTION lfh_leave_session(text) TO anon;

NOTIFY pgrst, 'reload schema';
