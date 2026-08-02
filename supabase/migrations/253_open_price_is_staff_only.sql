-- 253_open_price_is_staff_only.sql
-- Follow-up to 215 (open-price dishes) -- closes the guest side of that feature.
--
-- 215 taught lfh_price_order to take the LINE price from the caller for a dish flagged
-- open_price. That is exactly right for the staff panels (a waiter types the price of an
-- as-per-MRP item at order time) and exactly wrong for the two GUEST entry points: both are
-- granted to anon, and both forward the browser's items array straight into the pricer. So
-- for those dishes the amount charged came from the guest's own device, while every other
-- price in this product comes from the database.
--
-- The fix leaves the shared calculator and its six callers completely alone and puts the rule
-- where it belongs -- a guest order containing an open-price dish is refused up front with
-- reason 'staff_priced_item'. In normal use it never fires: the guest menu already hides these
-- dishes and the dish page 404s for them (lib/menu.ts). This is the backstop that makes that
-- hiding a real rule. Staff paths (lfh_staff_place_order / lfh_staff_add_item_to_order) are
-- NOT touched.
--
-- Both bodies below are the CURRENT definitions, copied verbatim and verified byte-for-byte
-- against what runs on the database today:
--   - lfh_place_order        = migration 206 (rate-limit guard, mig 205)
--   - lfh_place_order_public = migration 240 (rate limit + the 2026-07-31 advisory-lock work
--                              that makes a guest order and a waiter order share ONE session)
-- Re-creating either from an older copy would silently revert those -- the trap that produced
-- migration 240 in the first place. The ONLY addition is the guard block marked "253".

CREATE OR REPLACE FUNCTION public.lfh_place_order(p_token text, p_items jsonb, p_allergies text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- RATE LIMIT (mig 205): too many orders from this table in the window → politely reject.
  IF NOT lfh_rate_check(v_rid, 'guest_order', 'table:' || v_s.table_number, 'Table ' || v_s.table_number) THEN
    RETURN json_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  SELECT require_otp INTO v_req_otp FROM settings WHERE restaurant_id = v_rid;
  IF COALESCE(v_req_otp, true) AND NOT v_m.phone_verified THEN
    RETURN json_build_object('ok', false, 'reason', 'otp_required');
  END IF;

  -- 253: OPEN-PRICE dishes are priced by STAFF at order time (mig 215), which means
  -- lfh_price_order takes the line price from the CALLER for them. That is right for the
  -- waiter/manager panels and wrong here: these two functions are granted to "anon" and
  -- forward the browser's items verbatim, so a guest device would be naming its own amount.
  -- Every other price in this app comes from the database. The guest menu already hides these
  -- dishes (lib/menu.ts) -- this is the server-side backstop that makes the hiding a real rule
  -- rather than a UI preference. Staff RPCs are untouched and keep working.
  IF jsonb_typeof(p_items) = 'array' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_items) e
        JOIN menu_items m ON m.id = e->>'id' AND m.restaurant_id = v_rid
       WHERE m.open_price
     ) THEN
    RETURN json_build_object('ok', false, 'reason', 'staff_priced_item');
  END IF;

  -- SERVER prices the order — scoped to THIS session's restaurant (118).
  v_priced := lfh_price_order(p_items, v_rid);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;

  -- AUTO-ACCEPT FOLLOW-UPS (163): staff already accepted an order for this seating,
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

CREATE OR REPLACE FUNCTION public.lfh_place_order_public(p_table text, p_items jsonb, p_allergies text[], p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_order uuid; v_priced jsonb; v_auto boolean := false; v_items jsonb; v_status text;
  v_tbl text := NULLIF(p_table, '');
  v_s sessions;
BEGIN
  -- RATE LIMIT (mig 205): cap public/QR orders per table in the window.
  IF NOT lfh_rate_check(v_rid, 'guest_order', 'table:' || COALESCE(v_tbl, '?'),
                        'Table ' || COALESCE(v_tbl, '?')) THEN
    RETURN json_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  -- 253: open-price dishes are staff-priced -- never orderable from a guest device. See the
  -- long note on lfh_place_order above; same rule, same reason code.
  IF jsonb_typeof(p_items) = 'array' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_items) e
        JOIN menu_items m ON m.id = e->>'id' AND m.restaurant_id = v_rid
       WHERE m.open_price
     ) THEN
    RETURN json_build_object('ok', false, 'reason', 'staff_priced_item');
  END IF;

  -- Priced against the restaurant the order is FOR (118).
  v_priced := lfh_price_order(p_items, v_rid);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;

  -- AUTO-ACCEPT FOLLOW-UPS (163). No session here, so "same seating" = this table
  -- has an accepted order that's still unpaid and recent. A paid/settled bill (or a
  -- stale 3h+ order) means a NEW party — their first order needs an Accept again.
  -- NULLIF: an order with no table can never match (comparison stays NULL/false).
  SELECT EXISTS (
    SELECT 1 FROM orders
     WHERE restaurant_id = v_rid
       AND table_number = v_tbl
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

  -- THE PARTY (2026-07-31). Same lock key as lfh_staff_place_order, so a guest order and a
  -- waiter order arriving together on one table serialise and share ONE session. A takeaway /
  -- no-table order keeps session_id NULL — there is no table to seat.
  IF v_tbl IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('lfh_place:' || v_rid::text || ':' || v_tbl, 0));
    SELECT * INTO v_s FROM sessions
      WHERE table_number = v_tbl AND status = 'open' AND restaurant_id = v_rid
      ORDER BY last_activity_at DESC LIMIT 1;
    IF v_s.id IS NULL THEN
      BEGIN
        INSERT INTO sessions(table_number, status, opened_by, opened_at, restaurant_id)
          VALUES (v_tbl, 'open', 'guest', NOW(), v_rid)
          RETURNING * INTO v_s;
      EXCEPTION WHEN unique_violation THEN
        -- Another path opened it without taking our lock (idx_one_open_session_per_table).
        -- Losing that race is a success: the table has a party, which is all we wanted.
        SELECT * INTO v_s FROM sessions
          WHERE table_number = v_tbl AND status = 'open' AND restaurant_id = v_rid
          ORDER BY last_activity_at DESC LIMIT 1;
      END;
    END IF;
  END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id, restaurant_id)
    VALUES (v_tbl, v_items,
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), v_status, v_s.id, v_rid)
    RETURNING id INTO v_order;

  IF v_s.id IS NOT NULL THEN
    UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  END IF;

  RETURN json_build_object('ok', true, 'order_id', v_order);
END; $function$;

-- Same exposure as before (CREATE OR REPLACE keeps grants; re-affirmed for safety --
-- both are guest-called anon RPCs, see 029/083/164/206/240).
GRANT EXECUTE ON FUNCTION lfh_place_order(text, jsonb, text[])               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_place_order_public(text, jsonb, text[], uuid)  TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
