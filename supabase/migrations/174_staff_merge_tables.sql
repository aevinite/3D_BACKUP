-- 174_staff_merge_tables.sql (ran on the live DB 2026-07-22 under earlier numbering — same content, renumbered around parallel PRs)
-- MERGE two tables: the party on the source table joins the party on an OCCUPIED
-- target table — one table, ONE bill (PetPooja-style; part of the KOT ▾ menu, mig 172).
-- This is the deliberate complement of lfh_staff_shift_table (mig 096), which REFUSES
-- an occupied target: shift = move to a FREE table, merge = combine with a LIVE party.
--
-- What moves to the target session: orders (+ their order_items), unresolved
-- waiter_calls, session_members (guest phones keep working — their member tokens ride
-- along; the incoming head is demoted to 'guest' if the target already has a head),
-- and the shared cart (concatenated). Whole-bill discounts ADD UP and are re-split
-- over the combined orders (lfh_split_bill_discount, mig 143 — the automatic trigger
-- won't fire because no orders.subtotal changes here). The target keeps its bill_no
-- (inheriting the source's if it never got one); KOT numbers are untouched. The source
-- session then closes. Refused while EITHER side holds a live (non-voided) invoice —
-- a printed total must never drift.
CREATE OR REPLACE FUNCTION lfh_staff_merge_tables(p_session uuid, p_to text, p_rid uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_src    sessions;
  v_target sessions;
  v_from   text;
BEGIN
  SELECT * INTO v_src FROM sessions WHERE id = p_session AND restaurant_id = p_rid;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_session'); END IF;
  IF v_src.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF p_to !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'reason', 'bad_table'); END IF;
  IF p_to = v_src.table_number THEN RETURN json_build_object('ok', false, 'reason', 'same_table'); END IF;
  IF v_src.invoice_no IS NOT NULL AND NOT COALESCE(v_src.invoice_voided, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'source_invoiced');
  END IF;

  SELECT * INTO v_target FROM sessions
   WHERE table_number = p_to AND restaurant_id = p_rid AND status = 'open'
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'target_not_open'); END IF;
  IF v_target.invoice_no IS NOT NULL AND NOT COALESCE(v_target.invoice_voided, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'target_invoiced');
  END IF;
  v_from := v_src.table_number;

  -- Re-home everything the source party owns onto the target session.
  UPDATE orders       SET session_id = v_target.id, table_number = p_to WHERE session_id = p_session;
  UPDATE order_items  SET session_id = v_target.id WHERE session_id = p_session;
  UPDATE waiter_calls SET session_id = v_target.id, table_number = p_to WHERE session_id = p_session AND NOT resolved;
  -- One head per table: if the target already has one, the incoming head joins as a guest.
  IF EXISTS (SELECT 1 FROM session_members WHERE session_id = v_target.id AND role = 'owner' AND NOT removed) THEN
    UPDATE session_members SET role = 'guest' WHERE session_id = p_session AND role = 'owner' AND NOT removed;
  END IF;
  UPDATE session_members SET session_id = v_target.id WHERE session_id = p_session;

  -- One combined bill: discounts add up (re-split below), the cart concatenates,
  -- and the target keeps/inherits a bill number.
  UPDATE sessions SET
    discount = COALESCE(v_target.discount, 0) + COALESCE(v_src.discount, 0),
    discount_note = NULLIF(concat_ws(' · ',
      NULLIF(v_target.discount_note, ''),
      CASE WHEN COALESCE(v_src.discount, 0) > 0
           THEN 'merged from T' || v_from || COALESCE(': ' || NULLIF(v_src.discount_note, ''), '') END), ''),
    cart = COALESCE(v_target.cart, '[]'::jsonb) || COALESCE(v_src.cart, '[]'::jsonb),
    cart_updated_at = CASE WHEN COALESCE(jsonb_array_length(COALESCE(v_src.cart, '[]'::jsonb)), 0) > 0 THEN NOW() ELSE v_target.cart_updated_at END,
    bill_no = COALESCE(v_target.bill_no, v_src.bill_no),
    last_activity_at = NOW()
  WHERE id = v_target.id;
  PERFORM lfh_split_bill_discount(v_target.id);

  -- Close the emptied source session (its calls/orders/members are all gone).
  UPDATE sessions SET status = 'closed', closed_at = NOW(), last_activity_at = NOW() WHERE id = p_session;

  -- Nudge BOTH table topics (guests on either table refetch and follow the merge) AND
  -- BOTH tables on 'ops' (staff panels' targeted refetch) — the mig-096 four-row pattern.
  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id) VALUES
    ('table:' || v_from, 'session', p_session::text, v_from, p_rid),
    ('table:' || p_to,   'session', p_session::text, p_to,   p_rid),
    ('ops',              'session', p_session::text, p_to,   p_rid),
    ('ops',              'session', p_session::text, v_from, p_rid);

  RETURN json_build_object('ok', true, 'from', v_from, 'to', p_to, 'target_session', v_target.id);
END; $$;

REVOKE ALL ON FUNCTION lfh_staff_merge_tables(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_staff_merge_tables(uuid, text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
