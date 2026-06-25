-- 086_scope_realtime_breadcrumbs.sql  (Tenancy — realtime breadcrumbs)
--
-- PROBLEM: the breadcrumb emitters (lfh_rt_emit, lfh_rt_emit_platform) INSERT
-- rows into realtime_events WITHOUT a restaurant_id, so every breadcrumb
-- defaults to restaurant #1 (the DEFAULT added in 078). Once a 2nd restaurant
-- exists you can no longer tell whose change a breadcrumb described.
--
-- FIX: stamp each breadcrumb with the changed row's restaurant_id. Every table
-- these triggers fire on gained restaurant_id in 078 (and r := COALESCE(NEW,OLD)
-- always has it), so we derive v_rid and add it to each realtime_events INSERT.
--
-- DELIBERATELY UNCHANGED: SECURITY DEFINER, SET search_path=public, RETURN NULL,
-- the prune call, and the topic strings ('ops'/'menu'/'table:<n>'). Per-restaurant
-- CLIENT filtering is a later app-side step; this migration only makes the
-- breadcrumb CARRY the right restaurant_id. realtime_events.restaurant_id already
-- exists (078) — not altered here. These are trigger functions; grants untouched.

-- 1) lfh_rt_emit() — content/ops emitter. VERBATIM from migration 066, plus the
--    v_rid derivation and restaurant_id on BOTH realtime_events INSERTs.
CREATE OR REPLACE FUNCTION lfh_rt_emit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  k text;
  eid text;
  tn text;
  topic_name text;
  v_rid uuid;
BEGIN
  r := COALESCE(NEW, OLD);
  v_rid := COALESCE(r.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
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
  ELSIF TG_TABLE_NAME = 'staff_actions' THEN
    k := 'action'; eid := r.id::text; tn := NULL;      -- ops topic: drives the admin activity feed
                                                       -- (login/logout/profile/user edits touch no other ops table)
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

  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id)
    VALUES (topic_name, k, eid, tn, v_rid);
  IF tn IS NOT NULL THEN
    INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id)
      VALUES ('table:' || tn, k, eid, tn, v_rid);
  END IF;

  IF random() < 0.01 THEN PERFORM lfh_rt_prune(); END IF;
  RETURN NULL;
END $$;

-- 2) lfh_rt_emit_platform() — aggregator_orders emitter. VERBATIM from migration
--    071, plus the v_rid derivation and restaurant_id on the realtime_events INSERT.
CREATE OR REPLACE FUNCTION lfh_rt_emit_platform() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  v_rid uuid;
BEGIN
  r := COALESCE(NEW, OLD);
  v_rid := COALESCE(r.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  INSERT INTO realtime_events(topic, kind, entity_id, restaurant_id) VALUES ('ops', 'platform', r.id::text, v_rid);
  RETURN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
