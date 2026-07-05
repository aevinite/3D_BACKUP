-- 118_price_order_tenant_scope.sql
-- CROSS-TENANT FIX (2026-07-04 leak audit): lfh_price_order looked dishes up
-- GLOBALLY by id ("global by dish id, untouched" — 083), so an order stamped
-- for restaurant B could contain (and price) restaurant A's dishes. A phone
-- that had visited two restaurants could push restaurant A's dish into
-- restaurant B's kitchen. From now on the price calculator only recognises
-- dishes belonging to the restaurant the order is FOR; anything else is
-- 'unknown_item' and the whole order is refused.
--
-- Touches: lfh_price_order (new p_restaurant_id arg) + its four callers
-- (lfh_place_order, lfh_place_order_public, lfh_staff_place_order,
-- lfh_staff_add_item_to_order), each passing the restaurant they already know.
-- Also fixes lfh_staff_add_item_to_order writing order_items rows WITHOUT a
-- restaurant_id (every other writer stamps it).

-- ── 1. the scoped price calculator ──────────────────────────────────────────
-- The argument list changes, so the old signature must be dropped (CREATE OR
-- REPLACE can't change parameters).
DROP FUNCTION IF EXISTS lfh_price_order(jsonb);

CREATE OR REPLACE FUNCTION lfh_price_order(
  p_items jsonb,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_rid   uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_in    jsonb;             -- one incoming line
  v_mi    menu_items;        -- the real dish from the DB
  v_qty   int;
  v_base  numeric;           -- dish base price (from the DB)
  v_add   numeric;           -- add-on price from chosen options (from the DB)
  v_opts  jsonb;             -- rebuilt options list (server label + price)
  v_unit  numeric;           -- confident per-unit price
  v_items jsonb := '[]'::jsonb;
  v_sub   numeric := 0;
  v_tax   numeric;
  v_total numeric;
  v_rate  numeric := 0.05;   -- 5% tax — server-side mirror of TAX_RATE in CartPanel.tsx
BEGIN
  -- An order with no lines is meaningless — refuse it.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_order');
  END IF;

  FOR v_in IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    -- Look up the real dish IN THIS RESTAURANT. A dish that exists but belongs
    -- to another restaurant is just as unknown as a made-up id.
    SELECT * INTO v_mi FROM menu_items
      WHERE id = v_in->>'id' AND restaurant_id = v_rid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'unknown_item', 'item', v_in->>'id');
    END IF;

    -- Sold-out dishes can NEVER be ordered, even if the front-end was bypassed.
    IF 'sold-out' = ANY(v_mi.tags) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'sold_out', 'item', v_mi.title);
    END IF;

    -- Quantity: at least 1, capped at 99 so nobody orders a ludicrous amount.
    v_qty := GREATEST(1, LEAST(99, COALESCE(NULLIF(v_in->>'qty', '')::int, 1)));

    -- Base price comes from the DB (text like "2.99"); strip anything non-numeric.
    v_base := COALESCE(NULLIF(regexp_replace(v_mi.price, '[^0-9.]', '', 'g'), '')::numeric, 0);

    -- Add-ons: ONLY options that truly exist on this dish count, at the DB's price.
    SELECT
      COALESCE(SUM((ch->>'price')::numeric), 0),
      COALESCE(jsonb_agg(jsonb_build_object(
        'group', grp->>'name', 'label', ch->>'label', 'price', (ch->>'price')::numeric)), '[]'::jsonb)
      INTO v_add, v_opts
    FROM jsonb_array_elements(COALESCE(v_in->'options', '[]'::jsonb)) opt
    JOIN jsonb_array_elements(COALESCE(v_mi.options, '[]'::jsonb)) grp
      ON grp->>'name' = opt->>'group'
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(grp->'choices', '[]'::jsonb)) ch
    WHERE ch->>'label' = opt->>'label';

    v_unit := lfh_nice_usd(v_base) + COALESCE(v_add, 0);
    v_sub  := v_sub + (v_unit * v_qty);

    v_items := v_items || jsonb_build_object(
      'id',      v_mi.id,
      'title',   v_mi.title,
      'price',   to_char(v_unit, 'FM999999990.00'),
      'qty',     v_qty,
      'options', CASE WHEN v_opts = '[]'::jsonb THEN NULL ELSE v_opts END,
      'removed', CASE WHEN jsonb_typeof(v_in->'removed') = 'array' THEN v_in->'removed' ELSE '[]'::jsonb END,
      'note',    v_in->>'note'
    );
  END LOOP;

  v_tax   := round(v_sub * v_rate, 2);
  v_total := v_sub + v_tax;
  RETURN jsonb_build_object('ok', true, 'items', v_items,
                            'subtotal', v_sub, 'tax', v_tax, 'total', v_total);
