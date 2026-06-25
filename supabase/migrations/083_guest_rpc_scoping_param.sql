-- 083_guest_rpc_scoping_param.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Phase 1c (GUEST slice): scope the guest-facing RPCs that take a table number,
-- phone, or dish slug by restaurant. Those values are only unique WITHIN one
-- restaurant now (per-restaurant keys landed in 079), so a guest at restaurant
-- #2's "table 1" must never touch restaurant #1's "table 1".
--
-- Each function gains a TRAILING  p_restaurant_id uuid DEFAULT #1  argument and
-- ANDs restaurant_id into every table_number / phone / slug lookup, and STAMPS
-- restaurant_id on every INSERT (sessions / orders / order_items / requests /
-- waiter_calls / reviews / otp_codes …). Because the new arg DEFAULTS to
-- restaurant #1, every existing caller that omits it (and every INTERNAL
-- 2-arg call to the scoped helpers below) keeps behaving byte-for-byte as
-- today on the single live restaurant.
--
-- The LATEST live definition of each function is reproduced VERBATIM with ONLY
-- restaurant scoping added — SECURITY DEFINER, SET search_path = public, and
-- the return type all unchanged. Sources of the latest definitions:
--   lfh_is_blocked          → 015      lfh_recognize_customer → 015
--   lfh_open_session        → 015      lfh_request            → 015
--   lfh_send_otp            → 015      lfh_geo_ok             → 018
--   lfh_call_waiter_table   → 050      lfh_submit_review      → 030
--   lfh_place_order_public  → 029      lfh_table_status       → 076
--   lfh_join_session        → 077
--
-- GRANTS: adding a param changes the signature, so each function is DROPped at
-- its OLD exact signature and recreated. These are GUEST functions → the SAME
-- grantees as the originals are re-applied on the NEW signature (all were
-- granted to `anon`; lfh_call_waiter_table also to authenticated + service_role;
-- lfh_submit_review also to authenticated). We deliberately do NOT lock these to
-- service_role — that would lock guests out.
--
-- DEFENSIVE: every restaurant_id that could be NULL is COALESCEd to #1.
--
-- lfh_send_otp IS scoped here: it does a blocklist/customers lookup (via
-- lfh_is_blocked) and inserts an otp_codes row, both tenant data.
--
-- NOT scoped here (left for the later token/order-derived migration): the
-- token-based RPCs (lfh_place_order, lfh_call_waiter, lfh_session_state,
-- lfh_verify_otp, lfh_leave_feedback) — they derive the restaurant from the
-- session/order the token already points at, not from a raw table/phone.
-- ─────────────────────────────────────────────────────────────────────────

-- ── helper: is this phone or table blocked? (015) ──────────────────────────
-- Gains a trailing p_restaurant_id (DEFAULT #1) so the SAME 2-arg call from the
-- still-unscoped token RPCs (lfh_place_order, lfh_call_waiter, lfh_verify_otp…)
-- keeps resolving here against restaurant #1, while the scoped guest RPCs below
-- pass their own restaurant through. Both blocklist + customers reads are scoped.
DROP FUNCTION IF EXISTS lfh_is_blocked(text, text);
CREATE OR REPLACE FUNCTION lfh_is_blocked(
  p_phone text, p_table text,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocklist
    WHERE restaurant_id = COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid)
      AND ((p_phone IS NOT NULL AND phone = p_phone)
        OR (p_table IS NOT NULL AND table_number = p_table))
  ) OR EXISTS (
    SELECT 1 FROM customers
    WHERE restaurant_id = COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid)
      AND p_phone IS NOT NULL AND phone = p_phone AND blocked
  );
$$;

