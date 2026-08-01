-- 251 — NOTHING IS REMOVED WITHOUT A REASON, AND EVERY REMOVAL IS FINDABLE (owner, 2026-08-01)
--
-- "Make sure every KOT which has been deleted, every item, it's been deleted from the menu and all
--  that stuff — it should ask for the reason. And there should be a quick toggle where you just
--  click 'by mistake' … and all that record will be in the audit section. From which bill, which
--  item was related, which KOT was related. All that stuff. Even if it is done by manager."
--
-- This is the compliant direction, deliberately: the app already cannot hard-delete a sale, and this
-- makes every REMOVAL — a cancelled ticket, a dish taken off an order, a dish taken off the menu, a
-- voided invoice — carry a stated reason and a permanent record naming the person. Nothing here can
-- hide anything; it only adds evidence.
CREATE TABLE IF NOT EXISTS deletion_audit (
  id            bigserial PRIMARY KEY,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  at            timestamptz NOT NULL DEFAULT NOW(),
  -- WHAT was removed
  kind          text NOT NULL,     -- 'order_cancelled'|'order_deleted'|'dish_removed'|'menu_item_deleted'|'invoice_voided'
  -- WHY, in two parts: a code from the quick buttons, and free text when they typed one
  reason_code   text,              -- 'mistake'|'guest_changed'|'wrong_table'|'sold_out'|'kitchen_error'|'other'
  reason_note   text,
  -- WHO (no role is exempt — a manager's removal is recorded exactly like anyone else's)
  actor         text,
  actor_id      uuid,
  actor_role    text,
  device_id     text,
  -- WHICH bill / ticket / dish it related to, so a record can be found from any of them
  table_number  text,
  session_id    uuid,
  bill_no       integer,
  invoice_no    text,
  order_id      uuid,
  kot_no        integer,
  item_id       uuid,
  item_title    text,
  qty           integer,
  amount        numeric(12,2),
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS deletion_audit_by_restaurant ON deletion_audit(restaurant_id, at DESC);
CREATE INDEX IF NOT EXISTS deletion_audit_by_kot ON deletion_audit(restaurant_id, kot_no) WHERE kot_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS deletion_audit_by_bill ON deletion_audit(restaurant_id, bill_no) WHERE bill_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS deletion_audit_by_actor ON deletion_audit(restaurant_id, actor);

COMMENT ON TABLE deletion_audit IS
  'Every removal in the product with the reason given and the person who did it: cancelled tickets, '
  'dishes taken off an order, dishes taken off the menu, voided invoices. Append-only by convention '
  '- nothing in the app deletes from it. Owner 2026-08-01.';

ALTER TABLE deletion_audit ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='deletion_audit' AND policyname='deletion_audit_service') THEN
    CREATE POLICY deletion_audit_service ON deletion_audit FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- One writer, so every call site records the same shape. Context that can be derived (the bill
-- number, the KOT number, the table) is looked up HERE rather than trusted from the browser.
CREATE OR REPLACE FUNCTION lfh_record_removal(
  p_rid uuid, p_kind text, p_reason_code text, p_reason_note text,
  p_actor text, p_actor_id uuid, p_actor_role text, p_device text,
  p_order uuid DEFAULT NULL, p_item uuid DEFAULT NULL, p_item_title text DEFAULT NULL,
  p_qty integer DEFAULT NULL, p_amount numeric DEFAULT NULL, p_table text DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_o orders; v_s sessions; v_id bigint;
BEGIN
  IF p_order IS NOT NULL THEN
    SELECT * INTO v_o FROM orders WHERE id = p_order AND restaurant_id = p_rid;
    IF v_o.session_id IS NOT NULL THEN SELECT * INTO v_s FROM sessions WHERE id = v_o.session_id; END IF;
  END IF;
  INSERT INTO deletion_audit(restaurant_id, kind, reason_code, reason_note, actor, actor_id, actor_role,
    device_id, table_number, session_id, bill_no, invoice_no, order_id, kot_no, item_id, item_title, qty, amount, meta)
  VALUES (p_rid, p_kind, NULLIF(p_reason_code,''), NULLIF(p_reason_note,''), p_actor, p_actor_id, p_actor_role,
    p_device, COALESCE(p_table, v_o.table_number), v_o.session_id, v_s.bill_no, v_s.invoice_no,
    p_order, v_o.kot_no, p_item, p_item_title, p_qty,
    COALESCE(p_amount, CASE WHEN p_item IS NULL THEN v_o.total END), COALESCE(p_meta,'{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION lfh_record_removal(uuid,text,text,text,text,uuid,text,text,uuid,uuid,text,integer,numeric,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_record_removal(uuid,text,text,text,text,uuid,text,text,uuid,uuid,text,integer,numeric,text,jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
