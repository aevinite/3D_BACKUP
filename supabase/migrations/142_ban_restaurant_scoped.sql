-- 142 — device/phone bans are PER RESTAURANT, not platform-wide. (renumbered from 139)
--
-- Audit 2026-07-06: lfh_check_ban / lfh_device_banned scanned `blocklist` with NO
-- restaurant filter, so a device banned by restaurant A was blocked at EVERY
-- restaurant on the platform (the load-time BanGate wall AND the join gate). In a
-- multi-tenant SaaS one café must not be able to blacklist a guest from all the
-- others.
--
-- Fix: both helpers take an optional p_restaurant_id. When given, a ban matches
-- only rows for THAT restaurant — PLUS any legacy rows with a NULL restaurant_id
-- (older / tablet-created bans that never stamped a restaurant), which stay global
-- so this change can never accidentally UN-ban anyone. When p_restaurant_id is
-- NULL (any old 2-arg caller) the behaviour is exactly as before (global), so
-- nothing breaks. The editor ban path already stamps restaurant_id, so real bans
-- become correctly scoped.

-- Old 2-arg versions are replaced by 3-arg (uuid DEFAULT NULL) forms. Dropping is
-- safe: the only live caller (lfh_join_session, recreated below) is updated to
-- pass the restaurant, and no other function references these.
DROP FUNCTION IF EXISTS lfh_device_banned(text, text);
CREATE OR REPLACE FUNCTION lfh_device_banned(p_device text, p_phone text, p_restaurant_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocklist
    WHERE ((p_device IS NOT NULL AND p_device <> '' AND device_id = p_device)
        OR (p_phone  IS NOT NULL AND p_phone  <> '' AND phone     = p_phone))
      AND (p_restaurant_id IS NULL OR restaurant_id = p_restaurant_id OR restaurant_id IS NULL)
  );
$$;

DROP FUNCTION IF EXISTS lfh_check_ban(text, text);
CREATE OR REPLACE FUNCTION lfh_check_ban(p_device text, p_phone text, p_restaurant_id uuid DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row blocklist;
BEGIN
  SELECT * INTO v_row FROM blocklist
    WHERE ((p_device IS NOT NULL AND p_device <> '' AND device_id = p_device)
        OR (p_phone  IS NOT NULL AND p_phone  <> '' AND phone     = p_phone))
      AND (p_restaurant_id IS NULL OR restaurant_id = p_restaurant_id OR restaurant_id IS NULL)
    ORDER BY blocked_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('banned', false); END IF;
  RETURN json_build_object('banned', true, 'reason', v_row.reason,
                           'unban_requested', v_row.unban_requested_at IS NOT NULL);
END; $$;

-- Grants must be re-applied (the DROP created brand-new function objects).
REVOKE ALL ON FUNCTION lfh_device_banned(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_device_banned(text, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION lfh_check_ban(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lfh_check_ban(text, text, uuid) TO anon;

-- Recreate lfh_join_session (latest = mig 083) with ONE change: the device-ban
-- check now passes v_rid, so a guest banned at another restaurant can still join
-- a session here. Everything else is identical to 083.
CREATE OR REPLACE FUNCTION lfh_join_session(
  p_table text, p_name text, p_lat double precision, p_lng double precision, p_device text DEFAULT NULL,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_session sessions; v_token text; v_role text; v_approved boolean; v_count int; v_member uuid;
BEGIN
  IF lfh_is_blocked(NULL, p_table, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  -- A device banned AT THIS RESTAURANT is refused here too (scoped — mig 139).
  IF lfh_device_banned(p_device, NULL, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'banned'); END IF;
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
END; $$;
