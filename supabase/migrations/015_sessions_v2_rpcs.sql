-- v2 RPCs (SECURITY DEFINER). Guests use the ANON key but can ONLY act through
-- these functions. Each runs as the table owner (bypasses RLS) and enforces the
-- rules itself: blocklist, token validity, open-session state, OTP, etc.
-- search_path is pinned to public for safety. Editor actions (open from floor
-- map, set item status, attend, close, block) use the service role directly.

-- ── helper: is this phone or table blocked? ────────────────────────────────
CREATE OR REPLACE FUNCTION lfh_is_blocked(p_phone text, p_table text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocklist
    WHERE (p_phone IS NOT NULL AND phone = p_phone)
       OR (p_table IS NOT NULL AND table_number = p_table)
  ) OR EXISTS (
    SELECT 1 FROM customers WHERE p_phone IS NOT NULL AND phone = p_phone AND blocked
  );
$$;

-- ── returning-customer recognition ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION lfh_recognize_customer(p_phone text)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT json_build_object('known', true, 'name', name, 'blocked', blocked)
       FROM customers WHERE phone = p_phone),
    json_build_object('known', false));
$$;

-- ── open (or fetch the existing) OPEN session for a table ──────────────────
CREATE OR REPLACE FUNCTION lfh_open_session(p_table text, p_by text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF lfh_is_blocked(NULL, p_table) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT id INTO v_id FROM sessions WHERE table_number = p_table AND status = 'open' LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO sessions(table_number, status, opened_by, opened_at)
      VALUES (p_table, 'open', COALESCE(p_by, 'guest'), NOW()) RETURNING id INTO v_id;
  END IF;
  RETURN json_build_object('ok', true, 'session_id', v_id);
END; $$;

-- ── join the open session for a table (creates a member + access token) ────
CREATE OR REPLACE FUNCTION lfh_join_session(p_table text, p_name text, p_location_ok boolean)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_session sessions; v_token text; v_role text; v_approved boolean; v_count int; v_member uuid;
BEGIN
  IF lfh_is_blocked(NULL, p_table) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT * INTO v_session FROM sessions WHERE table_number = p_table AND status = 'open' LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_open_session'); END IF;
  SELECT count(*) INTO v_count FROM session_members WHERE session_id = v_session.id AND NOT removed;
  v_token := replace(gen_random_uuid()::text, '-', '');
  IF v_count = 0 THEN
    v_role := 'owner'; v_approved := true;             -- first member owns the session
  ELSE
    v_role := 'guest'; v_approved := v_session.auto_approve;
  END IF;
  INSERT INTO session_members(session_id, name, token, role, approved, location_ok)
    VALUES (v_session.id, p_name, v_token, v_role, v_approved, COALESCE(p_location_ok, false))
    RETURNING id INTO v_member;
  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_session.id;
  RETURN json_build_object('ok', true, 'token', v_token, 'member_id', v_member,
    'session_id', v_session.id, 'role', v_role, 'approved', v_approved);
END; $$;

-- ── the guest poll: full live state for a member's token ───────────────────
CREATE OR REPLACE FUNCTION lfh_session_state(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_s sessions;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id;
  RETURN json_build_object(
    'ok', true,
    'session', json_build_object('id', v_s.id, 'table_number', v_s.table_number, 'status', v_s.status, 'auto_approve', v_s.auto_approve),
    'member',  json_build_object('id', v_m.id, 'role', v_m.role, 'approved', v_m.approved, 'phone_verified', v_m.phone_verified, 'name', v_m.name),
    'members', COALESCE((SELECT json_agg(json_build_object('id', id, 'name', name, 'role', role, 'approved', approved, 'phone_verified', phone_verified) ORDER BY joined_at)
                          FROM session_members WHERE session_id = v_s.id AND NOT removed), '[]'::json),
    'pending', COALESCE((SELECT json_agg(json_build_object('id', id, 'name', name) ORDER BY joined_at)
                          FROM session_members WHERE session_id = v_s.id AND NOT approved AND NOT removed), '[]'::json),
    'items',   COALESCE((SELECT json_agg(json_build_object('id', id, 'title', title, 'qty', qty, 'status', status) ORDER BY created_at)
                          FROM order_items WHERE session_id = v_s.id), '[]'::json),
    'calls',   COALESCE((SELECT json_agg(json_build_object('id', id, 'status', CASE WHEN resolved THEN 'attended' ELSE 'open' END) ORDER BY created_at DESC)
                          FROM waiter_calls WHERE session_id = v_s.id AND NOT resolved), '[]'::json));
END; $$;

-- ── queue a request (open / join / access) for the waiter ──────────────────
CREATE OR REPLACE FUNCTION lfh_request(p_table text, p_type text, p_name text, p_phone text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_recent int;
BEGIN
  IF lfh_is_blocked(p_phone, p_table) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT count(*) INTO v_recent FROM requests
    WHERE table_number = p_table AND status = 'pending' AND created_at > NOW() - interval '3 minutes';
  IF v_recent > 0 THEN RETURN json_build_object('ok', true, 'already_pending', true); END IF;
  INSERT INTO requests(table_number, type, name, phone) VALUES (p_table, p_type, p_name, p_phone) RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'request_id', v_id);
END; $$;

-- ── owner actions (authorized by the owner's token) ────────────────────────
CREATE OR REPLACE FUNCTION lfh_approve_member(p_owner_token text, p_member_id uuid, p_name text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner session_members;
BEGIN
  SELECT * INTO v_owner FROM session_members WHERE token = p_owner_token AND role = 'owner' AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'not_owner'); END IF;
  UPDATE session_members SET approved = true, name = COALESCE(p_name, name)
    WHERE id = p_member_id AND session_id = v_owner.session_id;
  RETURN json_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION lfh_remove_member(p_owner_token text, p_member_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner session_members;
BEGIN
  SELECT * INTO v_owner FROM session_members WHERE token = p_owner_token AND role = 'owner' AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'not_owner'); END IF;
  UPDATE session_members SET removed = true
    WHERE id = p_member_id AND session_id = v_owner.session_id AND role <> 'owner';
  RETURN json_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION lfh_set_auto_approve(p_owner_token text, p_value boolean)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner session_members;
BEGIN
  SELECT * INTO v_owner FROM session_members WHERE token = p_owner_token AND role = 'owner' AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'not_owner'); END IF;
  UPDATE sessions SET auto_approve = COALESCE(p_value, true) WHERE id = v_owner.session_id;
  RETURN json_build_object('ok', true);
END; $$;

-- ── OTP. STUB: real WhatsApp/SMS send is external; until it's wired, send_otp
--    stores the code and dev-returns it so the flow is testable. When a real
--    provider is connected, stop returning dev_code (send it instead). ──────
CREATE OR REPLACE FUNCTION lfh_send_otp(p_phone text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text;
BEGIN
  IF lfh_is_blocked(p_phone, NULL) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  INSERT INTO otp_codes(phone, code, expires_at) VALUES (p_phone, v_code, NOW() + interval '10 minutes');
  RETURN json_build_object('ok', true, 'dev_code', v_code);
END; $$;

CREATE OR REPLACE FUNCTION lfh_verify_otp(p_token text, p_phone text, p_code text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row otp_codes; v_m session_members;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  IF lfh_is_blocked(p_phone, NULL) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT * INTO v_row FROM otp_codes
    WHERE phone = p_phone AND NOT consumed AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'expired'); END IF;
  IF v_row.code <> p_code THEN
    UPDATE otp_codes SET attempts = attempts + 1 WHERE id = v_row.id;
    RETURN json_build_object('ok', false, 'reason', 'wrong_code');
  END IF;
  UPDATE otp_codes SET consumed = true WHERE id = v_row.id;
  UPDATE session_members SET phone = p_phone, phone_verified = true WHERE id = v_m.id;
  INSERT INTO customers(phone, name, last_seen_at) VALUES (p_phone, v_m.name, NOW())
    ON CONFLICT (phone) DO UPDATE SET last_seen_at = NOW(), name = COALESCE(customers.name, EXCLUDED.name);
  RETURN json_build_object('ok', true);
END; $$;

-- ── place an order: verifies member + session + (optional) OTP, writes the
--    order AND its per-item rows (status 'received'). ───────────────────────
CREATE OR REPLACE FUNCTION lfh_place_order(p_token text, p_items jsonb, p_subtotal numeric, p_tax numeric, p_total numeric, p_allergies text[])
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_s sessions; v_order uuid; v_item jsonb; v_req_otp boolean;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF NOT v_m.approved THEN RETURN json_build_object('ok', false, 'reason', 'not_approved'); END IF;
  IF lfh_is_blocked(v_m.phone, v_s.table_number) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT require_otp INTO v_req_otp FROM settings WHERE id = 'site';
  IF COALESCE(v_req_otp, true) AND NOT v_m.phone_verified THEN
    RETURN json_build_object('ok', false, 'reason', 'otp_required');
  END IF;
  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id)
    VALUES (v_s.table_number, p_items, COALESCE(p_subtotal, 0), COALESCE(p_tax, 0), COALESCE(p_total, 0), COALESCE(p_allergies, '{}'), 'received', v_s.id)
    RETURNING id INTO v_order;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note)
      VALUES (v_order, v_s.id,
        COALESCE(v_item->>'title', ''),
        COALESCE((v_item->>'qty')::int, 1),
        COALESCE((v_item->>'price')::numeric, 0),
        v_item->'options',
        COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(v_item->'removed') x), '{}'),
        v_item->>'note');
  END LOOP;
  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'order_id', v_order);
