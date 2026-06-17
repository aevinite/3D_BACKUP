-- STAFF EDIT-AFTER-CONFIRM (manager + tablet) — change a dish's quantity, edit a
-- dish's note, or ADD a dish to an order that's ALREADY been placed/confirmed.
--
-- WHY server RPCs (not client writes): orders.total is a STORED, server-priced
-- number (migration 029). Any change to the dishes must RE-PRICE the bill on the
-- server, in one transaction, or the printed bill would be wrong. Money is never
-- edited client-side. These mirror lfh_delete_order_item (062) for the reconcile
-- and lfh_staff_place_order (049) / lfh_price_order (031) for the add+pricing.
--
-- The 2-step "kitchen says it's still editable?" confirm lives in the UI; these
-- functions are the money-safe primitives behind it. (owner, 2026-06-17)
--
-- SAFETY: every function refuses a PAID bill (a financial record) and a cancelled
-- order. Allergy add/remove + per-dish delete already exist (orders/:id/allergies
-- + lfh_delete_order_item) and are reused, not duplicated.

-- Shared helper: recompute one order's subtotal/tax/total from its order_items
-- (the authoritative, server-priced rows) and roll up its coarse status.
CREATE OR REPLACE FUNCTION lfh_reprice_order(p_order uuid)
RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE
  v_sub   numeric := 0;
  v_rate  numeric := 0.05;   -- 5% — same rate lfh_price_order / 062 use
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
  RETURN v_sub + round(v_sub * v_rate, 2);
END; $$;

-- ── 1) CHANGE QUANTITY ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lfh_staff_edit_item_qty(p_item uuid, p_qty int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item   order_items;
  v_order  orders;
  v_qty    int;
  v_old    int;
  v_items  jsonb := '[]'::jsonb;
  v_done   boolean := false;
  v_line   jsonb;
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

  v_qty := GREATEST(1, LEAST(99, COALESCE(p_qty, 1))); -- clamp 1..99
  v_old := COALESCE(v_item.qty, 1);
  UPDATE order_items SET qty = v_qty WHERE id = p_item;

  -- Keep the orders.items JSONB ticket (KOT/printout) in sync, best-effort: bump
  -- the FIRST line matching this dish's title + old qty to the new qty.
  IF jsonb_typeof(v_order.items) = 'array' THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_order.items) LOOP
      IF NOT v_done
         AND COALESCE(v_line->>'title', '') = COALESCE(v_item.title, '')
         AND COALESCE((v_line->>'qty')::int, 1) = v_old THEN
        v_items := v_items || (v_line || jsonb_build_object('qty', v_qty));
        v_done := true;
      ELSE
        v_items := v_items || v_line;
      END IF;
    END LOOP;
    UPDATE orders SET items = v_items WHERE id = v_order.id;
  END IF;

  v_total := lfh_reprice_order(v_order.id);
  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'qty', v_qty, 'total', v_total);
END; $$;

-- ── 2) EDIT NOTE ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lfh_staff_edit_item_note(p_item uuid, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item   order_items;
  v_order  orders;
  v_note   text;
  v_items  jsonb := '[]'::jsonb;
  v_done   boolean := false;
  v_line   jsonb;
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

  v_note := NULLIF(left(COALESCE(p_note, ''), 300), ''); -- trim cap; empty → NULL
  UPDATE order_items SET note = v_note WHERE id = p_item;

  -- Sync the KOT ticket's first matching line (by title), best-effort. No money change.
  IF jsonb_typeof(v_order.items) = 'array' THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_order.items) LOOP
      IF NOT v_done AND COALESCE(v_line->>'title', '') = COALESCE(v_item.title, '') THEN
        v_items := v_items || (v_line || jsonb_build_object('note', v_note));
        v_done := true;
      ELSE
        v_items := v_items || v_line;
      END IF;
    END LOOP;
    UPDATE orders SET items = v_items WHERE id = v_order.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'note', v_note);
END; $$;

-- ── 3) ADD A DISH to an already-placed order ─────────────────────────────────
-- p_items is a one-line jsonb array [{id, qty, options, removed, note}] — the
-- SAME shape lfh_price_order/place_order take. We price it on the server, insert
-- the new order_items row(s), append to the KOT ticket, then re-price the order.
CREATE OR REPLACE FUNCTION lfh_staff_add_item_to_order(p_order uuid, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order   orders;
  v_priced  jsonb;
  v_item    jsonb;
  v_items   jsonb;
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

  -- Price exactly like a guest/staff order (rejects unknown/sold-out, server price).
  v_priced := lfh_price_order(p_items);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced; END IF;

  -- Insert each priced line as a NEW order_item ('received' — kitchen hasn't made it).
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

  -- Append the new line(s) to the KOT ticket (orders.items), each marked received.
  v_items := CASE WHEN jsonb_typeof(v_order.items) = 'array' THEN v_order.items ELSE '[]'::jsonb END;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_priced->'items') LOOP
    v_items := v_items || (v_item || jsonb_build_object('status', 'received'));
  END LOOP;
  UPDATE orders SET items = v_items WHERE id = v_order.id;

  v_total := lfh_reprice_order(v_order.id);
  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'total', v_total);
END; $$;

-- LOCK IT DOWN (project rule — new functions are PUBLIC-executable by default).
-- Only the service-role server (the editor/tablet APIs) may call these.
REVOKE ALL ON FUNCTION lfh_reprice_order(uuid)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_staff_edit_item_qty(uuid, int)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_staff_edit_item_note(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_staff_add_item_to_order(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_reprice_order(uuid)              TO service_role;
GRANT EXECUTE ON FUNCTION lfh_staff_edit_item_qty(uuid, int)   TO service_role;
GRANT EXECUTE ON FUNCTION lfh_staff_edit_item_note(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION lfh_staff_add_item_to_order(uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
