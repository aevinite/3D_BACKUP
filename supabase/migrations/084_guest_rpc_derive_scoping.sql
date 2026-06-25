-- 084_guest_rpc_derive_scoping.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Phase 1c (GUEST slice, part 2): scope the guest-facing RPCs that identify
-- their context through a globally-unique TOKEN / ORDER_ID / SESSION_ID rather
-- than a raw table_number / phone / slug. These were deliberately LEFT OUT of
-- 083 (see its closing note) because their restaurant is NOT a caller input —
-- it must be DERIVED from the row the token / order_id already resolves to.
--
-- So, unlike 083, this migration adds NO parameter and changes NO signature:
-- each function is recreated with plain `CREATE OR REPLACE`, which PRESERVES the
-- existing grants (these are anon-granted GUEST functions and must stay reachable
-- by guests — we do NOT revoke or re-grant). The ONLY change inside each body is
-- to derive `restaurant_id` from the session / order it resolves to and STAMP it
-- on every tenant-row INSERT (and scope every SECONDARY lookup that keys off
-- table_number / phone — those are per-restaurant since 079).
--
-- THE KEY BUG THIS FIXES: lfh_place_order INSERTed orders / order_items WITHOUT a
-- restaurant_id, so they fell back to the column DEFAULT (#1) — meaning a guest
-- ordering inside a SECOND restaurant's session would silently write the order to
-- restaurant #1. From here the order is stamped with the SESSION's restaurant.
--
-- Each function below is the LATEST live definition reproduced VERBATIM with ONLY
-- restaurant scoping added — SECURITY DEFINER, SET search_path = public, and the
-- return type all unchanged. Sources of the latest definitions:
--   lfh_place_order(token,jsonb,text[]) → 029   lfh_call_waiter        → 025
--   lfh_verify_otp(token,phone,code)    → 015   lfh_leave_feedback     → 037
--   set_order_table_number              → 051
--
-- DEFENSIVE: every derived restaurant_id is COALESCEd to #1, so on the single
-- live restaurant the behaviour is byte-for-byte identical to today.
--
-- REVIEWED AND LEFT OUT (no tenant-row INSERT and no table/phone/slug secondary
-- lookup — a single-row read/update by a globally-unique token/id needs no
-- scoping): lfh_session_state (076), lfh_get_cart / lfh_set_cart (019),
-- lfh_approve_member / lfh_remove_member / lfh_set_auto_approve (015),
-- lfh_set_member_name (048), lfh_leave_session (026), get_order_status (036).
-- lfh_leave_session updates requests by table_number, but only for the leaver's
-- OWN session's table (already isolated by session_id), so no cross-restaurant
-- bleed is possible — left untouched.
-- ─────────────────────────────────────────────────────────────────────────

-- ── place a SESSION order (029) — derive restaurant from the session ────────
-- Reproduced verbatim from 029 (server-priced via lfh_price_order, which is
-- global by dish id and untouched). ADDED: v_rid is read from the session the
-- token resolves to, and stamped on the orders row AND every order_items row.
CREATE OR REPLACE FUNCTION lfh_place_order(p_token text, p_items jsonb, p_allergies text[])
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_s sessions; v_order uuid; v_item jsonb; v_req_otp boolean; v_priced jsonb;
        v_rid uuid;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF NOT v_m.approved THEN RETURN json_build_object('ok', false, 'reason', 'not_approved'); END IF;
  -- DERIVE the restaurant from the session this token belongs to (NOT the #1 default).
  v_rid := COALESCE(v_s.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  IF lfh_is_blocked(v_m.phone, v_s.table_number, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT require_otp INTO v_req_otp FROM settings WHERE id = 'site';
  IF COALESCE(v_req_otp, true) AND NOT v_m.phone_verified THEN
    RETURN json_build_object('ok', false, 'reason', 'otp_required');
  END IF;

  -- SERVER prices the order. If a line is unknown/sold-out, bail with that reason.
  v_priced := lfh_price_order(p_items);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id, member_id, restaurant_id)
    VALUES (v_s.table_number, v_priced->'items',
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), 'received', v_s.id, v_m.id, v_rid)
    RETURNING id INTO v_order;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_priced->'items') LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note, restaurant_id)
      VALUES (v_order, v_s.id,
        COALESCE(v_item->>'title', ''),
        COALESCE((v_item->>'qty')::int, 1),
        COALESCE((v_item->>'price')::numeric, 0),
        v_item->'options',
        CASE WHEN jsonb_typeof(v_item->'removed') = 'array'
             THEN COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(v_item->'removed') x), '{}')
             ELSE '{}' END,
        v_item->>'note', v_rid);
  END LOOP;

  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'order_id', v_order);
END; $$;

