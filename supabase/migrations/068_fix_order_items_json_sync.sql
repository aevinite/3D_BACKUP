-- FIX: orders.items JSONB "kitchen ticket" was synced by matching lines on
-- title (+qty) — a NON-UNIQUE key. On an order with two of the same dish, deleting
-- (062), changing qty (063) or editing a note (063 — matched on title ALONE) hit
-- the WRONG ticket line; the note case could stamp an allergen note onto the wrong
-- guest's dish. Money was always correct (it comes from order_items), but the KOT /
-- printout / guest live-view read orders.items, so the displayed dish was wrong.
--
-- ROOT FIX (this migration): stop guessing the line by content. Rebuild orders.items
-- as a pure PROJECTION of the authoritative order_items rows after every change.
-- One helper does it; reprice calls it (so qty + add-item get it for free); delete
-- and note call it directly. (owner-reported bug, 2026-06-17)

-- ── Rebuild one order's JSONB ticket from its order_items (source of truth). ──
-- The line shape MATCHES lfh_price_order (029): price is a STRING unit price; we
-- additionally stamp each line's order_items.id so any future sync is exact.
-- Only ever called for orders that HAVE order_items rows (the edit/delete RPCs look
-- a row up first), so a legacy JSON-only order is never wiped by accident.
CREATE OR REPLACE FUNCTION lfh_sync_order_items_json(p_order uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE orders o
     SET items = COALESCE((
       SELECT jsonb_agg(
                jsonb_strip_nulls(jsonb_build_object(
                  'id',      oi.id,
                  'title',   oi.title,
                  'price',   to_char(oi.unit_price, 'FM999999990.00'),
                  'qty',     oi.qty,
                  'options', CASE WHEN oi.options IS NULL OR oi.options = '[]'::jsonb THEN NULL ELSE oi.options END,
                  'removed', CASE WHEN oi.removed IS NULL OR array_length(oi.removed, 1) IS NULL THEN NULL ELSE to_jsonb(oi.removed) END,
                  'note',    oi.note,
                  'status',  oi.status
                ))
                ORDER BY oi.created_at, oi.id)
       FROM order_items oi WHERE oi.order_id = p_order
     ), '[]'::jsonb)
   WHERE o.id = p_order;
END; $$;

-- ── reprice: unchanged money/status logic, now ALSO rebuilds the ticket. ──
CREATE OR REPLACE FUNCTION lfh_reprice_order(p_order uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub   numeric := 0;
  v_rate  numeric := 0.05;
  v_total_n int; v_served_n int; v_active boolean;
  v_status text;
BEGIN
  SELECT COALESCE(SUM(unit_price * qty), 0),
         COUNT(*),
         COUNT(*) FILTER (WHERE status = 'served'),
         COALESCE(bool_or(status IN ('preparing', 'ready', 'served')), false)
    INTO v_sub, v_total_n, v_served_n, v_active
    FROM order_items WHERE order_id = p_order;

  v_status := CASE
    WHEN v_total_n > 0 AND v_served_n = v_total_n THEN 'served'
    WHEN v_active THEN 'preparing'
    ELSE 'received' END;

  UPDATE orders
     SET subtotal = v_sub,
         tax      = round(v_sub * v_rate, 2),
         total    = v_sub + round(v_sub * v_rate, 2),
         status   = CASE WHEN status = 'cancelled' THEN status ELSE v_status END
   WHERE id = p_order;

  PERFORM lfh_sync_order_items_json(p_order); -- rebuild the KOT ticket from order_items
  RETURN v_sub + round(v_sub * v_rate, 2);
END; $$;

-- ── DELETE one dish: recompute money, then rebuild the ticket (no title match). ──
CREATE OR REPLACE FUNCTION lfh_delete_order_item(p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item    order_items;
  v_order   orders;
  v_sub     numeric := 0;
  v_tax     numeric;
  v_total   numeric;
  v_left    int;
  v_rate    numeric := 0.05;
BEGIN
  SELECT * INTO v_item FROM order_items WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'item_not_found'); END IF;
  SELECT * INTO v_order FROM orders WHERE id = v_item.order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;

  IF v_order.payment_status = 'paid' AND v_order.status <> 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_paid');
  END IF;

  DELETE FROM order_items WHERE id = p_item_id;

  SELECT COALESCE(SUM(unit_price * qty), 0), COUNT(*)
    INTO v_sub, v_left
    FROM order_items WHERE order_id = v_order.id;

  -- No dishes left → cancel the order so no empty ₹0 line lingers on the bill.
  IF v_left = 0 THEN
    UPDATE orders
       SET status = 'cancelled', subtotal = 0, tax = 0, total = 0, items = '[]'::jsonb
     WHERE id = v_order.id;
    RETURN jsonb_build_object('ok', true, 'order_id', v_order.id,
                              'order_cancelled', true, 'items_left', 0, 'total', 0);
  END IF;

  v_tax   := round(v_sub * v_rate, 2);
  v_total := v_sub + v_tax;
  UPDATE orders SET subtotal = v_sub, tax = v_tax, total = v_total WHERE id = v_order.id;
  PERFORM lfh_sync_order_items_json(v_order.id); -- rebuild ticket from the SURVIVORS

  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id,
                            'order_cancelled', false, 'items_left', v_left, 'total', v_total);
END; $$;

-- ── CHANGE QUANTITY: update the row, reprice (which rebuilds the ticket). ──
CREATE OR REPLACE FUNCTION lfh_staff_edit_item_qty(p_item uuid, p_qty int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item   order_items;
  v_order  orders;
  v_qty    int;
  v_total  numeric;
BEGIN
  SELECT * INTO v_item FROM order_items WHERE id = p_item;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'item_not_found'); END IF;
  SELECT * INTO v_order FROM orders WHERE id = v_item.order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;
  IF v_order.payment_status = 'paid' AND v_order.status <> 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_paid');
  END IF;
  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_cancelled');
  END IF;

  v_qty := GREATEST(1, LEAST(99, COALESCE(p_qty, 1)));
  UPDATE order_items SET qty = v_qty WHERE id = p_item;       -- target row by unique id
  v_total := lfh_reprice_order(v_order.id);                  -- recompute money + rebuild ticket
  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'qty', v_qty, 'total', v_total);
