-- 077_guest_ban_system.sql
-- Full guest BAN (owner, 2026-06-22). Today a "ban" only adds a phone/member row to
-- blocklist and lfh_is_blocked() is checked inside join/order/call — but an anonymous
-- menu browser has no phone and no device id, so a banned guest could just re-open the
-- menu. This adds DEVICE-level banning so a banned guest is stopped at the door with a
-- full "You're banned" screen, plus an unban-request-by-phone flow surfaced to staff.
--
-- Design = "device now + phone for unban":
--   • The guest app generates a stable device id (localStorage) and sends it on join +
--     on the load-time ban check. Banning a member now also records that member's device.
--   • lfh_check_ban(device, phone) — anon, the guest app calls it on load; if banned it
--     shows ONLY the ban screen.
--   • lfh_request_unban(device, phone) — anon; the banned guest submits a mobile number,
--     which lands on the blocklist row so the manager's ban panel can show it + Unban.

-- 1. capture the guest's device on their membership, so a staff "ban" can target it.
ALTER TABLE session_members ADD COLUMN IF NOT EXISTS device_id text;

-- 2. unban-request fields on the blocklist row (the phone the banned guest gives + when).
ALTER TABLE blocklist
  ADD COLUMN IF NOT EXISTS unban_phone text,
  ADD COLUMN IF NOT EXISTS unban_requested_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_blocklist_device ON blocklist(device_id);

-- 3. is this device/phone banned? (the small helper the door-gate + join use)
CREATE OR REPLACE FUNCTION lfh_device_banned(p_device text, p_phone text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocklist
    WHERE (p_device IS NOT NULL AND p_device <> '' AND device_id = p_device)
       OR (p_phone  IS NOT NULL AND p_phone  <> '' AND phone     = p_phone)
  );
$$;

-- 4. guest load-time check — returns whether THIS device/phone is banned + the reason.
CREATE OR REPLACE FUNCTION lfh_check_ban(p_device text, p_phone text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row blocklist;
BEGIN
  SELECT * INTO v_row FROM blocklist
    WHERE (p_device IS NOT NULL AND p_device <> '' AND device_id = p_device)
       OR (p_phone  IS NOT NULL AND p_phone  <> '' AND phone     = p_phone)
    ORDER BY blocked_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('banned', false); END IF;
  RETURN json_build_object('banned', true, 'reason', v_row.reason,
                           'unban_requested', v_row.unban_requested_at IS NOT NULL);
END; $$;

-- 5. banned guest asks to be unbanned by leaving a mobile number → stamp it on their
--    blocklist row(s) so staff see who's asking. Best-effort; never reveals ban details.
CREATE OR REPLACE FUNCTION lfh_request_unban(p_device text, p_phone text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  IF p_phone IS NULL OR length(btrim(p_phone)) < 5 THEN
    RETURN json_build_object('ok', false, 'reason', 'phone_required');
  END IF;
  UPDATE blocklist SET unban_phone = btrim(p_phone), unban_requested_at = NOW()
    WHERE (p_device IS NOT NULL AND p_device <> '' AND device_id = p_device)
       OR (p_phone  IS NOT NULL AND phone = btrim(p_phone));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- If the device row carried no device_id match (e.g. banned by phone only and the
  -- guest is on a fresh device), still record the request against the phone they gave.
  IF v_n = 0 THEN
    UPDATE blocklist SET unban_phone = btrim(p_phone), unban_requested_at = NOW()
      WHERE unban_phone = btrim(p_phone);
  END IF;
  RETURN json_build_object('ok', true);
END; $$;

-- 6. join: accept + store the device id, and refuse a banned DEVICE (not just phone/
--    table). Replaces the 4-arg version (dropped first to avoid an overload clash).
DROP FUNCTION IF EXISTS lfh_join_session(text, text, double precision, double precision);
CREATE OR REPLACE FUNCTION lfh_join_session(p_table text, p_name text, p_lat double precision, p_lng double precision, p_device text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_session sessions; v_token text; v_role text; v_approved boolean; v_count int; v_member uuid;
BEGIN
  IF lfh_is_blocked(NULL, p_table) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  -- A banned device is refused here too, so it can't slip past the door-gate. (077)
  IF lfh_device_banned(p_device, NULL) THEN RETURN json_build_object('ok', false, 'reason', 'banned'); END IF;
  IF NOT lfh_geo_ok(p_lat, p_lng) THEN RETURN json_build_object('ok', false, 'reason', 'too_far'); END IF;

  SELECT * INTO v_session FROM sessions WHERE table_number = p_table AND status = 'open' LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_open_session'); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_session.id::text, 0));

  SELECT count(*) INTO v_count FROM session_members WHERE session_id = v_session.id AND NOT removed;
  v_token := replace(gen_random_uuid()::text, '-', '');
  IF v_count = 0 THEN
    v_role := 'owner'; v_approved := true;
  ELSE
    v_role := 'guest'; v_approved := v_session.auto_approve;
  END IF;

  INSERT INTO session_members(session_id, name, token, role, approved, location_ok, device_id)
    VALUES (v_session.id, p_name, v_token, v_role, v_approved, true, p_device)
    RETURNING id INTO v_member;
  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_session.id;

  RETURN json_build_object('ok', true, 'token', v_token, 'member_id', v_member,
    'session_id', v_session.id, 'role', v_role, 'approved', v_approved);
END; $$;

-- grants: the three guest-facing RPCs are anon; the helper is internal only.
REVOKE ALL ON FUNCTION lfh_device_banned(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_device_banned(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION lfh_check_ban(text, text) TO anon;
GRANT EXECUTE ON FUNCTION lfh_request_unban(text, text) TO anon;
GRANT EXECUTE ON FUNCTION lfh_join_session(text, text, double precision, double precision, text) TO anon;

NOTIFY pgrst, 'reload schema';
