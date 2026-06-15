-- PER-DISH DELETE (manager) — remove ONE order_item and keep the bill honest.
--
-- WHY a server RPC (not a plain DELETE from the browser):
--   orders.total is a STORED, server-priced number (see migration 029). If the
--   manager deletes one dish, that stored total must be RE-COMPUTED from whatever
--   dishes remain, or the bill would still charge for the removed dish. Money must
--   never be edited client-side, so the whole delete + reconcile happens here, in
--   ONE transaction, on the server.
--
-- WHAT it does, given an order_items.id:
--   1) find the row, remember its parent order
--   2) delete that one order_item
--   3) recompute the order's subtotal from the REMAINING order_items
--      (unit_price * qty — the same per-unit price the server stored at order time)
--   4) tax = 5% of subtotal (mirrors lfh_price_order's v_rate = 0.05), total = subtotal + tax
--   5) keep orders.items (the JSONB ticket the kitchen/printout reads) in sync by
--      dropping the FIRST matching line (same title + qty) — best-effort, since the
--      authoritative money now comes from order_items
--   6) if NO dishes are left, cancel the order (status='cancelled', zero the money)
--      rather than leaving a ghost ₹0 order on the bill
--
-- SAFETY: refuses to touch an order that's already PAID (a financial record) or
-- cancelled — matches the existing "won't delete a paid bill" guard in the API.

CREATE OR REPLACE FUNCTION lfh_delete_order_item(p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item    order_items;     -- the dish being removed
  v_order   orders;          -- its parent order
  v_sub     numeric := 0;    -- recomputed subtotal from the survivors
  v_tax     numeric;
  v_total   numeric;
  v_left    int;             -- how many dishes remain after the delete
  v_rate    numeric := 0.05; -- 5% — same rate lfh_price_order uses
  v_items   jsonb;           -- the rebuilt orders.items ticket (one line dropped)
  v_dropped boolean := false;-- have we already removed the matching JSONB line?
  v_line    jsonb;
BEGIN
  -- 1) Find the order_item and its order.
  SELECT * INTO v_item FROM order_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'item_not_found');
  END IF;
  SELECT * INTO v_order FROM orders WHERE id = v_item.order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  -- A paid bill is a money record — never silently alter it. Cancelled orders
  -- have nothing left to bill. Both are refused (the UI shouldn't offer delete
  -- here anyway, but the server is the real guard).
  IF v_order.payment_status = 'paid' AND v_order.status <> 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_paid');
  END IF;

  -- 2) Delete just this one dish.
  DELETE FROM order_items WHERE id = p_item_id;

  -- 3) Recompute the subtotal from the dishes that SURVIVE.
  SELECT COALESCE(SUM(unit_price * qty), 0), COUNT(*)
    INTO v_sub, v_left
    FROM order_items WHERE order_id = v_order.id;

  -- 6) No dishes left → cancel the order so no empty ₹0 line lingers on the bill.
  IF v_left = 0 THEN
    UPDATE orders
       SET status = 'cancelled', subtotal = 0, tax = 0, total = 0, items = '[]'::jsonb
     WHERE id = v_order.id;
    RETURN jsonb_build_object('ok', true, 'order_id', v_order.id,
                              'order_cancelled', true, 'items_left', 0, 'total', 0);
  END IF;

  -- 4) Tax + total from the new subtotal.
  v_tax   := round(v_sub * v_rate, 2);
  v_total := v_sub + v_tax;

  -- 5) Keep orders.items (the JSONB ticket) in sync: drop the FIRST line whose
  --    title + qty match the deleted dish. Best-effort — order_items is now the
  --    source of truth for money, but the printout/KOT still read orders.items.
  v_items := '[]'::jsonb;
  IF jsonb_typeof(v_order.items) = 'array' THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_order.items) LOOP
      IF NOT v_dropped
         AND COALESCE(v_line->>'title', '') = COALESCE(v_item.title, '')
         AND COALESCE((v_line->>'qty')::int, 1) = COALESCE(v_item.qty, 1) THEN
        v_dropped := true;        -- skip exactly one matching line
      ELSE
        v_items := v_items || v_line;
      END IF;
    END LOOP;
  END IF;

  UPDATE orders
     SET subtotal = v_sub, tax = v_tax, total = v_total, items = v_items
   WHERE id = v_order.id;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id,
                            'order_cancelled', false, 'items_left', v_left, 'total', v_total);
END; $$;

-- LOCK IT DOWN (project rule — new functions are PUBLIC-executable by default).
-- Only the service-role server (the editor API) may call this; never anon/guests.
REVOKE ALL ON FUNCTION lfh_delete_order_item(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_delete_order_item(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
