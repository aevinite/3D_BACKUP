-- 049_staff_order_opens_session.sql   [was titled 048_ until 2026-08-06]
-- BUG: a waiter-tablet order for a table with NO open session was inserted with
-- session_id = NULL ("orphan order"). The floor brain (lfh_floor_state) ignores
-- session-less orders when sessions are ON ("stale leftovers → Free"), so the
-- order showed on the tablet (which lists by table number) but NOT on the
-- editor's floor — the two screens disagreed (e.g. table 12).
--
-- FIX: placing an order now AUTO-OPENS the table's session (bill-on-first-order)
-- when one isn't already open, so every order is attached to a session and shows
-- consistently everywhere. Idempotent: an existing open session is reused.

CREATE OR REPLACE FUNCTION lfh_staff_place_order(p_table text, p_items jsonb, p_allergies text[], p_note text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s sessions; v_order uuid; v_kot int; v_item jsonb; v_priced jsonb;
BEGIN
  -- Same money math as guest orders: priced by the server, sold-out rejected.
  v_priced := lfh_price_order(p_items);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;

  -- The table's open session, or OPEN ONE NOW so the order is never an orphan.
  SELECT * INTO v_s FROM sessions WHERE table_number = p_table AND status = 'open'
    ORDER BY last_activity_at DESC LIMIT 1;
  IF v_s.id IS NULL THEN
    INSERT INTO sessions(table_number, status, opened_by, opened_at)
      VALUES (p_table, 'open', 'waiter', NOW())
      RETURNING * INTO v_s;
  END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id, member_id)
    VALUES (p_table, v_priced->'items',
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), 'received', v_s.id, NULL)
    RETURNING id, kot_no INTO v_order, v_kot;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_priced->'items') LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note)
      VALUES (v_order, v_s.id,
        COALESCE(v_item->>'title', ''),
        COALESCE((v_item->>'qty')::int, 1),
        COALESCE((v_item->>'price')::numeric, 0),
        v_item->'options',
        CASE WHEN jsonb_typeof(v_item->'removed') = 'array'
             THEN COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(v_item->'removed') x), '{}')
             ELSE '{}' END,
        COALESCE(v_item->>'note', p_note));
  END LOOP;

  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'order_id', v_order, 'kot_no', v_kot);
END; $$;

-- Staff-only (matches migration 038): never callable by guests.
REVOKE EXECUTE ON FUNCTION lfh_staff_place_order(text, jsonb, text[], text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_staff_place_order(text, jsonb, text[], text) TO service_role;

-- One-time backfill: link EXISTING orphan active orders to an open session for
-- their table, so they stop hiding on the editor floor. (No-op once clean.)
DO $$
DECLARE r record; v_sess uuid;
BEGIN
  FOR r IN SELECT DISTINCT table_number FROM orders
           WHERE session_id IS NULL AND NOT archived AND status <> 'cancelled' AND table_number IS NOT NULL LOOP
    SELECT id INTO v_sess FROM sessions WHERE table_number = r.table_number AND status = 'open'
      ORDER BY last_activity_at DESC LIMIT 1;
    IF v_sess IS NULL THEN
      INSERT INTO sessions(table_number, status, opened_by, opened_at)
        VALUES (r.table_number, 'open', 'waiter', NOW()) RETURNING id INTO v_sess;
    END IF;
    UPDATE orders SET session_id = v_sess
      WHERE table_number = r.table_number AND session_id IS NULL AND NOT archived AND status <> 'cancelled';
    UPDATE order_items oi SET session_id = v_sess
      FROM orders o WHERE oi.order_id = o.id AND o.session_id = v_sess AND oi.session_id IS NULL;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
