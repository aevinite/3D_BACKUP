-- v2: attribute each order to the MEMBER who placed it, so the editor Log can show
-- what each guest actually did (ordered vs only called a waiter) and which role
-- they held. waiter_calls already carries member_id (migration 014); orders did
-- not — this adds it and sets it in lfh_place_order.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS member_id UUID;
CREATE INDEX IF NOT EXISTS idx_orders_member ON orders(member_id);

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
  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id, member_id)
    VALUES (v_s.table_number, p_items, COALESCE(p_subtotal, 0), COALESCE(p_tax, 0), COALESCE(p_total, 0), COALESCE(p_allergies, '{}'), 'received', v_s.id, v_m.id)
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

GRANT EXECUTE ON FUNCTION lfh_place_order(text, jsonb, numeric, numeric, numeric, text[]) TO anon;

NOTIFY pgrst, 'reload schema';