-- ── returning-customer recognition (015) ───────────────────────────────────
-- customers PK is (restaurant_id, phone) now (079), so scope the lookup to keep
-- it returning exactly this restaurant's row for the phone.
DROP FUNCTION IF EXISTS lfh_recognize_customer(text);
CREATE OR REPLACE FUNCTION lfh_recognize_customer(
  p_phone text,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT json_build_object('known', true, 'name', name, 'blocked', blocked)
       FROM customers
      WHERE phone = p_phone
        AND restaurant_id = COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid)),
    json_build_object('known', false));
$$;

-- ── open (or fetch the existing) OPEN session for a table (015) ────────────
-- Scope the open-session lookup + stamp the new session with restaurant_id.
DROP FUNCTION IF EXISTS lfh_open_session(text, text);
CREATE OR REPLACE FUNCTION lfh_open_session(
  p_table text, p_by text,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_id  uuid;
BEGIN
  IF lfh_is_blocked(NULL, p_table, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT id INTO v_id FROM sessions
    WHERE table_number = p_table AND status = 'open' AND restaurant_id = v_rid LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO sessions(table_number, status, opened_by, opened_at, restaurant_id)
      VALUES (p_table, 'open', COALESCE(p_by, 'guest'), NOW(), v_rid) RETURNING id INTO v_id;
  END IF;
  RETURN json_build_object('ok', true, 'session_id', v_id);
END; $$;

-- ── table pre-check / re-join id (076) ─────────────────────────────────────
-- Scope the open-session lookup so another restaurant's open "table N" can't be
-- reported as this restaurant's.
DROP FUNCTION IF EXISTS lfh_table_status(text);
CREATE OR REPLACE FUNCTION lfh_table_status(
  p_table text,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_s sessions; v_count int;
BEGIN
  IF lfh_is_blocked(NULL, p_table, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT * INTO v_s FROM sessions
    WHERE table_number = p_table AND status = 'open' AND restaurant_id = v_rid LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', true, 'open', false, 'members', 0); END IF;
  SELECT count(*) INTO v_count FROM session_members WHERE session_id = v_s.id AND NOT removed;
  RETURN json_build_object('ok', true, 'open', true, 'members', v_count,
                           'session_id', v_s.id, 'last_activity_at', v_s.last_activity_at);
END; $$;

-- ── server-side geofence (018) ─────────────────────────────────────────────
-- Reads THIS restaurant's settings row (079 made settings one-row-per-restaurant)
-- instead of the global id='site' row, so each restaurant's geofence is its own.
DROP FUNCTION IF EXISTS lfh_geo_ok(double precision, double precision);
CREATE OR REPLACE FUNCTION lfh_geo_ok(
  p_lat double precision, p_lng double precision,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s settings; d double precision; k double precision := pi() / 180;
BEGIN
  SELECT * INTO s FROM settings
    WHERE restaurant_id = COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  IF NOT COALESCE(s.require_location, true) THEN RETURN true; END IF;       -- owner turned location off
  IF s.geo_lat IS NULL OR s.geo_lng IS NULL THEN RETURN true; END IF;        -- café coords not set yet -> bypass
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN false; END IF;               -- required but no fix -> block
  d := 2 * 6371000 * asin(sqrt(
        power(sin((p_lat - s.geo_lat) * k / 2), 2) +
        cos(s.geo_lat * k) * cos(p_lat * k) * power(sin((p_lng - s.geo_lng) * k / 2), 2)));
  RETURN d <= COALESCE(s.geo_radius_m, 250);
END; $$;

-- ── join the open session for a table (077) ────────────────────────────────
-- Latest definition carries p_device (077). Now ALSO scoped: blocklist + geofence
-- + open-session lookup are for THIS restaurant, and the new session_members /
-- auto-opened session are stamped with restaurant_id. p_restaurant_id is the
-- trailing arg AFTER p_device, so the existing 5-arg anon call still works.
DROP FUNCTION IF EXISTS lfh_join_session(text, text, double precision, double precision, text);
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
  -- A banned device is refused here too, so it can't slip past the door-gate. (077)
  IF lfh_device_banned(p_device, NULL) THEN RETURN json_build_object('ok', false, 'reason', 'banned'); END IF;
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

-- ── queue a request (open / join / access) for the waiter (015) ────────────
-- Scope the blocklist check + the recent-duplicate scan + stamp the new request.
DROP FUNCTION IF EXISTS lfh_request(text, text, text, text);
CREATE OR REPLACE FUNCTION lfh_request(
  p_table text, p_type text, p_name text, p_phone text,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_id uuid; v_recent int;
BEGIN
  IF lfh_is_blocked(p_phone, p_table, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT count(*) INTO v_recent FROM requests
    WHERE table_number = p_table AND status = 'pending' AND created_at > NOW() - interval '3 minutes'
      AND restaurant_id = v_rid;
  IF v_recent > 0 THEN RETURN json_build_object('ok', true, 'already_pending', true); END IF;
  INSERT INTO requests(table_number, type, name, phone, restaurant_id)
    VALUES (p_table, p_type, p_name, p_phone, v_rid) RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'request_id', v_id);
END; $$;

-- ── OTP send (015) — dev stub that stores a code ───────────────────────────
-- Scoped: the blocklist check is for THIS restaurant, and the otp_codes row is
-- stamped with restaurant_id (otp_codes gained the column in 078).
DROP FUNCTION IF EXISTS lfh_send_otp(text);
CREATE OR REPLACE FUNCTION lfh_send_otp(
  p_phone text,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_code text;
BEGIN
  IF lfh_is_blocked(p_phone, NULL, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  INSERT INTO otp_codes(phone, code, expires_at, restaurant_id)
    VALUES (p_phone, v_code, NOW() + interval '10 minutes', v_rid);
  RETURN json_build_object('ok', true, 'dev_code', v_code);
END; $$;

-- ── place a NON-SESSION order (029) ────────────────────────────────────────
-- lfh_price_order is global by dish id and stays untouched here. Scoping: the
-- order row is stamped with restaurant_id (its order_items follow via the order).
DROP FUNCTION IF EXISTS lfh_place_order_public(text, jsonb, text[]);
CREATE OR REPLACE FUNCTION lfh_place_order_public(
  p_table text, p_items jsonb, p_allergies text[],
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_order uuid; v_priced jsonb;
BEGIN
  v_priced := lfh_price_order(p_items);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;
  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, restaurant_id)
    VALUES (NULLIF(p_table, ''), v_priced->'items',
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), 'received', v_rid)
    RETURNING id INTO v_order;
  RETURN json_build_object('ok', true, 'order_id', v_order);
END; $$;

-- ── call a waiter from a table (050) ───────────────────────────────────────
-- Scope the blocklist check, the throttle + cap scans, and stamp the call row.
DROP FUNCTION IF EXISTS lfh_call_waiter_table(text, text);
CREATE OR REPLACE FUNCTION lfh_call_waiter_table(
  p_table text, p_note text,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_t text := NULLIF(btrim(p_table), '');
BEGIN
  IF v_t IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'no_table'); END IF;
  -- A blocked table can't summon staff.
  IF lfh_is_blocked(NULL, v_t, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  -- Anti-spam throttle: ignore a repeat for the same table within 6 seconds.
  IF EXISTS (SELECT 1 FROM waiter_calls
              WHERE table_number = v_t AND NOT resolved
                AND created_at > now() - interval '6 seconds'
                AND restaurant_id = v_rid) THEN
    RETURN json_build_object('ok', true, 'reason', 'already_sent');
  END IF;
  -- Hard cap: never let more than 6 unresolved calls stack on one table.
  IF (SELECT count(*) FROM waiter_calls
        WHERE table_number = v_t AND NOT resolved AND restaurant_id = v_rid) >= 6 THEN
    RETURN json_build_object('ok', true, 'reason', 'capped');
  END IF;
  INSERT INTO waiter_calls(table_number, note, restaurant_id) VALUES (v_t, NULLIF(btrim(p_note), ''), v_rid);
  RETURN json_build_object('ok', true);
END; $$;

-- ── submit a dish review (030) ─────────────────────────────────────────────
-- Scoping: the slug must exist FOR THIS restaurant (menu_items slug is unique
-- per restaurant now, 079), the review row is stamped with restaurant_id, and
-- the upsert conflict target matches the new per-restaurant unique key
-- (restaurant_id, item_slug, device_id) from 079.
DROP FUNCTION IF EXISTS lfh_submit_review(text, text, int, text, text);
CREATE OR REPLACE FUNCTION lfh_submit_review(
  p_slug text, p_device text, p_stars int, p_name text, p_comment text,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
BEGIN
  -- Validate everything server-side; the client is never trusted.
  IF p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_stars');
  END IF;
  IF p_device IS NULL OR length(p_device) < 8 OR length(p_device) > 64 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_device');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM menu_items WHERE slug = p_slug AND restaurant_id = v_rid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_such_item');
  END IF;
  -- Upsert: a device re-rating a dish replaces its previous rating.
  INSERT INTO reviews(item_slug, device_id, name, stars, comment, restaurant_id)
  VALUES (
    p_slug, p_device,
    left(coalesce(nullif(trim(p_name), ''), 'Guest'), 40),
    p_stars,
    left(nullif(trim(p_comment), ''), 500),
    v_rid
  )
  ON CONFLICT (restaurant_id, item_slug, device_id)
  DO UPDATE SET stars = EXCLUDED.stars, name = EXCLUDED.name,
                comment = EXCLUDED.comment, created_at = now();
  RETURN jsonb_build_object('ok', true);
END $$;

-- ── GRANTS: re-apply the ORIGINAL grantees on each NEW signature ────────────
-- New functions are PUBLIC-executable by default; these are GUEST RPCs, so we
-- (re)grant to the same roles the originals had. NOT service_role-only.

-- lfh_is_blocked: 015 added no explicit grant (it relied on the default
-- EXECUTE-to-anon/authenticated privilege and is a read-only boolean helper).
-- Preserve that reachability on the new signature.
GRANT EXECUTE ON FUNCTION lfh_is_blocked(text, text, uuid)                                 TO anon, authenticated;
-- lfh_recognize_customer: anon (015)
GRANT EXECUTE ON FUNCTION lfh_recognize_customer(text, uuid)                               TO anon;
-- lfh_open_session: anon (015)
GRANT EXECUTE ON FUNCTION lfh_open_session(text, text, uuid)                               TO anon;
-- lfh_table_status: anon (076)
GRANT EXECUTE ON FUNCTION lfh_table_status(text, uuid)                                     TO anon;
-- lfh_geo_ok: anon (018)
GRANT EXECUTE ON FUNCTION lfh_geo_ok(double precision, double precision, uuid)             TO anon;
-- lfh_join_session: anon (077)
GRANT EXECUTE ON FUNCTION lfh_join_session(text, text, double precision, double precision, text, uuid) TO anon;
-- lfh_request: anon (015)
GRANT EXECUTE ON FUNCTION lfh_request(text, text, text, text, uuid)                        TO anon;
-- lfh_send_otp: anon (015)
GRANT EXECUTE ON FUNCTION lfh_send_otp(text, uuid)                                         TO anon;
-- lfh_place_order_public: anon (029)
GRANT EXECUTE ON FUNCTION lfh_place_order_public(text, jsonb, text[], uuid)                TO anon;
-- lfh_call_waiter_table: anon, authenticated, service_role (050)
GRANT EXECUTE ON FUNCTION lfh_call_waiter_table(text, text, uuid)                          TO anon, authenticated, service_role;
-- lfh_submit_review: anon, authenticated (030)
GRANT EXECUTE ON FUNCTION lfh_submit_review(text, text, int, text, text, uuid)             TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
