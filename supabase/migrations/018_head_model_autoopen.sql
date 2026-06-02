-- v2 "Head" model — the FLIP.
--
-- Old model: a waiter opened the table from the floor map, and only THEN could
-- the first guest join-and-become-owner. New model: the FIRST person who scans a
-- table + passes the location check auto-opens it and becomes the HEAD (owner)
-- with NO name and NO verification. Everyone else who scans the same table is a
-- guest who must be approved by the head before they can act.
--
-- This migration:
--   1. lfh_geo_ok        — server-side geofence (haversine vs. settings.geo_*).
--   2. lfh_table_status  — pre-check so the UI knows head-vs-guest before asking.
--   3. lfh_join_session  — auto-opens + makes the first member the head; the
--                          location check is now enforced HERE, not just client-side.
--   4. require_otp -> off — ordering verification is the future EMAIL seam; phone
--                          OTP is shelved, email isn't built yet, so leave it off
--                          (default was ON, which would block every order).
--
-- call_waiter (017) and place_order (015) already require open + approved, so the
-- "act only when open & let in" rule stays enforced there.

-- ── 1. server-side geofence ────────────────────────────────────────────────
-- Returns true when the guest is within geo_radius_m of the café. SOFT until the
-- owner sets café coords in the editor: if geo_lat/geo_lng are unset, or location
-- is not required, everyone passes (so the flow stays usable / testable).
CREATE OR REPLACE FUNCTION lfh_geo_ok(p_lat double precision, p_lng double precision)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s settings; d double precision; k double precision := pi() / 180;
BEGIN
  SELECT * INTO s FROM settings WHERE id = 'site';
  IF NOT COALESCE(s.require_location, true) THEN RETURN true; END IF;       -- owner turned location off
  IF s.geo_lat IS NULL OR s.geo_lng IS NULL THEN RETURN true; END IF;        -- café coords not set yet -> bypass
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN false; END IF;               -- required but no fix -> block
  d := 2 * 6371000 * asin(sqrt(
        power(sin((p_lat - s.geo_lat) * k / 2), 2) +
        cos(s.geo_lat * k) * cos(p_lat * k) * power(sin((p_lng - s.geo_lng) * k / 2), 2)));
  RETURN d <= COALESCE(s.geo_radius_m, 250);
END; $$;

-- ── 2. table pre-check (no token needed) ───────────────────────────────────
-- The guest UI calls this BEFORE asking for anything, so it can decide:
--   open=false -> you'll be the HEAD (join silently, no name)
--   open=true  -> someone already holds this table -> ask their name -> request to join
CREATE OR REPLACE FUNCTION lfh_table_status(p_table text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s sessions; v_count int;
BEGIN
  IF lfh_is_blocked(NULL, p_table) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT * INTO v_s FROM sessions WHERE table_number = p_table AND status = 'open' LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', true, 'open', false, 'members', 0); END IF;
  SELECT count(*) INTO v_count FROM session_members WHERE session_id = v_s.id AND NOT removed;
  RETURN json_build_object('ok', true, 'open', true, 'members', v_count,
                           'last_activity_at', v_s.last_activity_at);
END; $$;

-- ── 3. join — now AUTO-OPENS and enforces location ─────────────────────────
-- Signature changed: (table, name, location_ok boolean) -> (table, name, lat, lng).
-- We send the real coords so the server can verify the geofence itself; the head
-- (first member) gets no name + owner + approved.
DROP FUNCTION IF EXISTS lfh_join_session(text, text, boolean);

CREATE OR REPLACE FUNCTION lfh_join_session(p_table text, p_name text, p_lat double precision, p_lng double precision)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_session sessions; v_token text; v_role text; v_approved boolean; v_count int; v_member uuid;
BEGIN
  IF lfh_is_blocked(NULL, p_table) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  IF NOT lfh_geo_ok(p_lat, p_lng) THEN RETURN json_build_object('ok', false, 'reason', 'too_far'); END IF;

  SELECT * INTO v_session FROM sessions WHERE table_number = p_table AND status = 'open' LIMIT 1;
  IF NOT FOUND THEN
    -- AUTO-OPEN: the first scanner opens the table and owns it. auto_approve is
    -- FALSE so the head must let in every later joiner (they can flip it on).
    INSERT INTO sessions(table_number, status, auto_approve, opened_by, opened_at)
      VALUES (p_table, 'open', false, 'guest', NOW()) RETURNING * INTO v_session;
  END IF;

  SELECT count(*) INTO v_count FROM session_members WHERE session_id = v_session.id AND NOT removed;
  v_token := replace(gen_random_uuid()::text, '-', '');
  IF v_count = 0 THEN
    v_role := 'owner'; v_approved := true;            -- HEAD: no name, no verification
  ELSE
    v_role := 'guest'; v_approved := v_session.auto_approve;
  END IF;

  INSERT INTO session_members(session_id, name, token, role, approved, location_ok)
    VALUES (v_session.id, p_name, v_token, v_role, v_approved, true)
    RETURNING id INTO v_member;
  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_session.id;

  RETURN json_build_object('ok', true, 'token', v_token, 'member_id', v_member,
    'session_id', v_session.id, 'role', v_role, 'approved', v_approved);
END; $$;

-- ── 4. ordering verification OFF for now (email comes later) ───────────────
-- Phone OTP is shelved (not free); email verification isn't built. Leaving
-- require_otp ON would make lfh_place_order reject every order with 'otp_required'.
UPDATE settings SET require_otp = false WHERE id = 'site';

-- New sessions require the head to approve each joiner (no silent auto-approve).
ALTER TABLE sessions ALTER COLUMN auto_approve SET DEFAULT false;

-- ── grants ─────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION lfh_geo_ok(double precision, double precision)              TO anon;
GRANT EXECUTE ON FUNCTION lfh_table_status(text)                                      TO anon;
GRANT EXECUTE ON FUNCTION lfh_join_session(text, text, double precision, double precision) TO anon;

NOTIFY pgrst, 'reload schema';
