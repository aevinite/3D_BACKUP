-- 170_staff_move_order_item.sql
-- Move ONE dish line (an order_items row) to ANOTHER table — the finest-grained
-- transfer in the KOT ▾ menu (PetPooja's "item transfer"). The line lands under a
-- FRESH order on the target table's session, so it gets its own new KOT number
-- (PetPooja moves an item under a new ticket too) while keeping its cooking status
-- and served_at — a served dish never re-appears as a new kitchen task (the kitchen
-- only lists received/preparing lines).
--
-- Money correctness: BOTH orders are re-priced via lfh_reprice_order (mig 119 —
-- per-restaurant tax); if the moved line was the source order's LAST dish, the source
-- order is CANCELLED (same rule as lfh_delete_order_item) so no empty ₹0 line lingers
-- on the bill. Whole-bill discounts re-split automatically: reprice CHANGES
-- orders.subtotal, which fires trg_resplit_bill_discount (migs 143/148) on both sides.
--
-- Whole line only in v1 (qty > 1 moves all plates of that line) — partial-qty moves
-- would need a row split first; deliberately deferred.
CREATE OR REPLACE FUNCTION lfh_staff_move_order_item(p_item uuid, p_to text, p_rid uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item   order_items;
  v_order  orders;        -- source order (the KOT the line leaves)
  v_src    sessions;      -- source session
  v_target sessions;
  v_new    orders;        -- fresh order (new KOT) on the target
  v_from   text;
  v_left   int;
BEGIN
  SELECT * INTO v_item FROM order_items WHERE id = p_item AND restaurant_id = p_rid;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'item_not_found'); END IF;
  SELECT * INTO v_order FROM orders WHERE id = v_item.order_id AND restaurant_id = p_rid;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'order_not_found'); END IF;
  IF v_order.payment_status = 'paid' THEN RETURN json_build_object('ok', false, 'reason', 'order_paid'); END IF;
  IF v_order.status = 'cancelled' THEN RETURN json_build_object('ok', false, 'reason', 'order_cancelled'); END IF;
  IF p_to !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'reason', 'bad_table'); END IF;
  IF p_to = v_order.table_number THEN RETURN json_build_object('ok', false, 'reason', 'same_table'); END IF;
  v_from := v_order.table_number;

  -- Printed-invoice locks on either side (a live invoice total must never drift).
  IF v_order.session_id IS NOT NULL THEN
    SELECT * INTO v_src FROM sessions WHERE id = v_order.session_id AND restaurant_id = p_rid;
    IF FOUND AND v_src.invoice_no IS NOT NULL AND NOT COALESCE(v_src.invoice_voided, false) THEN
      RETURN json_build_object('ok', false, 'reason', 'source_invoiced');
    END IF;
  END IF;
  SELECT * INTO v_target FROM sessions
   WHERE table_number = p_to AND restaurant_id = p_rid AND status <> 'closed'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND AND v_target.invoice_no IS NOT NULL AND NOT COALESCE(v_target.invoice_voided, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'target_invoiced');
  END IF;
  IF NOT FOUND THEN
    INSERT INTO sessions (table_number, status, opened_by, opened_at, restaurant_id)
    VALUES (p_to, 'open', 'waiter', NOW(), p_rid)
    RETURNING * INTO v_target;
  END IF;

  -- Fresh order = fresh KOT number (assigned by the orders INSERT trigger). Its real
  -- totals/status/items-json all come from lfh_reprice_order right after the move.
  INSERT INTO orders (session_id, table_number, status, payment_status, items, subtotal, tax, total, restaurant_id)
  VALUES (v_target.id, p_to,
          CASE WHEN v_item.status = 'served' THEN 'served'
               WHEN v_item.status IN ('preparing', 'ready') THEN 'preparing'
               ELSE 'received' END,
          'unpaid', '[]'::jsonb, 0, 0, 0, p_rid)
  RETURNING * INTO v_new;

  UPDATE order_items SET order_id = v_new.id, session_id = v_target.id WHERE id = p_item;

  -- Source: reprice the survivors, or cancel the KOT if the moved line was its last
  -- dish (lfh_reprice_order alone would leave a ₹0 'received' ghost on the bill).
  SELECT COUNT(*) INTO v_left FROM order_items WHERE order_id = v_order.id;
  IF v_left = 0 THEN
    UPDATE orders SET status = 'cancelled', subtotal = 0, tax = 0, total = 0, items = '[]'::jsonb
     WHERE id = v_order.id;
  ELSE
    PERFORM lfh_reprice_order(v_order.id);
    UPDATE orders SET edited_at = NOW() WHERE id = v_order.id;  -- ✎ Edited badge: staff re-check the shrunk ticket
  END IF;
  PERFORM lfh_reprice_order(v_new.id);

  -- The target now bills something — make sure it has a bill number (INSERT-only trigger).
  IF v_target.bill_no IS NULL THEN
    UPDATE sessions SET bill_no = lfh_next_counter(p_rid, 'bill')
     WHERE id = v_target.id AND bill_no IS NULL;
  END IF;

  -- mig-096 four-row breadcrumb pattern: both tables, guests + staff ops.
  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id) VALUES
    ('table:' || v_from, 'order', v_new.id::text, v_from, p_rid),
    ('table:' || p_to,   'order', v_new.id::text, p_to,   p_rid),
    ('ops',              'order', v_new.id::text, p_to,   p_rid),
    ('ops',              'order', v_new.id::text, v_from, p_rid);

  RETURN json_build_object('ok', true, 'from', v_from, 'to', p_to,
                           'new_order', v_new.id, 'source_cancelled', v_left = 0,
                           'target_session', v_target.id);
END; $$;

REVOKE ALL ON FUNCTION lfh_staff_move_order_item(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_staff_move_order_item(uuid, text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
