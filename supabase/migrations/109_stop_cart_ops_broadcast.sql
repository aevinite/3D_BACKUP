-- 109_stop_cart_ops_broadcast.sql
--
-- PROBLEM: every guest cart edit (add/remove/qty change) debounce-pushes to
-- sessions.cart (SessionCartSync.tsx), which fired the SAME rt_emit_sessions
-- trigger as real staff-relevant changes (status/bill/invoice). lfh_rt_emit()
-- inserts a breadcrumb on BOTH the 'ops' topic (staff panels) AND the guest's
-- own 'table:<n>' topic. The manager/tablet panels only subscribe to 'ops', and
-- on a cart breadcrumb they did a full per-table refetch (/orders + /sessions
-- for that table) just to redraw a "🛒 Building · not sent yet" preview no one
-- reads — pure egress with zero staff value.
--
-- FIX: split the sessions trigger in two.
--   1. rt_emit_sessions keeps firing on the STAFF-relevant columns only (cart
--      and cart_updated_at removed) -> unchanged behaviour for status/bill/
--      invoice/void, still hits both 'ops' and 'table:<n>'.
--   2. A new rt_emit_sessions_cart trigger fires ONLY on cart/cart_updated_at
--      and calls a new lfh_rt_emit_cart() that inserts ONLY the 'table:<n>'
--      breadcrumb (never 'ops'). This preserves instant cross-device cart sync
--      for guests at the same table (RealtimeProvider/SessionCartSync listen on
--      'table:<n>') while staff panels simply never hear about cart edits.
--
-- Additive + safe: no column/table changes, no data touched, easy to revert by
-- restoring the single trigger from migration 096.

DROP TRIGGER IF EXISTS rt_emit_sessions ON sessions;
CREATE TRIGGER rt_emit_sessions
  AFTER INSERT OR DELETE OR UPDATE OF status, bill_no, invoice_no, auto_approve, invoice_voided, void_at ON sessions
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

CREATE OR REPLACE FUNCTION lfh_rt_emit_cart() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  v_rid uuid;
BEGIN
  r := COALESCE(NEW, OLD);
  v_rid := COALESCE(r.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  IF r.table_number IS NOT NULL THEN
    INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id)
      VALUES ('table:' || r.table_number, 'session', r.id::text, r.table_number, v_rid);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS rt_emit_sessions_cart ON sessions;
CREATE TRIGGER rt_emit_sessions_cart
  AFTER UPDATE OF cart, cart_updated_at ON sessions
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit_cart();