END; $$;

-- ── call a waiter (one active call per session) ────────────────────────────
CREATE OR REPLACE FUNCTION lfh_call_waiter(p_token text, p_reason text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_s sessions; v_active int;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id;
  IF lfh_is_blocked(v_m.phone, v_s.table_number) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT count(*) INTO v_active FROM waiter_calls WHERE session_id = v_s.id AND NOT resolved;
  IF v_active > 0 THEN RETURN json_build_object('ok', true, 'already_active', true); END IF;
  INSERT INTO waiter_calls(table_number, note, session_id, member_id)
    VALUES (v_s.table_number, p_reason, v_s.id, v_m.id);
  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  RETURN json_build_object('ok', true);
END; $$;

-- ── expose to the anon (public) API ────────────────────────────────────────
GRANT EXECUTE ON FUNCTION lfh_recognize_customer(text)                 TO anon;
GRANT EXECUTE ON FUNCTION lfh_open_session(text, text)                 TO anon;
GRANT EXECUTE ON FUNCTION lfh_join_session(text, text, boolean)        TO anon;
GRANT EXECUTE ON FUNCTION lfh_session_state(text)                      TO anon;
GRANT EXECUTE ON FUNCTION lfh_request(text, text, text, text)          TO anon;
GRANT EXECUTE ON FUNCTION lfh_approve_member(text, uuid, text)         TO anon;
GRANT EXECUTE ON FUNCTION lfh_remove_member(text, uuid)               TO anon;
GRANT EXECUTE ON FUNCTION lfh_set_auto_approve(text, boolean)          TO anon;
GRANT EXECUTE ON FUNCTION lfh_send_otp(text)                           TO anon;
GRANT EXECUTE ON FUNCTION lfh_verify_otp(text, text, text)             TO anon;
GRANT EXECUTE ON FUNCTION lfh_place_order(text, jsonb, numeric, numeric, numeric, text[]) TO anon;
GRANT EXECUTE ON FUNCTION lfh_call_waiter(text, text)                  TO anon;

NOTIFY pgrst, 'reload schema';
