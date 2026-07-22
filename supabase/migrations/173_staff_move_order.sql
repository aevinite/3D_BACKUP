-- 173_staff_move_order.sql (ran on the live DB 2026-07-22 under earlier numbering — same content, renumbered around parallel PRs)
-- Move ONE order (a KOT) — and its dish rows — to another table, as a single atomic
-- SECURITY DEFINER RPC. This consolidates the tablet route's inline move logic
-- (app/api/tablet/[...path]/route.ts "orders/:id/move") so the editor + tablet share
-- one implementation, and FIXES a live gap: the inline version emitted no breadcrumb
-- for the SOURCE table, so after a move the old table's tile stayed stale for up to
-- 60s on the manager's targeted per-table refetch (the exact class of bug mig 096
-- fixed for whole-party shifts).
--
-- Also new vs the inline version: both sessions get their whole-bill discount
-- re-split (lfh_split_bill_discount, mig 143) — an order left one bill and joined
-- another, and the automatic re-split trigger (mig 143/148) only fires on
-- orders.subtotal changes, which a move never makes.
--
-- p_rid is the caller's authenticated restaurant scope; every row touched is checked
-- against it (service_role bypasses RLS, so this is the tenant boundary).
CREATE OR REPLACE FUNCTION lfh_staff_move_order(p_order uuid, p_to text, p_rid uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_o      orders;
  v_from   text;
  v_src    sessions;      -- source session (may be absent: orders.session_id is nullable)
  v_target sessions;
BEGIN
  SELECT * INTO v_o FROM orders WHERE id = p_order AND restaurant_id = p_rid;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_order'); END IF;
  -- Never re-home a PAID order — it's settled revenue on a closed bill; moving it onto
  -- another party's live bill would double-count / corrupt the money trail.
  IF v_o.payment_status = 'paid' THEN RETURN json_build_object('ok', false, 'reason', 'order_paid'); END IF;
  IF p_to !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'reason', 'bad_table'); END IF;
  IF p_to = v_o.table_number THEN RETURN json_build_object('ok', false, 'reason', 'same_table'); END IF;
  v_from := v_o.table_number;

  -- Don't pull an order OFF a bill whose invoice is already generated (and not voided):
  -- the guest holds a printed invoice that would now overstate the total. Same rule for
  -- the target side below. A voided invoice never blocks (it's being re-billed anyway).
  IF v_o.session_id IS NOT NULL THEN
    SELECT * INTO v_src FROM sessions WHERE id = v_o.session_id AND restaurant_id = p_rid;
    IF FOUND AND v_src.invoice_no IS NOT NULL AND NOT COALESCE(v_src.invoice_voided, false) THEN
      RETURN json_build_object('ok', false, 'reason', 'source_invoiced');
    END IF;
  END IF;

  -- Find (or open) the target table's session, then re-home the order onto it.
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

  UPDATE orders      SET table_number = p_to, session_id = v_target.id WHERE id = p_order;
  UPDATE order_items SET session_id = v_target.id WHERE order_id = p_order;

  -- The target now has an order, so make sure it has a bill number (the bill trigger
  -- only fires on session INSERT, not on this move — assign it if missing).
  IF v_target.bill_no IS NULL THEN
    UPDATE sessions SET bill_no = lfh_next_counter(p_rid, 'bill')
     WHERE id = v_target.id AND bill_no IS NULL;
  END IF;

  -- Re-split each side's whole-bill discount over its (new) set of orders.
  IF v_src.id IS NOT NULL THEN PERFORM lfh_split_bill_discount(v_src.id); END IF;
  PERFORM lfh_split_bill_discount(v_target.id);

  -- Nudge BOTH table topics (guests) AND BOTH tables on 'ops' (staff panels' targeted
  -- refetch) so the OLD table's ticket disappears and the NEW table's appears — the
  -- mig-096 four-row pattern.
  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id) VALUES
    ('table:' || v_from, 'order', p_order::text, v_from, p_rid),
    ('table:' || p_to,   'order', p_order::text, p_to,   p_rid),
    ('ops',              'order', p_order::text, p_to,   p_rid),
    ('ops',              'order', p_order::text, v_from, p_rid);

  RETURN json_build_object('ok', true, 'from', v_from, 'to', p_to, 'target_session', v_target.id);
END; $$;

REVOKE ALL ON FUNCTION lfh_staff_move_order(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_staff_move_order(uuid, text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
