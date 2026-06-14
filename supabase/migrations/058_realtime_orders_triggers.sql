-- 058_realtime_orders_triggers.sql  (Realtime Stage 2 — Phase 1: orders)
--
-- The generic "emit a breadcrumb" trigger function + triggers on orders and
-- order_items. Whenever an order or one of its dishes changes, we drop a tiny row
-- into realtime_events on the 'ops' topic (staff) and, when we know the table, on
-- 'table:<n>' (that table's guests). Devices listening on those topics then
-- refetch through their existing secure path — no more per-second polling.

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
  ELSE
    k := TG_TABLE_NAME; eid := r.id::text; tn := NULL; -- generic fallback for later phases
  END IF;

  -- Staff topic always; guest table topic when a table is known.
  INSERT INTO realtime_events(topic, kind, entity_id, table_number) VALUES ('ops', k, eid, tn);
  IF tn IS NOT NULL THEN
    INSERT INTO realtime_events(topic, kind, entity_id, table_number) VALUES ('table:' || tn, k, eid, tn);
  END IF;

  -- ~1% of the time, prune old breadcrumbs so the table stays tiny.
  IF random() < 0.01 THEN PERFORM lfh_rt_prune(); END IF;

  RETURN NULL; -- AFTER trigger: return value is ignored
END $$;
REVOKE ALL ON FUNCTION lfh_rt_emit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rt_emit_orders ON orders;
CREATE TRIGGER rt_emit_orders AFTER INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

DROP TRIGGER IF EXISTS rt_emit_order_items ON order_items;
CREATE TRIGGER rt_emit_order_items AFTER INSERT OR UPDATE OR DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

NOTIFY pgrst, 'reload schema';
