-- 217_shift_table_concurrency.sql
-- Fix: moving a party onto a table at the same moment someone else takes that table
-- surfaced a RAW DATABASE ERROR instead of "that table is taken".
--
-- Found by the AV-live rush test 2026-07-28 (44,756 actions in 30 min): 2 shifts and
-- 1 placement died with
--    duplicate key value violates unique constraint "idx_one_open_session_per_table"
-- Migration 202 already serialized concurrent PLACEMENTS per table with a
-- transaction advisory lock, but lfh_staff_shift_table never took that lock. Its
-- "is the destination free?" test is a plain read-then-write: two waiters shifting
-- onto table 7 (or a shift racing a place-order on table 7) both pass the test, and
-- whoever commits second violates the one-open-session-per-table unique index. The
-- waiter just sees a failure with no idea the table was simply occupied.
--
-- Two additions, NOTHING else changed (base = the CURRENT definition, migration 166 —
-- the migration-recreate-reverts-a-fix lesson: table-tag moving + the four realtime
-- breadcrumbs are preserved verbatim):
--   1. the SAME advisory-lock key lfh_staff_place_order uses ('lfh_place:<rid>:<table>',
--      mig 202) taken on the DESTINATION table, so shifts and placements queue behind
--      each other rather than racing — then the occupancy test is re-run UNDER the lock;
--   2. a unique_violation handler that answers the existing 'target_occupied' reason
--      (which every panel already words as "that table is taken"), so even an unforeseen
--      race degrades to a clear message instead of a 500.

CREATE OR REPLACE FUNCTION public.lfh_staff_shift_table(p_session uuid, p_to text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_s sessions; v_from text; v_rid uuid;
BEGIN
  SELECT * INTO v_s FROM sessions WHERE id = p_session;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_session'); END IF;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF p_to !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'reason', 'bad_table'); END IF;
  IF p_to = v_s.table_number THEN RETURN json_build_object('ok', false, 'reason', 'same_table'); END IF;
  v_rid := COALESCE(v_s.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);

  -- CONCURRENCY (mig 217): serialize on the DESTINATION table using the identical lock
  -- key as lfh_staff_place_order (mig 202), so a shift and a placement onto the same
  -- table cannot both pass the "is it free?" test. A near-simultaneous second request
  -- waits here until the first commits, then sees the truth below.
  PERFORM pg_advisory_xact_lock(hashtextextended('lfh_place:' || v_rid::text || ':' || COALESCE(p_to, ''), 0));

  -- Occupancy is checked UNDER the lock: an earlier read could predate a competing commit.
  IF EXISTS (SELECT 1 FROM sessions WHERE table_number = p_to AND status = 'open' AND restaurant_id = v_rid) THEN
    RETURN json_build_object('ok', false, 'reason', 'target_occupied');
  END IF;

  v_from := v_s.table_number;
  UPDATE sessions     SET table_number = p_to, last_activity_at = NOW() WHERE id = p_session;
  UPDATE orders       SET table_number = p_to WHERE session_id = p_session;
  UPDATE waiter_calls SET table_number = p_to WHERE session_id = p_session AND NOT resolved;
  -- TAG: the mark belongs to the PARTY — move it with them. Only when the party HAS a
  -- mark: the target's stale tag then gives way (PK). An unmarked party shifting onto a
  -- pre-marked free table leaves that mark alone. Rows fire the table_tags trigger → repaint.
  IF EXISTS (SELECT 1 FROM table_tags WHERE restaurant_id = v_rid AND table_number = v_from) THEN
    DELETE FROM table_tags WHERE restaurant_id = v_rid AND table_number = p_to;
    UPDATE table_tags SET table_number = p_to
      WHERE restaurant_id = v_rid AND table_number = v_from;
  END IF;
  -- Nudge BOTH table topics (guests) AND BOTH tables on 'ops' (staff panels' targeted
  -- refetch) so the OLD table clears and the NEW table fills — no wrong/duplicated tile.
  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id) VALUES
    ('table:' || v_from, 'session', p_session::text, v_from, v_rid),
    ('table:' || p_to,   'session', p_session::text, p_to,   v_rid),
    ('ops',              'session', p_session::text, p_to,   v_rid),
    ('ops',              'session', p_session::text, v_from, v_rid);
  RETURN json_build_object('ok', true, 'from', v_from, 'to', p_to);
EXCEPTION
  -- Belt-and-braces (mig 217): any residual race on the one-open-session-per-table index
  -- becomes the same clear answer the panels already show, never a raw 500.
  WHEN unique_violation THEN
    RETURN json_build_object('ok', false, 'reason', 'target_occupied');
END; $function$;

-- Staff-only function (migration 038 rule: new/replaced functions are PUBLIC-executable
-- by default). Re-assert the grants so anon/authenticated can never call it.
REVOKE ALL ON FUNCTION public.lfh_staff_shift_table(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_staff_shift_table(uuid, text) TO service_role;
