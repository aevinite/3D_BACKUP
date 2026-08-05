-- 103_close_all_tables_rpc.sql
-- ⚠️ RETIRED — the function this file creates NO LONGER EXISTS.
--   (noted 2026-08-05, T8 database sweep)
--   Migration 281 (`281_close_all_removed_and_three_of_four.sql`) DROPPED both bulk table RPCs —
--   `lfh_staff_open_all_tables` and `lfh_staff_close_all_tables` — under the owner's "no table
--   ends itself" rule, and the panels + routes were updated to match (see the note at
--   public/panels/editor/app.js: "/sessions/close-all and /sessions/open-all are now GONE from
--   the server too"). Nothing below is live. Kept for the reasoning, not as truth.
-- INSTANT "Close all" (owner 2026-06-27) — the mirror of mig 102's open-all. The manager's
-- "Close all" fired one POST /sessions/:id/close PER open session (N round-trips to Sydney) and
-- the tiles only freed AFTER all finished. This RPC closes every CLOSEABLE open session in ONE
-- call, replicating lib/sessionClose.ts EXACTLY:
--   • BLOCK guard (closeBlock): a session is NOT closed (unless p_force) if any of its orders is
--     non-archived, non-cancelled AND (still cooking = received/preparing) OR (unpaid = payment_status<>'paid').
--   • for each session that DOES close: status→closed (+closed_at); cancel+archive its active unpaid
--     received/preparing orders; archive the rest; release every member (removed=true). Same as closeSession.
--   • waiter_calls are deliberately NOT touched (matches closeSession — the summary's stale-call guard
--     relies on a closed session's unresolved call being ignored, not resolved).
-- Returns { closed, skipped, closed_tables } — closed_tables drives the client's 8s UNDO (reopen).
-- service-role only (the editor endpoint calls it via supabaseAdmin).

CREATE OR REPLACE FUNCTION lfh_staff_close_all_tables(p_restaurant_id uuid, p_force boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_closed       int := 0;
  v_skipped      int := 0;
  v_closed_tabs  text[] := '{}';
  v_sess         record;
  v_blocked      boolean;
BEGIN
  FOR v_sess IN
    SELECT id, table_number FROM sessions
    WHERE restaurant_id = p_restaurant_id AND status = 'open'
  LOOP
    -- closeBlock(): blocked when any live order is still cooking OR unpaid.
    SELECT EXISTS (
      SELECT 1 FROM orders
      WHERE session_id = v_sess.id AND archived = false AND status <> 'cancelled'
        AND (status IN ('received', 'preparing') OR payment_status <> 'paid')
    ) INTO v_blocked;

    IF v_blocked AND NOT p_force THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- close + cleanup, mirroring closeSession() step for step.
    UPDATE sessions SET status = 'closed', closed_at = now() WHERE id = v_sess.id;
    UPDATE orders SET status = 'cancelled', archived = true
      WHERE session_id = v_sess.id AND archived = false AND payment_status <> 'paid'
        AND status IN ('received', 'preparing');
    UPDATE orders SET archived = true
      WHERE session_id = v_sess.id AND archived = false;
    UPDATE session_members SET removed = true
      WHERE session_id = v_sess.id AND removed = false;

    v_closed := v_closed + 1;
    IF v_sess.table_number IS NOT NULL THEN
      v_closed_tabs := array_append(v_closed_tabs, v_sess.table_number);
    END IF;
  END LOOP;

  RETURN json_build_object('closed', v_closed, 'skipped', v_skipped, 'closed_tables', to_json(v_closed_tabs));
END; $$;

-- Lock down: service-role only.
REVOKE EXECUTE ON FUNCTION lfh_staff_close_all_tables(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_staff_close_all_tables(uuid, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
