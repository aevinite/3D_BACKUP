-- 207_rate_limit_waiter_join.sql — wire the rate limiter into join-table and call-waiter RPCs.
-- Bodies are the CURRENT live definitions with ONE guard added after the restaurant is known.
-- (owner, 2026-07-26) call_waiter_table already had a 6s dedupe + a 6-call cap; this adds the
-- ADMIN-CONFIGURABLE limit on top so it shows up in the Problems section like the rest.

CREATE OR REPLACE FUNCTION public.lfh_join_session(p_table text, p_name text, p_lat double precision, p_lng double precision, p_device text DEFAULT NULL::text, p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_session sessions; v_token text; v_role text; v_approved boolean; v_count int; v_member uuid;
BEGIN
  IF lfh_is_blocked(NULL, p_table, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  -- A device banned AT THIS RESTAURANT is refused here too (scoped — mig 139).
  IF lfh_device_banned(p_device, NULL, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'banned'); END IF;
  -- RATE LIMIT (mig 205): cap join attempts per device/table in the window.
  IF NOT lfh_rate_check(v_rid, 'join_session', 'join:' || COALESCE(NULLIF(p_device, ''), 't' || p_table),
                        'Table ' || p_table) THEN
    RETURN json_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  IF NOT lfh_geo_ok(p_lat, p_lng, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'too_far'); END IF;

  SELECT * INTO v_session FROM sessions
    WHERE table_number = p_table AND status = 'open' AND restaurant_id = v_rid LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_open_session'); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_session.id::text, 0));

  SELECT count(*) INTO v_count FROM session_members WHERE session_id = v_session.id AND NOT removed;
  v_token := replace(gen_random_uuid()::text, '-', '');
  IF v_count = 0 THEN
    v_role := 'owner'; v_approved := true;
  ELSE
    v_role := 'guest'; v_approved := v_session.auto_approve;
  END IF;

  INSERT INTO session_members(session_id, name, token, role, approved, location_ok, device_id, restaurant_id)
    VALUES (v_session.id, p_name, v_token, v_role, v_approved, true, p_device, v_rid)
    RETURNING id INTO v_member;
  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_session.id;

  RETURN json_build_object('ok', true, 'token', v_token, 'member_id', v_member,
    'session_id', v_session.id, 'role', v_role, 'approved', v_approved);
END; $function$;

CREATE OR REPLACE FUNCTION public.lfh_call_waiter_table(p_table text, p_note text, p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_t text := NULLIF(btrim(p_table), '');
  v_note text := NULLIF(btrim(p_note), '');
BEGIN
  IF v_t IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'no_table'); END IF;
  -- A blocked table can't summon staff.
  IF lfh_is_blocked(NULL, v_t, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  -- RATE LIMIT (mig 205): admin-configurable cap on waiter calls per table, on top of the
  -- existing 6s dedupe + 6-call cap below.
  IF NOT lfh_rate_check(v_rid, 'waiter_call', 'table:' || v_t, 'Table ' || v_t) THEN
    RETURN json_build_object('ok', true, 'reason', 'rate_limited');
  END IF;
  -- Anti-spam throttle: ignore a repeat of the SAME request for the same table
  -- within 6 seconds. Keyed on the note too, so a DIFFERENT request still lands.
  IF EXISTS (SELECT 1 FROM waiter_calls
              WHERE table_number = v_t AND NOT resolved
                AND created_at > now() - interval '6 seconds'
                AND restaurant_id = v_rid
                AND note IS NOT DISTINCT FROM v_note) THEN
    RETURN json_build_object('ok', true, 'reason', 'already_sent');
  END IF;
  -- Hard cap: never let more than 6 unresolved calls stack on one table.
  IF (SELECT count(*) FROM waiter_calls
        WHERE table_number = v_t AND NOT resolved AND restaurant_id = v_rid) >= 6 THEN
    RETURN json_build_object('ok', true, 'reason', 'capped');
  END IF;
  INSERT INTO waiter_calls(table_number, note, restaurant_id) VALUES (v_t, v_note, v_rid);
  RETURN json_build_object('ok', true);
END; $function$;
