-- 388 — an order cancelled by emptying its ticket now records WHEN it was cancelled
-- (sweep #9, terminal 30, ROUND 2 — found by phase P149402)
--
-- WHAT WAS WRONG. Two live functions cancel an order and never stamp `orders.cancelled_at`:
--
--     lfh_delete_order_item      a waiter removes the last dish from a ticket
--     lfh_staff_move_order_item  a waiter moves the last dish to another table
--
-- Both end with `UPDATE orders SET status = 'cancelled', subtotal = 0, … WHERE id = …` and no
-- time. `cancelled_at` is migration 112's column, and its own three siblings already do this
-- correctly — `lfh_session_close_cleanup`, `lfh_session_delete_cleanup` and
-- `lfh_session_insert_closed_cleanup` all write `cancelled_at = COALESCE(cancelled_at, NOW())`,
-- and the trigger `lfh_order_joins_closed_session` does the same. The convention existed; these
-- two did not follow it.
--
-- MEASURED on the dev stack 2026-09-15: **24 of September's 166 cancellations carry no time** —
-- about one in seven, and still happening today, not a historical gap (the column has been filled
-- since 2026-08-01).
--
-- ═══ WHAT IT ACTUALLY BREAKS — two real wrong numbers, not a tidy-up ═══
--
-- 1. THE OWNER'S MONTHLY REPORT CAN GO STALE. `lfh_owner_report_month_fingerprint` decides whether
--    a cached month needs recomputing with
--        max(greatest(o.created_at, o.edited_at, o.paid_at, o.cancelled_at, o.deleted_at))
--    A cancellation that stamps nothing moves none of those, so the fingerprint does not change and
--    the cached total keeps being served. A waiter empties a ticket; the owner's Reports screen goes
--    on showing the money as if it were still sold.
--
-- 2. A CANCELLED ORDER STILL COUNTS TOWARD A WAITER'S PERFORMANCE. `lfh_staff_performance` decides
--    what counts with `AND deleted_at IS NULL AND cancelled_at IS NULL`. An order cancelled this
--    way has `cancelled_at IS NULL`, so it is still counted for the person who took it — a ticket
--    that was emptied to zero reads as trade they brought in.
--
-- THE FIX IS THE SIBLINGS' OWN SHAPE: `cancelled_at = COALESCE(cancelled_at, NOW())`. COALESCE, not
-- a bare NOW(), so a re-run or a second path cannot move a time that is already recorded — the
-- cancellation keeps the moment it actually happened.
--
-- Both definitions below came out of `pg_get_functiondef()` on the dev database with that one
-- clause added to the one UPDATE that cancels. Nothing else in either body was touched, nothing was
-- re-typed, and the grants are restated exactly as they stand (service_role only, both).
--
-- COST: none — one more column in an UPDATE that was already writing seven.
-- Guarded by `npm run verify:cancel-stamped`.

-- ── lfh_delete_order_item · 1 cancel-UPDATE(s), each now stamping the time ──
CREATE OR REPLACE FUNCTION public.lfh_delete_order_item(p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item    order_items;
  v_order   orders;
  v_sub     numeric := 0;
  v_base    numeric := 0;
  v_nontax  numeric := 0;
  v_mrp     numeric := 0;
  v_tax     numeric;
  v_total   numeric;
  v_left    int;
  v_rate    numeric := 0.05;
BEGIN
  SELECT * INTO v_item FROM order_items WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'item_not_found'); END IF;
  SELECT * INTO v_order FROM orders WHERE id = v_item.order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;

  v_rate := lfh_effective_tax_rate(v_order.restaurant_id);

  IF v_order.payment_status = 'paid' AND v_order.status <> 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_paid');
  END IF;

  DELETE FROM order_items WHERE id = p_item_id;

  SELECT
    COALESCE(SUM(CASE WHEN COALESCE(tax_mode,'excl') = 'exempt' THEN 0
                      WHEN COALESCE(tax_mode,'excl') = 'incl'
                        THEN round(unit_price * qty / (1 + v_rate), 2)
                      ELSE round(unit_price * qty, 2) END), 0),
    COALESCE(SUM(CASE WHEN COALESCE(tax_mode,'excl') = 'exempt'
                        THEN round(unit_price * qty, 2) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN is_mrp THEN round(unit_price * qty, 2) ELSE 0 END), 0),
    COUNT(*)
    INTO v_base, v_nontax, v_mrp, v_left
    FROM order_items WHERE order_id = v_order.id;

  IF v_left = 0 THEN
    UPDATE orders
       SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW()), subtotal = 0, tax = 0, total = 0,
           taxable_base = 0, nontax_amount = 0, mrp_amount = 0, items = '[]'::jsonb
     WHERE id = v_order.id;
    RETURN jsonb_build_object('ok', true, 'order_id', v_order.id,
                              'order_cancelled', true, 'items_left', 0, 'total', 0);
  END IF;

  v_sub   := round(v_base + v_nontax, 2);
  v_tax   := round(v_base * v_rate, 2);
  v_total := round(v_sub + v_tax, 2);
  UPDATE orders SET subtotal = v_sub, tax = v_tax, total = v_total,
                    taxable_base = v_base, nontax_amount = v_nontax, mrp_amount = v_mrp
   WHERE id = v_order.id;
  PERFORM lfh_sync_order_items_json(v_order.id);

  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id,
                            'order_cancelled', false, 'items_left', v_left, 'total', v_total);
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_delete_order_item(p_item_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_delete_order_item(p_item_id uuid) TO service_role;

-- ── lfh_staff_move_order_item · 1 cancel-UPDATE(s), each now stamping the time ──
CREATE OR REPLACE FUNCTION public.lfh_staff_move_order_item(p_item uuid, p_to text, p_rid uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item   order_items;
  v_order  orders;        -- source order (the KOT the line leaves)
  v_src    sessions;      -- source session
  v_target sessions;
  v_new    orders;        -- fresh order (new KOT) on the target
  v_from   text;
  v_to     text;
  v_left   int;
BEGIN
  SELECT * INTO v_item FROM order_items WHERE id = p_item AND restaurant_id = p_rid;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'item_not_found'); END IF;
  SELECT * INTO v_order FROM orders WHERE id = v_item.order_id AND restaurant_id = p_rid;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'order_not_found'); END IF;
  IF v_order.payment_status = 'paid' THEN RETURN json_build_object('ok', false, 'reason', 'order_paid'); END IF;
  IF v_order.status = 'cancelled' THEN RETURN json_build_object('ok', false, 'reason', 'order_cancelled'); END IF;
  IF p_to !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'reason', 'bad_table'); END IF;
  -- A JOINED TABLE MEANS ITS PARTY'S BILL (mig 264) — see lfh_staff_move_order above.
  v_to := lfh_merge_parent_table(p_rid, p_to);
  IF p_to = v_order.table_number OR v_to = lfh_merge_parent_table(p_rid, v_order.table_number) THEN
    RETURN json_build_object('ok', false, 'reason', 'same_table');
  END IF;
  v_from := v_order.table_number;

  -- Printed-invoice locks on either side (a live invoice total must never drift).
  IF v_order.session_id IS NOT NULL THEN
    SELECT * INTO v_src FROM sessions WHERE id = v_order.session_id AND restaurant_id = p_rid;
    IF FOUND AND v_src.invoice_no IS NOT NULL AND NOT COALESCE(v_src.invoice_voided, false) THEN
      RETURN json_build_object('ok', false, 'reason', 'source_invoiced');
    END IF;
  END IF;
  SELECT * INTO v_target FROM sessions
   WHERE table_number = v_to AND restaurant_id = p_rid AND status <> 'closed'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND AND v_target.invoice_no IS NOT NULL AND NOT COALESCE(v_target.invoice_voided, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'target_invoiced');
  END IF;
  IF NOT FOUND THEN
    INSERT INTO sessions (table_number, status, opened_by, opened_at, restaurant_id)
    VALUES (v_to, 'open', 'waiter', NOW(), p_rid)
    RETURNING * INTO v_target;
  END IF;

  -- Fresh order = fresh KOT number (assigned by the orders INSERT trigger). Its real
  -- totals/status/items-json all come from lfh_reprice_order right after the move.
  -- (T16 7787) the new ticket carries the PHYSICAL table (p_to), not the merge parent — see
  -- lfh_staff_move_order for why.
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
    UPDATE orders SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW()), subtotal = 0, tax = 0, total = 0, items = '[]'::jsonb
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
    ('table:' || v_to,   'order', v_new.id::text, v_to,   p_rid),
    ('ops',              'order', v_new.id::text, v_to,   p_rid),
    ('ops',              'order', v_new.id::text, v_from, p_rid);

  RETURN json_build_object('ok', true, 'from', v_from, 'to', p_to, 'parent_table', v_to,
                           'new_order', v_new.id, 'source_cancelled', v_left = 0,
                           'target_session', v_target.id);
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_staff_move_order_item(p_item uuid, p_to text, p_rid uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_staff_move_order_item(p_item uuid, p_to text, p_rid uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