END; $$;

-- ── EDIT NOTE: update the row, then rebuild the ticket (note on the RIGHT line). ──
CREATE OR REPLACE FUNCTION lfh_staff_edit_item_note(p_item uuid, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item   order_items;
  v_order  orders;
  v_note   text;
BEGIN
  SELECT * INTO v_item FROM order_items WHERE id = p_item;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'item_not_found'); END IF;
  SELECT * INTO v_order FROM orders WHERE id = v_item.order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;
  IF v_order.payment_status = 'paid' AND v_order.status <> 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_paid');
  END IF;
  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_cancelled');
  END IF;

  v_note := NULLIF(left(COALESCE(p_note, ''), 300), '');
  UPDATE order_items SET note = v_note WHERE id = p_item;     -- target row by unique id
  PERFORM lfh_sync_order_items_json(v_order.id);             -- rebuild ticket (note on the right line)
  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'note', v_note);
END; $$;

-- ── ADD A DISH: price it, insert order_items, reprice (which rebuilds the ticket). ──
CREATE OR REPLACE FUNCTION lfh_staff_add_item_to_order(p_order uuid, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order   orders;
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

  v_priced := lfh_price_order(p_items);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_priced->'items') LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note, status)
      VALUES (v_order.id, v_order.session_id,
        COALESCE(v_item->>'title', ''),
        COALESCE((v_item->>'qty')::int, 1),
        COALESCE((v_item->>'price')::numeric, 0),
        v_item->'options',
        CASE WHEN jsonb_typeof(v_item->'removed') = 'array'
             THEN COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(v_item->'removed') x), '{}')
             ELSE '{}' END,
        v_item->>'note', 'received');
  END LOOP;

  v_total := lfh_reprice_order(v_order.id);                  -- recompute money + rebuild ticket
  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'total', v_total);
END; $$;

-- LOCK IT DOWN (project rule — new/replaced functions are PUBLIC-executable by default).
REVOKE ALL ON FUNCTION lfh_sync_order_items_json(uuid)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_reprice_order(uuid)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_delete_order_item(uuid)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_staff_edit_item_qty(uuid, int)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_staff_edit_item_note(uuid, text)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_staff_add_item_to_order(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_sync_order_items_json(uuid)         TO service_role;
GRANT EXECUTE ON FUNCTION lfh_reprice_order(uuid)                 TO service_role;
GRANT EXECUTE ON FUNCTION lfh_delete_order_item(uuid)             TO service_role;
GRANT EXECUTE ON FUNCTION lfh_staff_edit_item_qty(uuid, int)      TO service_role;
GRANT EXECUTE ON FUNCTION lfh_staff_edit_item_note(uuid, text)    TO service_role;
GRANT EXECUTE ON FUNCTION lfh_staff_add_item_to_order(uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
