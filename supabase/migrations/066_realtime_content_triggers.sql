-- 066_realtime_content_triggers.sql  (Realtime Stage 2 — Phase 3: content + gaps)
--
-- Closes the live-sync gaps found in the action audit:
--  * menu_items / categories / filters / settings → emit on a NEW 'menu' topic
--    (staff AND guests subscribe to 'menu'; guests do NOT get the 'ops' firehose).
--  * blocklist → emit on 'ops' (staff-only).
--  * sessions trigger: add auto_approve to the watched columns (was silently excluded).
-- Content/blocklist breadcrumbs carry entity_id = NULL on purpose: clients refetch
-- wholesale and never read entity_id, and categories/filters have no `id` column.

CREATE OR REPLACE FUNCTION lfh_rt_emit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  k text;
  eid text;
  tn text;
  topic_name text;
BEGIN
  r := COALESCE(NEW, OLD);
  topic_name := 'ops';  -- default for operational tables
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
  ELSIF TG_TABLE_NAME = 'blocklist' THEN
    k := 'block'; eid := NULL; tn := NULL;             -- ops topic, staff-only
  ELSIF TG_TABLE_NAME = 'menu_items' THEN
    k := 'menu_item'; eid := NULL; tn := NULL; topic_name := 'menu';
  ELSIF TG_TABLE_NAME = 'categories' THEN
    k := 'category'; eid := NULL; tn := NULL; topic_name := 'menu';
  ELSIF TG_TABLE_NAME = 'filters' THEN
    k := 'filter'; eid := NULL; tn := NULL; topic_name := 'menu';
  ELSIF TG_TABLE_NAME = 'settings' THEN
    k := 'settings'; eid := NULL; tn := NULL; topic_name := 'menu';
  ELSE
    k := TG_TABLE_NAME; eid := r.id::text; tn := NULL;
  END IF;

  INSERT INTO realtime_events(topic, kind, entity_id, table_number)
    VALUES (topic_name, k, eid, tn);
  IF tn IS NOT NULL THEN
    INSERT INTO realtime_events(topic, kind, entity_id, table_number)
      VALUES ('table:' || tn, k, eid, tn);
  END IF;

  IF random() < 0.01 THEN PERFORM lfh_rt_prune(); END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION lfh_rt_emit() FROM PUBLIC, anon, authenticated;

-- Sessions: re-create trigger WITH auto_approve added to the watched columns.
DROP TRIGGER IF EXISTS rt_emit_sessions ON sessions;
CREATE TRIGGER rt_emit_sessions
  AFTER INSERT OR DELETE OR UPDATE OF status, cart, cart_updated_at, bill_no, invoice_no, auto_approve ON sessions
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

-- New content triggers → 'menu' topic.
DROP TRIGGER IF EXISTS rt_emit_menu_items ON menu_items;
CREATE TRIGGER rt_emit_menu_items AFTER INSERT OR UPDATE OR DELETE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

DROP TRIGGER IF EXISTS rt_emit_categories ON categories;
CREATE TRIGGER rt_emit_categories AFTER INSERT OR UPDATE OR DELETE ON categories
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

DROP TRIGGER IF EXISTS rt_emit_filters ON filters;
CREATE TRIGGER rt_emit_filters AFTER INSERT OR UPDATE OR DELETE ON filters
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

DROP TRIGGER IF EXISTS rt_emit_settings ON settings;
CREATE TRIGGER rt_emit_settings AFTER INSERT OR UPDATE OR DELETE ON settings
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

-- Blocklist → 'ops' topic (staff-only).
DROP TRIGGER IF EXISTS rt_emit_blocklist ON blocklist;
CREATE TRIGGER rt_emit_blocklist AFTER INSERT OR UPDATE OR DELETE ON blocklist
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

NOTIFY pgrst, 'reload schema';
