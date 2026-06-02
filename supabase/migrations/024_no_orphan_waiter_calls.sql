-- Bulletproofing: a waiter call (or pending request) must NEVER outlive its
-- session. Symptom this fixes: a FREE/closed table showing a waiter-call badge
-- (e.g. "Napkins") because a call was left unresolved after its session was
-- deleted. Deleting a session sets waiter_calls.session_id = NULL (ON DELETE SET
-- NULL), which orphaned the call so it still matched the table number on the floor.
--
-- The close path (migration 020's BEFORE UPDATE trigger) already resolves a
-- session's calls when status -> closed. This adds the missing DELETE path and a
-- one-time sweep of any existing orphans.

-- 1) One-time: resolve every unresolved call that isn't tied to an OPEN session.
--    In the waiter-controlled model every real call has an open session, so a
--    call with no open session is stale and should be cleared.
UPDATE waiter_calls SET resolved = true
  WHERE NOT resolved
    AND (session_id IS NULL OR session_id NOT IN (SELECT id FROM sessions WHERE status = 'open'));

-- 2) One-time: deny pending requests that no longer have an open table behind them.
UPDATE requests SET status = 'denied'
  WHERE status = 'pending'
    AND table_number NOT IN (SELECT table_number FROM sessions WHERE status = 'open');

-- 3) Going forward: if a session row is DELETED (not just closed), resolve its
--    calls and deny its pending requests BEFORE the row goes, so nothing can be
--    left dangling by table number.
CREATE OR REPLACE FUNCTION lfh_session_delete_cleanup()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE waiter_calls SET resolved = true WHERE session_id = OLD.id AND NOT resolved;
  UPDATE requests     SET status = 'denied' WHERE table_number = OLD.table_number AND status = 'pending';
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_session_delete ON sessions;
CREATE TRIGGER trg_session_delete BEFORE DELETE ON sessions
  FOR EACH ROW EXECUTE FUNCTION lfh_session_delete_cleanup();

NOTIFY pgrst, 'reload schema';
