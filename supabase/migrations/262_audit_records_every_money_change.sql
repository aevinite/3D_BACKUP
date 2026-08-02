-- 262 — EVERY CHANGE THAT LOWERS A BILL LEAVES A RECORD IN THE AUDIT (owner, 2026-08-02)
--
-- "Delete a particular item, delete a particular KOT, delete a bill … another thing will be
--  reopening the bill. It should also show in the log and whatever the changes that previously it
--  was there and he has made. Even though it is a discount and all that. In the audit section,
--  everything should be there."
--
-- WHAT WAS ACTUALLY WRONG (found by driving the real panel on Aangan Garden, 2026-08-02).
-- Migration 251 built the record and named five kinds. Only TWO were ever written —
-- 'order_cancelled' and 'order_deleted' — and both were written by the BROWSER (app.js called
-- POST /audit after the action). So:
--   · removing one dish from an order recorded nothing (the owner asked for this by name);
--   · reopening a bill recorded nothing in the audit (asked for by name);
--   · deleting a dish from the menu recorded nothing, though 251's own comment promised it;
--   · reducing a quantity — which lowers the bill exactly like removing a dish — recorded nothing;
--   · a discount, a reverted payment and an on-the-house settle recorded nothing;
--   · the WAITER panel recorded nothing at all, for anything.
-- Recording from the browser is the root cause: any panel that forgets is a silent hole, and one
-- panel had forgotten entirely. From now on the SERVER records, inside the endpoint that makes the
-- change, so every caller — manager, waiter, admin, an offline replay, a panel built later — is
-- covered by construction.
--
-- Nothing here can hide anything: it only adds evidence, and it adds it in the one place a person
-- looks. `kind` has no CHECK constraint (251 listed the kinds in a comment only), so the new kinds
-- below need no schema change — but the recorder needs to accept a SESSION, because reopening a
-- bill and settling on the house are session events with no single order behind them.
--
-- NEW KINDS written from today (all shown by the panels' Removals view):
--   'dish_removed'      one dish taken off a live order            (was named, never written)
--   'qty_reduced'       a dish's quantity lowered on a live order  (new — same money effect)
--   'menu_item_deleted' a dish/category/tag taken off the menu     (was named, never written)
--   'invoice_voided'    a settled bill reopened for edits          (was named, never written)
--   'discount_given'    money taken off a bill                     (new)
--   'payment_reverted'  a bill marked paid, then un-marked         (new)
--   'on_the_house'      a bill settled with no money collected     (new)

-- One writer, one shape. Replaced (not overloaded) so there is never an ambiguous candidate:
-- PostgREST calls it with NAMED arguments, so adding a defaulted parameter keeps every existing
-- caller working. (An overload would have produced "could not choose the best candidate function".)
DROP FUNCTION IF EXISTS lfh_record_removal(uuid,text,text,text,text,uuid,text,text,uuid,uuid,text,integer,numeric,text,jsonb);

CREATE OR REPLACE FUNCTION lfh_record_removal(
  p_rid uuid, p_kind text, p_reason_code text, p_reason_note text,
  p_actor text, p_actor_id uuid, p_actor_role text, p_device text,
  p_order uuid DEFAULT NULL, p_item uuid DEFAULT NULL, p_item_title text DEFAULT NULL,
  p_qty integer DEFAULT NULL, p_amount numeric DEFAULT NULL, p_table text DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb,
  -- NEW: the bill this relates to when there is no single order behind it (reopening a bill,
  -- settling on the house). Either may be given; the order wins for the fields both can fill.
  p_session uuid DEFAULT NULL
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_o orders; v_s sessions; v_id bigint;
BEGIN
  IF p_order IS NOT NULL THEN
    SELECT * INTO v_o FROM orders WHERE id = p_order AND restaurant_id = p_rid;
    IF v_o.session_id IS NOT NULL THEN SELECT * INTO v_s FROM sessions WHERE id = v_o.session_id; END IF;
  END IF;
  -- A session given directly (or one we haven't resolved through an order yet). Scoped to the
  -- restaurant, so a stray id can never pull another restaurant's bill number into a record.
  IF v_s.id IS NULL AND p_session IS NOT NULL THEN
    SELECT * INTO v_s FROM sessions WHERE id = p_session AND restaurant_id = p_rid;
  END IF;
  INSERT INTO deletion_audit(restaurant_id, kind, reason_code, reason_note, actor, actor_id, actor_role,
    device_id, table_number, session_id, bill_no, invoice_no, order_id, kot_no, item_id, item_title, qty, amount, meta)
  VALUES (p_rid, p_kind, NULLIF(p_reason_code,''), NULLIF(p_reason_note,''), p_actor, p_actor_id, p_actor_role,
    p_device, COALESCE(p_table, v_o.table_number, v_s.table_number), COALESCE(v_o.session_id, v_s.id),
    v_s.bill_no, v_s.invoice_no,
    p_order, v_o.kot_no, p_item, p_item_title, p_qty,
    -- An explicit amount always wins. Otherwise: a whole-order removal is worth the order's total;
    -- a single dish's worth is passed in by the caller (the row is gone by the time we look).
    COALESCE(p_amount, CASE WHEN p_item IS NULL THEN v_o.total END), COALESCE(p_meta,'{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION lfh_record_removal(uuid,text,text,text,text,uuid,text,text,uuid,uuid,text,integer,numeric,text,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_record_removal(uuid,text,text,text,text,uuid,text,text,uuid,uuid,text,integer,numeric,text,jsonb,uuid) TO service_role;

COMMENT ON FUNCTION lfh_record_removal(uuid,text,text,text,text,uuid,text,text,uuid,uuid,text,integer,numeric,text,jsonb,uuid) IS
  'The ONE writer for deletion_audit. Called from the server inside the endpoint that makes the '
  'change - never from a browser - so every panel and every replay is recorded by construction. '
  'Accepts an order OR a session; derives table/bill/invoice/KOT itself. Owner 2026-08-02.';

NOTIFY pgrst, 'reload schema';
