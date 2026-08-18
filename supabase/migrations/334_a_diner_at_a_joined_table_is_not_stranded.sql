-- 334 · A DINER SITTING AT A JOINED TABLE IS NOT STRANDED
--
-- Owner, 2026-08-17, after the waiter tablet learned to un-merge: "check guest menu also if there is
-- any error [with] merge and all that."  There was, and it was worse than an error — it was silence.
--
-- WHAT WAS WRONG. Staff can join two tables into one party (mig 249). The joined table keeps its own
-- number on every order it rang — that is what makes a split exact — but it has NO session of its
-- own: the party, the bill and the session all live on the table that holds them. Every STAFF route
-- learned to hop across that (lib/tableMerge.ts, and lfh_merge_parent_table in twelve SQL functions).
-- The GUEST side never did. Measured on the dev stack with the anon key, exactly as the guest menu
-- calls it, against a real merge of T24 + T25 (T25 joined, T24 holds the bill):
--
--   lfh_table_status('25')       → {"ok":true,"open":false,"members":0}
--   lfh_join_session('25', …)    → {"ok":false,"reason":"no_open_session"}
--   lfh_call_waiter_table('25')  → {"ok":true}  … but it wrote session_id = NULL
--
-- So the diner at T25 scans the QR on their own table and is told **"this table isn't open — ask
-- staff to open it"**, and components/SessionGate.tsx then polls lfh_table_status every 1.5s for as
-- long as they sit there. It never opens: lfh_staff_open_table correctly refuses a joined table
-- (mig 260, reason 'merged_child'). They cannot join, so they cannot order, and they cannot see the
-- bill. They are stuck in a loop with no way out and nothing on screen explaining why.
--
-- And the bell is worse, because it LIES. lfh_call_waiter_table answered ok:true — the guest is told
-- their waiter is coming — but the row it wrote carries no session_id, and lfh_table_view_summary
-- gathers calls BY SESSION when dining sessions are on ("calls are counted by SESSION, and only when
-- a session exists"). Measured: the floor summary's calls list came back without it. **The guest
-- rang, the app said yes, and no panel anywhere showed it.**
--
-- WHAT THIS CHANGES — three functions, one hop each, nothing else:
--   · lfh_table_status      — ask about the party's table, so a joined table reads as OPEN
--   · lfh_join_session      — join the party, so the diner gets a token like anyone else
--   · lfh_call_waiter_table — stamp the party's session on the call, so it reaches the floor
--
-- WHAT THIS DELIBERATELY DOES NOT CHANGE:
--   · The call keeps `table_number` = the table the guest is REALLY sitting at. The waiter needs to
--     walk to T25, not T24 — and the panels already treat a call as belonging to the table it was
--     rung at ("a bell rung at T7 is T7's business, merged or not"). Only the session link moves.
--   · lfh_place_order_public already hops (mig 306) and is untouched.
--   · lfh_request is untouched: the only way a diner reached it at a joined table was the
--     "this table isn't open" screen, which the first function above removes.
--   · With dining sessions OFF nothing here can change behaviour — there is no session to find, so
--     every branch below falls back to exactly what it did before.
--
-- Signatures are IDENTICAL to the live ones, so these are REPLACEMENTS, not new overloads: the
-- existing grants carry over and no anon permission is created or widened. Re-running is safe.

-- ── 1 · "is this table open?" ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_table_status(p_table text, p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_s sessions; v_count int;
BEGIN
  IF lfh_is_blocked(NULL, p_table, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  -- A JOINED TABLE IS OPEN — its party just lives on another table's session (mig 249).
  SELECT * INTO v_s FROM sessions
    WHERE table_number = lfh_merge_parent_table(v_rid, p_table) AND status = 'open' AND restaurant_id = v_rid LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', true, 'open', false, 'members', 0); END IF;
  SELECT count(*) INTO v_count FROM session_members WHERE session_id = v_s.id AND NOT removed;
  RETURN json_build_object('ok', true, 'open', true, 'members', v_count,
                           'session_id', v_s.id, 'last_activity_at', v_s.last_activity_at);
END; $function$;

-- ── 2 · "let me join this table" ─────────────────────────────────────────────────────────────
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

  -- JOIN THE PARTY, not the table number. A diner at a joined table belongs to the one party that
  -- covers both tables — that is the whole meaning of a merge, and it is how their order, their
  -- bill and their waiter call all behave already.
  SELECT * INTO v_session FROM sessions
    WHERE table_number = lfh_merge_parent_table(v_rid, p_table) AND status = 'open' AND restaurant_id = v_rid LIMIT 1;
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

-- ── 3 · the bell ─────────────────────────────────────────────────────────────────────────────
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
  v_sid uuid;
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
  -- WHICH PARTY IS THIS BELL FOR? The floor gathers calls BY SESSION whenever dining sessions are
  -- on, so a call with no session on it is invisible to every panel — the guest is told "we've told
  -- them" and nobody is. Stamp the party that covers this table (its own, or the one it is joined
  -- to). Stays NULL when there is no open party, which is exactly the sessions-off case the floor
  -- already shows unconditionally, so nothing changes there.
  SELECT s.id INTO v_sid FROM sessions s
    WHERE s.table_number = lfh_merge_parent_table(v_rid, v_t) AND s.status = 'open' AND s.restaurant_id = v_rid
    ORDER BY s.last_activity_at DESC LIMIT 1;
  -- table_number stays the table the guest is REALLY at: the waiter has to walk to that one, and
  -- every panel treats a call as belonging to the table it was rung at, merged or not.
  INSERT INTO waiter_calls(table_number, note, restaurant_id, session_id) VALUES (v_t, v_note, v_rid, v_sid);
  RETURN json_build_object('ok', true);
END; $function$;
