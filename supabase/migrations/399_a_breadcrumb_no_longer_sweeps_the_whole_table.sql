-- 399 — A BREADCRUMB NO LONGER SWEEPS THE WHOLE TABLE INSIDE SOMEONE'S ORDER.
--
-- Found by the 62-restaurant stress run (owner, 2026-09-18: "solve this all error, my app should
-- survive all the things"). This is not a rig artefact; it is on every write the app makes.
--
-- WHAT WAS HAPPENING
--   lfh_rt_emit is the realtime breadcrumb trigger. It fires FOR EACH ROW on eighteen tables —
--   orders, order_items, sessions, waiter_calls, requests, menu_items … — and its last line was:
--
--       IF random() < 0.01 THEN PERFORM lfh_rt_prune(); END IF;
--
--   lfh_rt_prune is `DELETE FROM realtime_events WHERE created_at < now() - interval '15 minutes'`,
--   and realtime_events has NO index on created_at, so that DELETE is a SEQUENTIAL SCAN of the
--   whole breadcrumb table. One write in a hundred therefore paid for a full sweep of that table
--   INSIDE THE DINER'S OWN TRANSACTION — the waiter's "send to kitchen" was holding its database
--   connection open while the housekeeping ran.
--
--   MEASURED on the dev database before this migration (pg_stat_user_tables, realtime_events):
--       seq_scan          26,984
--       seq_tup_read   1,079,442,494      ← a billion rows read, by the housekeeping alone
--       autovacuum_count   1,113          ← the dead rows each sweep left behind
--   It is the largest single source of wasted reads in the database, and it grows with traffic:
--   busier restaurants emit more breadcrumbs, so the sweep fires more often, on a bigger table.
--
-- WHY IT IS SAFE TO JUST DELETE IT — THE REPLACEMENT HAS BEEN RUNNING SINCE MIGRATION 060
--   Migration 058 added the opportunistic sweep because nothing else pruned. Migration 060 then
--   scheduled `lfh-rt-prune` on pg_cron every ten minutes — and nobody removed the old way. Both
--   have been running side by side ever since, one of them on the customer's critical path.
--   That is exactly the case the standing rule covers: a new way REPLACES the old one. The cron
--   job is re-asserted below so this migration can never leave the table unpruned.
--
-- WHY THERE IS NO NEW INDEX ON created_at, THOUGH IT LOOKS OBVIOUS
--   Retention is 15 minutes and the cron runs every 10, so each scheduled prune deletes roughly
--   two-thirds of the rows in the table. For a delete that broad a sequential scan IS the cheaper
--   plan — an index would be read once and then maintained on every single breadcrumb INSERT
--   forever (realtime_events is the highest-insert table in the schema). Adding it would make the
--   hot path slower to speed up a job that runs 144 times a day. The fix is to stop running the
--   sweep 20 times a second, not to index it.
--
-- WHAT DOES NOT CHANGE
--   Every breadcrumb still lands, on the same two rows (the topic row, plus `table:<n>` when the
--   event belongs to a table), with the same restaurant scoping migrations 394/395/397 settled:
--   an event with no restaurant stays NULL-scoped and keyed 'topic:platform'. The body below is
--   the live 397 body with one line removed and nothing else touched.
--
-- Verify:  node scripts/verify-db-grants.mjs   ·   npm run verify:busy

CREATE OR REPLACE FUNCTION public.lfh_rt_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  k text;
  eid text;
  tn text;
  topic_name text;
  v_rid uuid;
BEGIN
  r := COALESCE(NEW, OLD);

  -- (mig 394) AN EVENT THAT BELONGS TO NO RESTAURANT IS ANNOUNCED TO NOBODY.
  -- This line used to read
  --     v_rid := COALESCE(r.restaurant_id, '00000000-…-0001'::uuid);
  -- so a row with no restaurant had its breadcrumb stamped with MY LITTLE FRENCH HOUSE'S id.
  -- `staff_actions` is the one table this trigger fires on whose restaurant_id is nullable, and
  -- 763 of its 6,672 rows are rightly empty: they are platform-level admin events — owner_create,
  -- restaurant_purge, owner_suspend, admin_reveal_unlocked, login, client_error — that belong to
  -- no single restaurant. There is no scoped subscriber who should hear them, so none is told.
  -- (mig 397) AN EVENT THAT BELONGS TO NO RESTAURANT IS ANNOUNCED TO EVERYONE WHO LISTENS
  -- UNSCOPED, AND TO NO RESTAURANT.
  -- Migration 395 returned here without emitting, which fixed the mislabel and cost the admin
  -- console its instant refresh on platform-level events. The owner asked for that back.
  -- v_rid stays NULL: the FK on realtime_events.restaurant_id is satisfied by a null, and
  -- lfh_set_topic_rid keys the row 'topic:platform' so no per-restaurant listener can match it.
  v_rid := r.restaurant_id;
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
  ELSIF TG_TABLE_NAME = 'session_payments' THEN
    -- NEW (mig 267 / F10): a part-payment is money on ONE table's bill, so scope it to that
    -- table and the manager/waiter refetch just that tile instead of the whole floor.
    k := 'payment'; eid := r.session_id::text;
    SELECT s.table_number INTO tn FROM sessions s WHERE s.id = r.session_id;
  ELSIF TG_TABLE_NAME = 'requests' THEN
    k := 'request'; eid := r.id::text; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'session_members' THEN
    k := 'member'; eid := r.id::text;
    SELECT s.table_number INTO tn FROM sessions s WHERE s.id = r.session_id;
  ELSIF TG_TABLE_NAME = 'blocklist' THEN
    k := 'block'; eid := NULL; tn := NULL;             -- ops topic, staff-only
  ELSIF TG_TABLE_NAME = 'staff_actions' THEN
    -- CHANGED (mig 267 / F3): the admin activity feed's OWN topic. It is deliberately NOT
    -- `ops`: no floor tile renders from staff_actions, and an unscopable ops breadcrumb
    -- costs every open panel a whole-floor read. Only components/admin/shared.tsx listens.
    k := 'action'; eid := r.id::text; tn := NULL; topic_name := 'audit';
  ELSIF TG_TABLE_NAME = 'table_tags' THEN
    -- TAG: mark/clear/move of a table tag; no id column → entity is the table itself.
    k := 'table_tag'; eid := NULL; tn := r.table_number;
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

  -- OBITUARY (mig 399). The line that stood here was:
  --     IF random() < 0.01 THEN PERFORM lfh_rt_prune(); END IF;
  -- It is gone on purpose. Housekeeping does not belong in a diner's transaction: the same prune
  -- runs on pg_cron as `lfh-rt-prune` every ten minutes (mig 060, re-asserted at the end of this
  -- migration). Measured cost of the old line: 26,984 sequential scans of realtime_events,
  -- 1,079,442,494 tuples read, 1,113 autovacuums. Do not put it back — if pruning ever needs to
  -- be more frequent, change the CRON SCHEDULE, never the trigger.
  RETURN NULL;
END $$;

-- The replacement, re-asserted. cron.schedule upserts by name, so this is safe on a database that
-- already has it (every one of ours does — this exists so the removal above can never be applied
-- to a database where nothing else prunes).
SELECT cron.schedule('lfh-rt-prune', '*/10 * * * *', 'SELECT public.lfh_rt_prune();');

-- Grants restated, unchanged from mig 397: service_role only, no anon, no authenticated. A
-- CREATE OR REPLACE keeps the existing ACL, so these lines assert rather than alter — but a new
-- Postgres function is PUBLIC-executable by default, and every staff-only function in this schema
-- says so out loud (mig 038/267 lesson, guarded by scripts/verify-db-grants.mjs).
REVOKE ALL ON FUNCTION public.lfh_rt_emit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_rt_emit() TO service_role;