-- ── call a waiter (025) — derive restaurant from the session ────────────────
-- Reproduced verbatim from 025 (multiple distinct calls per session, same-reason
-- de-dupe). ADDED: v_rid from the session, scoped into the blocklist check, and
-- stamped on the waiter_calls row.
CREATE OR REPLACE FUNCTION lfh_call_waiter(p_token text, p_reason text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_s sessions; v_dup int; v_rid uuid;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF NOT v_m.approved THEN RETURN json_build_object('ok', false, 'reason', 'not_approved'); END IF;
  -- DERIVE the restaurant from the session this token belongs to.
  v_rid := COALESCE(v_s.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  IF lfh_is_blocked(v_m.phone, v_s.table_number, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  -- De-dupe only the SAME request: if this exact reason is already pending for the
  -- session, don't add a second identical one. Different reasons are allowed to stack.
  SELECT count(*) INTO v_dup FROM waiter_calls
    WHERE session_id = v_s.id AND NOT resolved AND note IS NOT DISTINCT FROM p_reason;
  IF v_dup > 0 THEN RETURN json_build_object('ok', true, 'already_active', true); END IF;
  INSERT INTO waiter_calls(table_number, note, session_id, member_id, restaurant_id)
    VALUES (v_s.table_number, p_reason, v_s.id, v_m.id, v_rid);
  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  RETURN json_build_object('ok', true);
END; $$;

-- ── verify OTP (015) — derive restaurant from the session ───────────────────
-- Reproduced verbatim from 015 (the TOKEN-based 3-arg verify_otp over otp_codes;
-- NOT the backend-only 2-arg verify_otp(contact,code) over verification_codes).
-- ADDED: v_rid from the session, scoped into the blocklist check AND the otp_codes
-- lookup (codes are per-restaurant since 078). The customers upsert is stamped with
-- restaurant_id and its conflict target is updated to the per-restaurant PK
-- (restaurant_id, phone) that 079 introduced — the old ON CONFLICT (phone) no
-- longer matches a constraint, so this also REPAIRS the upsert.
CREATE OR REPLACE FUNCTION lfh_verify_otp(p_token text, p_phone text, p_code text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row otp_codes; v_m session_members; v_s sessions; v_rid uuid;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id;
  -- DERIVE the restaurant from the session this token belongs to.
  v_rid := COALESCE(v_s.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  IF lfh_is_blocked(p_phone, NULL, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT * INTO v_row FROM otp_codes
    WHERE phone = p_phone AND NOT consumed AND expires_at > NOW() AND restaurant_id = v_rid
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'expired'); END IF;
  IF v_row.code <> p_code THEN
    UPDATE otp_codes SET attempts = attempts + 1 WHERE id = v_row.id;
    RETURN json_build_object('ok', false, 'reason', 'wrong_code');
  END IF;
  UPDATE otp_codes SET consumed = true WHERE id = v_row.id;
  UPDATE session_members SET phone = p_phone, phone_verified = true WHERE id = v_m.id;
  INSERT INTO customers(phone, name, last_seen_at, restaurant_id) VALUES (p_phone, v_m.name, NOW(), v_rid)
    ON CONFLICT (restaurant_id, phone) DO UPDATE SET last_seen_at = NOW(), name = COALESCE(customers.name, EXCLUDED.name);
  RETURN json_build_object('ok', true);
END; $$;

-- ── leave feedback (037) — derive restaurant from the order ─────────────────
-- Reproduced verbatim from 037. ADDED: v_rid from the order the id resolves to,
-- stamped on the feedback row.
CREATE OR REPLACE FUNCTION lfh_leave_feedback(p_order uuid, p_rating int, p_comment text, p_name text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_o orders; v_rid uuid;
BEGIN
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN RETURN json_build_object('ok', false, 'reason', 'bad_rating'); END IF;
  SELECT * INTO v_o FROM orders WHERE id = p_order;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'unknown_order'); END IF;
  -- DERIVE the restaurant from the order this feedback is for.
  v_rid := COALESCE(v_o.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  INSERT INTO feedback(order_id, table_number, rating, comment, name, restaurant_id)
    VALUES (p_order, v_o.table_number, p_rating, NULLIF(trim(p_comment), ''), NULLIF(trim(p_name), ''), v_rid)
    ON CONFLICT (order_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, name = EXCLUDED.name, created_at = NOW();
  RETURN json_build_object('ok', true);
END; $$;

-- ── correct a table typo on a session-LESS order (051) ──────────────────────
-- Reproduced from 051 (the C4 IDOR guard: a guest may only re-label a session-LESS
-- order; session orders are staff-move-only). It reads the order by its globally-
-- unique id and UPDATEs ONLY that same row's table_number — there is no
-- table_number→other-row lookup to scope, so new_table is already interpreted
-- "within the order's restaurant" by construction. We derive v_rid from the order
-- and constrain the UPDATE to that restaurant_id, so even a future change can't let
-- it touch another tenant's row. No signature / behaviour change on restaurant #1.
--
-- NECESSARY FIX (not a behaviour change): the 051 body referenced the bare column
-- `status` inside the order lookup, which is AMBIGUOUS against this function's
-- RETURNS TABLE output column of the same name — so the original throws "column
-- reference status is ambiguous" the moment it is ACTUALLY CALLED (latent because
-- the schema validator only CREATEs functions, never executes them). The lookup is
-- aliased here (orders o → o.status) so the function — and the tenant scoping added
-- below — can actually run. Logic is otherwise identical.
CREATE OR REPLACE FUNCTION public.set_order_table_number(order_id UUID, new_table TEXT)
RETURNS TABLE (status TEXT, table_number TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_o orders; v_t text := NULLIF(btrim(new_table), ''); v_rid uuid;
BEGIN
  IF v_t IS NULL OR v_t !~ '^\d+$' THEN RETURN; END IF;
  SELECT o.* INTO v_o FROM orders o WHERE o.id = order_id AND o.status IN ('received','preparing');
  IF NOT FOUND THEN RETURN; END IF;
  IF v_o.session_id IS NOT NULL THEN RETURN; END IF; -- session orders: staff move only
  -- DERIVE the restaurant from the order; the relabel stays inside that tenant.
  v_rid := COALESCE(v_o.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  UPDATE orders o SET table_number = v_t WHERE o.id = order_id AND o.restaurant_id = v_rid;
  RETURN QUERY SELECT o.status, o.table_number FROM orders o WHERE o.id = order_id;
END; $$;

-- Grants are intentionally NOT touched: plain CREATE OR REPLACE keeps the existing
-- anon (and, for set_order_table_number, authenticated) EXECUTE privileges from
-- 015 / 025 / 029 / 037 / 051. These are guest functions — they must stay reachable.

NOTIFY pgrst, 'reload schema';
