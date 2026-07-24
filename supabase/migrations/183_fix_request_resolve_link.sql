-- 183 — close the loop between a fix_request and the error row it came from (owner 2026-07-24:
-- "whatever you fix, mark it resolved too — make it a rule; and stop re-offering Send to Claude
-- on something already sent/fixed after a refresh").
--
-- ⚠ MIGRATION NUMBER: next free after 182. Additive columns + one trigger — safe at any number;
--   renumber if a parallel branch takes 183 first.
--
-- Two problems this fixes:
--   1) A request stored NO pointer to its source error row, so nothing could clear that error
--      from admin → Repair "Problems right now" when the fix landed. The row lingered and kept
--      offering "Fix now / Send to Claude" forever (and on every refresh — the UI's "sent" flag
--      was in-memory only).
--   2) "Mark resolved when fixed" was a manual step the agent had to remember. Now it's ENFORCED
--      at the DB: whoever flips a request to fixed/dismissed (the admin PATCH route, the live-fix
--      agent's SQL, or the night robot) auto-resolves the linked error + its repeat-group.
--
-- action_id → the staff_actions error row this request was filed from (NULL for owner-described).
-- err_key   → the SAME group key the Repair UI builds (panel|restaurant|action|left(detail,90)),
--             stored at file time so the panel can match an error tile to its queued/fixed request
--             across a refresh WITHOUT re-deriving it from context. Both nullable, instant ADDs.

ALTER TABLE fix_requests ADD COLUMN IF NOT EXISTS action_id uuid;
ALTER TABLE fix_requests ADD COLUMN IF NOT EXISTS err_key   text;

CREATE INDEX IF NOT EXISTS idx_fix_requests_err_key ON fix_requests (err_key) WHERE err_key IS NOT NULL;

-- When a request is CLOSED (fixed or dismissed) and it came from an error row, clear that error —
-- and every un-resolved repeat of it (same panel + action + detail-prefix + restaurant) — from the
-- "Problems right now" list + the dashboard red-button count. Mirrors how the UI groups repeats and
-- how mig 181's resolve-error endpoint clears a whole group.
CREATE OR REPLACE FUNCTION fix_request_resolve_error() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e RECORD;
BEGIN
  IF NEW.action_id IS NOT NULL
     AND NEW.status IN ('fixed', 'dismissed')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT panel, action, detail, restaurant_id INTO e FROM staff_actions WHERE id = NEW.action_id;
    IF FOUND THEN
      UPDATE staff_actions
         SET resolved_at = now()
       WHERE level = 'error'
         AND resolved_at IS NULL
         AND panel = e.panel
         AND action = e.action
         AND COALESCE(LEFT(detail, 90), '') = COALESCE(LEFT(e.detail, 90), '')
         AND restaurant_id IS NOT DISTINCT FROM e.restaurant_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fix_request_resolve_error ON fix_requests;
CREATE TRIGGER trg_fix_request_resolve_error
  AFTER UPDATE ON fix_requests
  FOR EACH ROW EXECUTE FUNCTION fix_request_resolve_error();

NOTIFY pgrst, 'reload schema';
