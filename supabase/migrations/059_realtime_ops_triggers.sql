-- 059_realtime_ops_triggers.sql  (Realtime Stage 2 — Phase 2: the rest of ops)
--
-- Extend the breadcrumb emitter to waiter_calls, sessions, session_members and
-- requests so staff panels (and the relevant guests) update the instant ANY of
-- these change — not just orders. Same pattern: emit on 'ops' + 'table:<n>'.

CREATE OR REPLACE FUNCTION lfh_rt_emit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  k text;
  eid text;
  tn text;
BEGIN
  r := COALESCE(NEW, OLD);
  IF TG_TABLE_NAME = 'orders' THEN
    k := 'order'; eid := r.id::text; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'order_items' THEN
    k := 'order_item'; eid := r.order_id::text;
    SELECT o.table_number INTO tn FROM orders o WHERE o.id = r.order_id;
  ELSIF TG_TABLE_NAME = 'waiter_calls' THEN
    k := 'call'; eid := r.id::text; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'sessions' THEN
    k := 'session'; eid := r.id::text; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'requests' THEN
    k := 'request'; eid := r.id::text; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'session_members' THEN
    k := 'member'; eid := r.id::text;
    SELECT s.table_number INTO tn FROM sessions s WHERE s.id = r.session_id;
  ELSE
    k := TG_TABLE_NAME; eid := r.id::text; tn := NULL;
  END IF;

  INSERT INTO realtime_events(topic, kind, entity_id, table_number) VALUES ('ops', k, eid, tn);
  IF tn IS NOT NULL THEN
    INSERT INTO realtime_events(topic, kind, entity_id, table_number) VALUES ('table:' || tn, k, eid, tn);
  END IF;

  IF random() < 0.01 THEN PERFORM lfh_rt_prune(); END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION lfh_rt_emit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rt_emit_calls ON waiter_calls;
CREATE TRIGGER rt_emit_calls AFTER INSERT OR UPDATE OR DELETE ON waiter_calls
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

-- Sessions: fire only on meaningful columns (NOT a heartbeat like last_activity_at),
-- so a busy session can't spam breadcrumbs. cart/cart_updated_at cover the shared cart.
DROP TRIGGER IF EXISTS rt_emit_sessions ON sessions;
CREATE TRIGGER rt_emit_sessions
  AFTER INSERT OR DELETE OR UPDATE OF status, cart, cart_updated_at, bill_no, invoice_no ON sessions
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

DROP TRIGGER IF EXISTS rt_emit_members ON session_members;
CREATE TRIGGER rt_emit_members AFTER INSERT OR UPDATE OR DELETE ON session_members
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

DROP TRIGGER IF EXISTS rt_emit_requests ON requests;
CREATE TRIGGER rt_emit_requests AFTER INSERT OR UPDATE OR DELETE ON requests
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

NOTIFY pgrst, 'reload schema';
