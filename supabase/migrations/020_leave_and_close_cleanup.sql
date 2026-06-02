-- v2: members can LEAVE a session, and closing a session CLEANS UP its leftover
-- live state. Powers the guest "session status" widget (leave / change table /
-- unmerge) and the "delete everything when the session is over" requirement.

-- ── leave: a member disconnects from the table ─────────────────────────────
-- A guest just leaves (marked removed -> their token stops working -> client
-- reverts to a private local cart). If the OWNER (head) leaves, ownership passes
-- to the earliest-joined remaining APPROVED member so the table keeps going; if
-- nobody approved is left, the session closes (the trigger below cleans up).
CREATE OR REPLACE FUNCTION lfh_leave_session(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_next session_members;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', true, 'already_gone', true); END IF;

  IF v_m.role = 'owner' THEN
    SELECT * INTO v_next FROM session_members
      WHERE session_id = v_m.session_id AND NOT removed AND id <> v_m.id AND approved
      ORDER BY joined_at LIMIT 1;
    UPDATE session_members SET removed = true WHERE id = v_m.id;
    IF v_next.id IS NOT NULL THEN
      UPDATE session_members SET role = 'owner' WHERE id = v_next.id;       -- hand over the table
      UPDATE sessions SET last_activity_at = NOW() WHERE id = v_m.session_id;
      RETURN json_build_object('ok', true, 'session_closed', false, 'transferred', true);
    ELSE
      UPDATE sessions SET status = 'closed' WHERE id = v_m.session_id;      -- last one out -> close (trigger cleans up)
      RETURN json_build_object('ok', true, 'session_closed', true);
    END IF;
  ELSE
    UPDATE session_members SET removed = true WHERE id = v_m.id;
    UPDATE sessions SET last_activity_at = NOW() WHERE id = v_m.session_id;
    RETURN json_build_object('ok', true, 'session_closed', false);
  END IF;
END; $$;

-- ── close cleanup: wipe leftover live state when a session ends ─────────────
-- Fires for EVERY path that closes a session (staff close, free-table, last
-- person leaving). Clears the shared cart, frees everyone from the table
-- (removed = true, so no stale "seated" state or working tokens), and resolves
-- the table's open calls + pending requests. Member ROWS are kept so the
-- Log/Users history survives — only their live "on the table" state is dropped.
CREATE OR REPLACE FUNCTION lfh_session_close_cleanup()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'closed' AND COALESCE(OLD.status, '') <> 'closed' THEN
    NEW.cart := '[]'::jsonb;
    IF NEW.closed_at IS NULL THEN NEW.closed_at := NOW(); END IF;
    UPDATE session_members SET removed = true WHERE session_id = NEW.id AND NOT removed;
    UPDATE waiter_calls   SET resolved = true WHERE session_id = NEW.id AND NOT resolved;
    UPDATE requests       SET status = 'denied' WHERE table_number = NEW.table_number AND status = 'pending';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_session_close ON sessions;
CREATE TRIGGER trg_session_close BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION lfh_session_close_cleanup();

GRANT EXECUTE ON FUNCTION lfh_leave_session(text) TO anon;

NOTIFY pgrst, 'reload schema';
