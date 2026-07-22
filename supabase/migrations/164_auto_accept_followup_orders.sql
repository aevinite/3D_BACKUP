-- 164_auto_accept_followup_orders.sql
-- Owner request (2026-07-22): once a table's FIRST order has been accepted by staff,
-- every LATER guest order from the same seating goes straight to the kitchen pass as
-- 'preparing' — no second "Accept" tap. The kitchen already shows/prints every new
-- order the moment it lands, so the extra Accept on the manager/tablet for follow-up
-- orders was a redundant step ("why accept again? it's already in the kitchen").
--
-- What counts as "the same seating":
--   • session mode : the SAME open dining session already has an accepted order
--                    (status beyond 'received', not cancelled). Clean boundary —
--                    the session closes when the table settles.
--   • public mode  : the same table at the same restaurant has an accepted,
--                    still-UNPAID order less than 3 hours old. Once the bill is
--                    paid (table settled), the next party's first order needs an
--                    Accept again.
-- The FIRST order of any seating still arrives as 'received' and must be accepted.
--
-- Auto-accepted rows mirror EXACTLY what the staff Accept endpoint writes
-- (orders.status='preparing', each items[] element status='preparing', order_items
-- status='preparing'), so every panel — kitchen columns, tablet tiles, manager
-- table detail, guest tracker — reads them identically to a hand-accepted order.
--
-- Function bodies are based on migration 118 (verified: the LATEST definition of
-- both functions — re-creating from an older copy would silently revert 118's
-- per-restaurant pricing scope).

-- ── 1. guest SESSION order ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_place_order(p_token text, p_items jsonb, p_allergies text[])
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_m session_members; v_s sessions; v_order uuid; v_item jsonb; v_req_otp boolean; v_priced jsonb;
        v_rid uuid; v_auto boolean := false; v_items jsonb; v_status text;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF NOT v_m.approved THEN RETURN json_build_object('ok', false, 'reason', 'not_approved'); END IF;
  -- DERIVE the restaurant from the session this token belongs to (NOT the #1 default).
  v_rid := COALESCE(v_s.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  IF lfh_is_blocked(v_m.phone, v_s.table_number, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT require_otp INTO v_req_otp FROM settings WHERE restaurant_id = v_rid;
  IF COALESCE(v_req_otp, true) AND NOT v_m.phone_verified THEN
    RETURN json_build_object('ok', false, 'reason', 'otp_required');
  END IF;

  -- SERVER prices the order — scoped to THIS session's restaurant (118).
  v_priced := lfh_price_order(p_items, v_rid);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;

  -- AUTO-ACCEPT FOLLOW-UPS (164): staff already accepted an order for this seating,
  -- so this one skips straight to the pass — exactly what the Accept button writes.
  SELECT EXISTS (
    SELECT 1 FROM orders
     WHERE session_id = v_s.id
       AND status NOT IN ('received', 'cancelled')
  ) INTO v_auto;
  IF v_auto THEN
    v_status := 'preparing';
    SELECT COALESCE(jsonb_agg(e || jsonb_build_object('status', 'preparing')), '[]'::jsonb)
      INTO v_items FROM jsonb_array_elements(v_priced->'items') e;
  ELSE
    v_status := 'received';
    v_items  := v_priced->'items';
  END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id, member_id, restaurant_id)
    VALUES (v_s.table_number, v_items,
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), v_status, v_s.id, v_m.id, v_rid)
    RETURNING id INTO v_order;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_priced->'items') LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note, status, restaurant_id)
      VALUES (v_order, v_s.id,
        COALESCE(v_item->>'title', ''),
        COALESCE((v_item->>'qty')::int, 1),
        COALESCE((v_item->>'price')::numeric, 0),
        v_item->'options',
        CASE WHEN jsonb_typeof(v_item->'removed') = 'array'
             THEN COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(v_item->'removed') x), '{}')
             ELSE '{}' END,
        v_item->>'note', v_status, v_rid);
  END LOOP;

  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'order_id', v_order);
END; $function$;

-- ── 2. guest NON-SESSION (QR/public) order ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_place_order_public(p_table text, p_items jsonb, p_allergies text[], p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_rid uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_order uuid; v_priced jsonb; v_auto boolean := false; v_items jsonb; v_status text;
BEGIN
  -- Priced against the restaurant the order is FOR (118).
  v_priced := lfh_price_order(p_items, v_rid);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;

  -- AUTO-ACCEPT FOLLOW-UPS (164). No session here, so "same seating" = this table
  -- has an accepted order that's still unpaid and recent. A paid/settled bill (or a
  -- stale 3h+ order) means a NEW party — their first order needs an Accept again.
  -- NULLIF: an order with no table can never match (comparison stays NULL/false).
  SELECT EXISTS (
    SELECT 1 FROM orders
     WHERE restaurant_id = v_rid
       AND table_number = NULLIF(p_table, '')
       AND status IN ('preparing', 'served')
       AND payment_status <> 'paid'
       AND created_at > NOW() - INTERVAL '3 hours'
  ) INTO v_auto;
  IF v_auto THEN
    v_status := 'preparing';
    SELECT COALESCE(jsonb_agg(e || jsonb_build_object('status', 'preparing')), '[]'::jsonb)
      INTO v_items FROM jsonb_array_elements(v_priced->'items') e;
  ELSE
    v_status := 'received';
    v_items  := v_priced->'items';
  END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, restaurant_id)
    VALUES (NULLIF(p_table, ''), v_items,
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), v_status, v_rid)
    RETURNING id INTO v_order;
  RETURN json_build_object('ok', true, 'order_id', v_order);
END; $function$;

-- Same exposure as before (CREATE OR REPLACE keeps grants; re-affirmed for safety —
-- both are guest-called anon RPCs, see 029/083).
GRANT EXECUTE ON FUNCTION lfh_place_order(text, jsonb, text[])                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_place_order_public(text, jsonb, text[], uuid)      TO anon, authenticated;