END; $$;

-- Same exposure as before: a read-only calculator over public menu data.
GRANT EXECUTE ON FUNCTION lfh_price_order(jsonb, uuid) TO anon, authenticated;

-- ── 2. guest SESSION order (restaurant derived from the session) ────────────
CREATE OR REPLACE FUNCTION public.lfh_place_order(p_token text, p_items jsonb, p_allergies text[])
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
  SELECT require_otp INTO v_req_otp FROM settings WHERE restaurant_id = v_rid;
  IF COALESCE(v_req_otp, true) AND NOT v_m.phone_verified THEN
    RETURN json_build_object('ok', false, 'reason', 'otp_required');
  END IF;

  -- SERVER prices the order — scoped to THIS session's restaurant (118).
  v_priced := lfh_price_order(p_items, v_rid);
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
END; $function$;

-- ── 3. guest NON-SESSION order ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_place_order_public(p_table text, p_items jsonb, p_allergies text[], p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_rid uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_order uuid; v_priced jsonb;
BEGIN
  -- Priced against the restaurant the order is FOR (118).
  v_priced := lfh_price_order(p_items, v_rid);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;
  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, restaurant_id)
    VALUES (NULLIF(p_table, ''), v_priced->'items',
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), 'received', v_rid)
    RETURNING id INTO v_order;
  RETURN json_build_object('ok', true, 'order_id', v_order);
END; $function$;

-- ── 4. waiter/tablet order ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_staff_place_order(p_table text, p_items jsonb, p_allergies text[], p_note text, p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_rid   uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_s     sessions; v_order uuid; v_kot int; v_item jsonb; v_priced jsonb;
BEGIN
  -- Same money math as guest orders: priced by the server, sold-out rejected —
  -- and scoped to THIS restaurant's menu (118).
  v_priced := lfh_price_order(p_items, v_rid);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;

  -- The table's open session FOR THIS RESTAURANT, or OPEN ONE NOW so the order is
  -- never an orphan. (Another restaurant's open "table 1" must never be reused.)
  SELECT * INTO v_s FROM sessions
    WHERE table_number = p_table AND status = 'open' AND restaurant_id = v_rid
    ORDER BY last_activity_at DESC LIMIT 1;
  IF v_s.id IS NULL THEN
    INSERT INTO sessions(table_number, status, opened_by, opened_at, restaurant_id)
      VALUES (p_table, 'open', 'waiter', NOW(), v_rid)
      RETURNING * INTO v_s;
  END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id, member_id, restaurant_id)
    VALUES (p_table, v_priced->'items',
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), 'received', v_s.id, NULL, v_rid)
    RETURNING id, kot_no INTO v_order, v_kot;

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
        COALESCE(v_item->>'note', p_note),
        v_rid);
  END LOOP;

  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'order_id', v_order, 'kot_no', v_kot);
END; $function$;

-- ── 5. staff "add dish to an existing order" ────────────────────────────────
-- Scope pricing to the ORDER's restaurant, and stamp the new order_items rows
-- with it too (they were being written with restaurant_id NULL — invisible to
-- tenant-scoped reads).
CREATE OR REPLACE FUNCTION public.lfh_staff_add_item_to_order(p_order uuid, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_order   orders;
  v_rid     uuid;
  v_priced  jsonb;
  v_item    jsonb;
  v_total   numeric;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;
  IF v_order.payment_status = 'paid' AND v_order.status <> 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_paid');
  END IF;
  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_cancelled');
  END IF;

  v_rid := COALESCE(v_order.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_priced := lfh_price_order(p_items, v_rid);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_priced->'items') LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note, status, restaurant_id)
      VALUES (v_order.id, v_order.session_id,
        COALESCE(v_item->>'title', ''),
        COALESCE((v_item->>'qty')::int, 1),
        COALESCE((v_item->>'price')::numeric, 0),
        v_item->'options',
        CASE WHEN jsonb_typeof(v_item->'removed') = 'array'
             THEN COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(v_item->'removed') x), '{}')
             ELSE '{}' END,
        v_item->>'note', 'received', v_rid);
  END LOOP;

  v_total := lfh_reprice_order(v_order.id);                  -- recompute money + rebuild ticket
  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'total', v_total);
END; $function$;
