-- 219 — take the MUTING back out of the fixed-problem memory (owner 2026-07-28, same day as 218)
--
-- Mig 218 shipped two things. The owner wanted neither of them to hide anything:
--   • a record of "this problem was fixed, here's the PR" — KEPT. Its only effect is that pressing
--     Fix-now on an occurrence from BEFORE that fix answers "already fixed on <date>, see this PR"
--     instead of opening a second Claude session to redo the work. The red tile still shows.
--   • a "not a real problem" mute (state='ignored') that pre-resolved future occurrences so they
--     never alarmed — REMOVED ENTIRELY. The owner's words: "don't do anything that's gonna break or
--     hide something from me." Nothing in this app may silence an error any more.
--
-- So: drop the muting state, drop the counters that only the muted path fed, and drop the bump
-- function. `error_signatures` is now a plain, honest record of fixes. The error-logging path
-- (lib/oplog.ts, /api/log/client-error) no longer consults this table AT ALL — every error is
-- written and alarms exactly as it did before mig 218.

-- Belt-and-braces: nothing should be muted yet (the table was minutes old and empty on both
-- stacks when this was written), but if anything WAS muted, un-mute it rather than keep it hidden.
--
-- ⚠️ THESE TWO STATEMENTS READ A COLUMN THIS FILE DELETES 12 LINES LOWER, so they are correct
-- exactly ONCE (fixed 2026-08-13, T16 finding 7620). On the second run `error_signatures.state`
-- is gone — migration 218's `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, so
-- nothing re-adds it — and `es.state` raised `column es.state does not exist`.
-- seed-supabase.mjs throws on the first failing file, so a re-seed DIED HERE and migrations
-- 220–312 never ran: no merge record, no tax stamping, no discount gross-up, and never reaching
-- migration 307, the file whose whole job is making a re-seed safe.
-- So the un-mute only runs while the column is still there. Wrapped, not deleted: on a fresh
-- database 218 does create `state`, and that single run must still un-mute anything muted.
DO $unmute_once$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'error_signatures' AND column_name = 'state'
  ) THEN
    EXECUTE $q$
      UPDATE staff_actions sa
         SET resolved_at = NULL
       WHERE sa.level = 'error'
         AND sa.resolved_at IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM error_signatures es
            WHERE es.state = 'ignored'
              AND es.panel = sa.panel AND es.action = sa.action
              AND (es.restaurant_id IS NULL OR es.restaurant_id = sa.restaurant_id)
         )
    $q$;
    EXECUTE $q$ DELETE FROM error_signatures WHERE state = 'ignored' $q$;
  ELSE
    RAISE NOTICE '219: error_signatures.state already removed — nothing to un-mute (this file has run before)';
  END IF;
END $unmute_once$;

ALTER TABLE error_signatures
  DROP COLUMN IF EXISTS state,
  DROP COLUMN IF EXISTS recurrences,
  DROP COLUMN IF EXISTS last_seen_at;

DROP FUNCTION IF EXISTS lfh_bump_error_signature(uuid, timestamptz);

-- Recreate the recorder without the state argument (an 8-arg → 7-arg change needs the drop).
DROP FUNCTION IF EXISTS lfh_remember_error_signature(uuid, text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION lfh_remember_error_signature(
  p_restaurant_id uuid,
  p_panel text,
  p_action text,
  p_sig text,
  p_by text,
  p_pr_url text DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF coalesce(btrim(p_sig), '') = '' THEN
    RAISE EXCEPTION 'signature required';
  END IF;

  UPDATE error_signatures
     SET fixed_at = now(), fixed_by = p_by,
         pr_url = coalesce(p_pr_url, pr_url), note = coalesce(p_note, note)
   WHERE coalesce(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND panel = p_panel AND action = p_action AND sig = p_sig
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO error_signatures (restaurant_id, panel, action, sig, fixed_by, pr_url, note)
    VALUES (p_restaurant_id, p_panel, p_action, p_sig, p_by, p_pr_url, p_note)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION lfh_remember_error_signature(uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_remember_error_signature(uuid, text, text, text, text, text, text) TO service_role;

COMMENT ON TABLE error_signatures IS
  'Record of problems that were FIXED (with the PR link), so pressing Fix-now on an occurrence from before that fix answers "already fixed" instead of opening a duplicate Claude session. It never hides or silences an error — the error log and the Problems list are untouched by it (mig 219 removed the muting that mig 218 briefly had).';
