-- 146_requests_cleanup_restaurant_scope.sql
-- Bug (guest-menu audit 2026-07-07): when a table empties, the leftover-cleanup
-- denies PENDING "open my table" requests by table_number ALONE. Since table
-- numbers repeat across restaurants (each restaurant has its own table 5), one
-- restaurant emptying table 5 wrongly denies ANOTHER restaurant's guest who is
-- waiting on their own "open table 5" — their screen dead-ends and staff lose the
-- request. The `requests` table has carried `restaurant_id` since mig 078, so the
-- fix is simply to AND the same restaurant into every cleanup. Strictly narrowing
-- (never touches another restaurant's rows), so it is safe and additive.
--
-- Three live functions did this unscoped: the guest LEAVE rpc (026), the staff
-- CLOSE trigger (020), and the session DELETE trigger (024). All three are
-- re-created here with `restaurant_id` added; nothing else changes.

-- 1) Guest taps "Leave" (lfh_leave_session — latest body is mig 026 + 084's note).
CREATE OR REPLACE FUNCTION lfh_leave_session(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_next session_members; v_remaining int; v_transferred boolean := false; v_table text; v_rid uuid;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', true, 'already_gone', true); END IF;
  SELECT table_number, restaurant_id INTO v_table, v_rid FROM sessions WHERE id = v_m.session_id;

  UPDATE waiter_calls SET resolved = true WHERE member_id = v_m.id AND NOT resolved;

  IF v_m.role = 'owner' THEN
    SELECT * INTO v_next FROM session_members
      WHERE session_id = v_m.session_id AND NOT removed AND id <> v_m.id AND approved
      ORDER BY joined_at LIMIT 1;
    UPDATE session_members SET removed = true WHERE id = v_m.id;
    IF v_next.id IS NOT NULL THEN
      UPDATE session_members SET role = 'owner' WHERE id = v_next.id;
      v_transferred := true;
    END IF;
  ELSE
    UPDATE session_members SET removed = true WHERE id = v_m.id;
  END IF;

  SELECT count(*) INTO v_remaining FROM session_members WHERE session_id = v_m.session_id AND NOT removed;
  IF v_remaining = 0 THEN
    UPDATE sessions      SET cart = '[]'::jsonb WHERE id = v_m.session_id;
    UPDATE waiter_calls  SET resolved = true   WHERE session_id = v_m.session_id AND NOT resolved;
    UPDATE requests      SET status = 'denied'  WHERE table_number = v_table AND restaurant_id = v_rid AND status = 'pending';
  END IF;

  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_m.session_id;
  RETURN json_build_object('ok', true, 'session_closed', false, 'transferred', v_transferred);
END; $$;

GRANT EXECUTE ON FUNCTION lfh_leave_session(text) TO anon;

-- 2) Staff close a table (BEFORE UPDATE trigger, mig 020).
CREATE OR REPLACE FUNCTION lfh_session_close_cleanup()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'closed' AND COALESCE(OLD.status, '') <> 'closed' THEN
    NEW.cart := '[]'::jsonb;
    IF NEW.closed_at IS NULL THEN NEW.closed_at := NOW(); END IF;
    UPDATE session_members SET removed = true WHERE session_id = NEW.id AND NOT removed;
    UPDATE waiter_calls   SET resolved = true WHERE session_id = NEW.id AND NOT resolved;
    UPDATE requests       SET status = 'denied' WHERE table_number = NEW.table_number AND restaurant_id = NEW.restaurant_id AND status = 'pending';
  END IF;
  RETURN NEW;
END; $$;

-- 3) A session row is DELETED (BEFORE DELETE trigger, mig 024).
CREATE OR REPLACE FUNCTION lfh_session_delete_cleanup()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE waiter_calls SET resolved = true WHERE session_id = OLD.id AND NOT resolved;
  UPDATE requests     SET status = 'denied' WHERE table_number = OLD.table_number AND restaurant_id = OLD.restaurant_id AND status = 'pending';
  RETURN OLD;
END; $$;

NOTIFY pgrst, 'reload schema';
