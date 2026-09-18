-- 400 — THE SAME FAILURE A THOUSAND TIMES IS ONE LINE, NOT A THOUSAND.
--
-- Owner, 2026-09-19: *"in fix now there are so many problems right now fix all of them, i'm not
-- able to open it, that many of the problems are there … and make sure this also never happens."*
--
-- WHAT HAPPENED
--   The 62-restaurant stress run pushed the database past what a 407 MB box can serve, so requests
--   started timing out — correctly, and the app handled them correctly (the panels queued the
--   writes and replayed them). But every one of those timeouts wrote its OWN row to
--   `staff_actions`, and the repair board counted them:
--
--       463 × "POST sessions/open — TimeoutError: The operation was aborted due to timeout"
--       334 × "GET summary — TimeoutError: …"
--        51 × "GET board — TimeoutError: …"
--        …   992 open error rows in total, every single one the same handful of sentences
--
--   Two harms, and the second is worse than the first:
--     1. THE BOARD BECAME UNREADABLE. 992 "problems" that are really six, and a bell showing 99+.
--        The owner could not tell whether anything was actually wrong. (They are all resolved
--        now — resolved, not deleted: every row is still on the Logs page.)
--     2. LOGGING AMPLIFIED THE OUTAGE. `staff_actions` carries twelve indexes. At the exact moment
--        the database was struggling, each failure added another indexed INSERT to it. The busier
--        it got, the more it was asked to write about being busy.
--
-- WHAT THIS CHANGES
--   `lfh_log_error_once` collapses a REPEAT of the same failure into the row that is already
--   there: same panel, same action, same detail text, still unresolved, seen within the last six
--   hours → bump `occurrences` and `last_seen_at` instead of inserting. A genuinely new failure
--   still gets its own row, immediately, exactly as before.
--
--   So a rush now writes ONE row that says "×463" rather than 463 rows, `created_at` still marks
--   when the problem FIRST appeared (which is what the board sorts and reports by), and
--   `last_seen_at` says whether it is still happening.
--
-- WHY SIX HOURS, AND WHY "UNRESOLVED"
--   A resolved row is a closed matter: if the same failure returns after someone cleared it, that
--   is news and it must open a fresh row — the "came back after the fix" signal the board already
--   draws depends on it. And a window stops one ancient row absorbing a problem that recurs weeks
--   later: past six hours the same text starts a new line, which is what a human would call a new
--   incident.
--
-- NOT DONE HERE, DELIBERATELY: nothing is deleted, no retention is changed, no error is hidden.
-- `lfh_prune_logs()` still owns retention, and an error still fires its owner alert (the alert
-- layer already groups by panel:action, so it was never the 463× problem).
--
-- Verify:  node scripts/verify-db-grants.mjs

-- ── the two new columns ────────────────────────────────────────────────────────────────────────
-- Additive, with defaults, so every existing row and every existing reader is unchanged: a row
-- nobody has bumped reads as 1 occurrence, which is what it is.
ALTER TABLE staff_actions
  ADD COLUMN IF NOT EXISTS occurrences  int         NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

COMMENT ON COLUMN staff_actions.occurrences  IS
  'How many times this exact failure has been recorded (mig 400). 1 = once. Only lfh_log_error_once bumps it.';
COMMENT ON COLUMN staff_actions.last_seen_at IS
  'The most recent time this failure happened (mig 400). NULL = only ever once, at created_at.';

-- The lookup the collapse does, and nothing else: unresolved errors, newest first, matched on
-- (panel, action, detail). Partial so it stays tiny — error rows are a small slice of the table,
-- and this is the only query shape that reads it.
CREATE INDEX IF NOT EXISTS idx_staff_actions_error_repeat
  ON staff_actions (panel, action, detail, created_at DESC)
  WHERE level = 'error' AND resolved_at IS NULL;

-- ── the writer ─────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lfh_log_error_once(
  p_panel         text,
  p_action        text,
  p_detail        text,
  p_table_number  text    DEFAULT NULL,
  p_order_id      uuid    DEFAULT NULL,
  p_device_id     text    DEFAULT NULL,
  p_actor         text    DEFAULT NULL,
  p_actor_id      uuid    DEFAULT NULL,
  p_restaurant_id uuid    DEFAULT NULL,
  p_scoped        boolean DEFAULT false   -- true = the caller really means this restaurant (or NULL)
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id    uuid;
  v_count int;
BEGIN
  -- Bump the open row for this exact failure, if there is one. FOR UPDATE is not needed: the
  -- UPDATE itself takes the row lock, and two simultaneous bumps of the same row simply both
  -- count. A lost count here is worth far less than a lock held during a rush.
  UPDATE staff_actions
     SET occurrences  = occurrences + 1,
         last_seen_at = now()
   WHERE id = (
     SELECT id FROM staff_actions
      WHERE level = 'error' AND resolved_at IS NULL
        AND panel = p_panel AND action = p_action
        AND detail IS NOT DISTINCT FROM p_detail
        AND created_at >= now() - interval '6 hours'
      ORDER BY created_at DESC
      LIMIT 1
   )
  RETURNING id, occurrences INTO v_id, v_count;

  IF v_id IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'id', v_id, 'occurrences', v_count, 'collapsed', true);
  END IF;

  -- Nothing to bump → a new problem, recorded now. `p_scoped` exists because `restaurant_id` has
  -- a DEFAULT of restaurant #1 and an explicit NULL means "platform-level": the caller has to be
  -- able to say which it meant, exactly as lib/oplog.ts's insert already distinguishes them.
  IF p_scoped THEN
    INSERT INTO staff_actions
      (panel, action, detail, table_number, order_id, device_id, actor, actor_id, level, restaurant_id)
    VALUES
      (p_panel, p_action, p_detail, p_table_number, p_order_id, p_device_id, p_actor, p_actor_id, 'error', p_restaurant_id)
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO staff_actions
      (panel, action, detail, table_number, order_id, device_id, actor, actor_id, level)
    VALUES
      (p_panel, p_action, p_detail, p_table_number, p_order_id, p_device_id, p_actor, p_actor_id, 'error')
    RETURNING id INTO v_id;
  END IF;

  RETURN json_build_object('ok', true, 'id', v_id, 'occurrences', 1, 'collapsed', false);
END $$;

-- A new Postgres function is PUBLIC-executable by default (mig 038/267 lesson).
REVOKE ALL ON FUNCTION lfh_log_error_once(text, text, text, text, uuid, text, text, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_log_error_once(text, text, text, text, uuid, text, text, uuid, uuid, boolean)
  TO service_role;

NOTIFY pgrst, 'reload schema';
