-- 115_allergen_edit_any_status.sql
--
-- Owner (2026-07-03): "there is no edit option in bill — why? it should be for ALL
-- items, allergy can be added to any item." The Bills view (openBillModal) had no
-- edit affordance at all, and even in the Tables view a dish's allergen/note edit
-- was blocked the moment it hit READY/SERVED or the bill was PAID — inherited from
-- the SAME guard used for quantity edits. Quantity genuinely must stay blocked once
-- served/paid (it re-prices the bill — you can't un-serve part of a dish). Allergen
-- notes and kitchen notes are pure metadata: they never touch total/subtotal/tax, so
-- there's no money-integrity reason to block them. Loosen ONLY those two.
--
-- Still blocked: a CANCELLED order (nothing was ever served — nothing to annotate).
-- Still blocked (unchanged, separate function): lfh_staff_edit_item_qty.

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
  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_cancelled');
  END IF;

  v_note := NULLIF(left(COALESCE(p_note, ''), 300), '');
  UPDATE order_items SET note = v_note WHERE id = p_item;     -- target row by unique id
  PERFORM lfh_sync_order_items_json(v_order.id);              -- rebuild ticket (note on the right line)
  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'note', v_note);
END; $$;

REVOKE EXECUTE ON FUNCTION lfh_staff_edit_item_note(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_staff_edit_item_note(uuid, text) TO service_role;
