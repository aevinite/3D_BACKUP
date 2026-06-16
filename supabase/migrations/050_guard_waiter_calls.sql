-- 050_guard_waiter_calls.sql
-- SECURITY FIX: the guest "call waiter" bell used to INSERT directly into
-- waiter_calls, allowed by an always-true RLS INSERT policy (public_insert_calls).
-- That meant ANY client holding the public anon key could flood the staff with
-- fake waiter calls (no table/blocklist check, no rate limit).
--
-- Fix: route the bell through a guarded SECURITY DEFINER RPC that (a) refuses a
-- blocked table, (b) throttles rapid repeats, and (c) caps pile-up; then DROP the
-- open INSERT policy so direct anon inserts are no longer possible (the RPC runs
-- as owner and bypasses RLS, so it still works). Staff read calls via the
-- service-role API, which is unaffected.

CREATE OR REPLACE FUNCTION lfh_call_waiter_table(p_table text, p_note text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t text := NULLIF(btrim(p_table), '');
BEGIN
  IF v_t IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'no_table'); END IF;
  -- A blocked table can't summon staff.
  IF lfh_is_blocked(NULL, v_t) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  -- Anti-spam throttle: ignore a repeat for the same table within 6 seconds.
  -- (Returns ok:true so the guest UI still shows "sent" — it's a silent dedup.)
  IF EXISTS (SELECT 1 FROM waiter_calls
              WHERE table_number = v_t AND NOT resolved
                AND created_at > now() - interval '6 seconds') THEN
    RETURN json_build_object('ok', true, 'reason', 'already_sent');
  END IF;
  -- Hard cap: never let more than 6 unresolved calls stack on one table.
  IF (SELECT count(*) FROM waiter_calls WHERE table_number = v_t AND NOT resolved) >= 6 THEN
    RETURN json_build_object('ok', true, 'reason', 'capped');
  END IF;
  INSERT INTO waiter_calls(table_number, note) VALUES (v_t, NULLIF(btrim(p_note), ''));
  RETURN json_build_object('ok', true);
END; $$;

REVOKE EXECUTE ON FUNCTION lfh_call_waiter_table(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lfh_call_waiter_table(text, text) TO anon, authenticated, service_role;

-- Close the open direct-insert path. RLS stays enabled with NO insert policy →
-- anon can no longer INSERT directly; only the guarded RPC can.
DROP POLICY IF EXISTS "public_insert_calls" ON waiter_calls;

NOTIFY pgrst, 'reload schema';
