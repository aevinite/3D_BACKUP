-- 397 — a platform-level event is announced UNSCOPED again, and keyed to nobody's restaurant
-- (owner picked item 11 of sweep #9 terminal 33's round-2 report, 2026-09-17)
--
-- ═══ WHAT THIS GIVES BACK ═══
--
-- Migration 395 stopped `lfh_rt_emit` announcing an event that belongs to no restaurant, because it
-- was stamping those rows with MY LITTLE FRENCH HOUSE'S id. That fixed the mislabel and it cost
-- something, which 395's own header wrote down rather than leaving to be discovered: for a
-- platform-level admin action — owner_create, restaurant_purge, owner_suspend,
-- admin_reveal_unlocked, login, client_error — there was no longer any breadcrumb at all, so the
-- admin console's Activity feed fell back to its 60-second safety net and the next tab wake.
--
-- The owner asked for the instant refresh back. This is the shape 395 named as the alternative,
-- built — and the mislabel does NOT come back with it.
--
-- ═══ WHY THE SHAPE I FIRST OFFERED HIM WOULD NOT HAVE WORKED, WHICH IS WORTH WRITING DOWN ═══
--
-- The report offered "stamp it with the zero-uuid 'no restaurant' marker this schema already uses"
-- (`lfh_remember_error_signature`, `lfh_rate_check`, `lfh_rate_alert` and `lfh_prune_logs` all use
-- it). Checked before building, and it would have FAILED:
--
--   · `realtime_events.restaurant_id` carries `realtime_events_restaurant_fk` → restaurants(id);
--   · there is NO restaurants row with the zero uuid, and inventing one would put a phantom
--     restaurant into the tenant table that every list, count and console screen would then have to
--     exclude — the opposite of migration 383, which exists to take non-restaurants OUT of the
--     estate;
--   · and because `lfh_rt_emit` is an AFTER trigger, the FK violation would have aborted the
--     WRITE THAT FIRED IT. Recording a platform admin action would have failed outright.
--
-- So the marker is NULL, not a sentinel id. A null foreign key is always valid, so the FK stays
-- exactly as it is and nothing phantom is created.
--
-- ═══ WHAT MAKES IT SAFE TO LET THAT COLUMN BE NULL AGAIN ═══
--
-- `lfh_set_topic_rid` has coalesced a null restaurant since migration 145 — the column was NULLABLE
-- when this table was designed, and migration 358 made it NOT NULL as part of taking the tenancy
-- guess out of every column. So this is not new ground; it is one deliberate exception, and the
-- coalesce that was already there is what made the exception land on French House.
--
-- Every reader was checked, not assumed:
--   · `lfh_rt_prune` deletes by `created_at` only ("< now() - 15 minutes"), so a null-restaurant row
--     is pruned on exactly the same schedule as every other breadcrumb;
--   · the only two readers in the whole app are websocket subscriptions — `lib/useRealtime.ts` and
--     `public/panels/realtime.js` — and both filter on `topic_rid` (scoped) or `topic` (unscoped).
--     NEITHER reads `restaurant_id`;
--   · `admin_purge_restaurant` deletes `WHERE restaurant_id = p_rid`, so a platform row is correctly
--     not any restaurant's to purge, and the 15-minute prune takes it;
--   · `idx_realtime_events_restaurant` is a plain btree, which indexes nulls without complaint.
--
-- ═══ WHO HEARS IT NOW, WHICH IS THE WHOLE POINT ═══
--
--   · THE ADMIN CONSOLE HEARS IT. `components/admin/shared.tsx` → `useLivePoll` subscribes
--     `{ ops, menu, audit }` and `lib/useRealtime.ts` builds an UNSCOPED filter for a caller with no
--     restaurant — `topic=eq.audit`. A row keyed 'audit:platform' matches that, so the Activity feed
--     refreshes the instant the row lands, as it did before 395.
--   · NO RESTAURANT HEARS IT. A per-restaurant subscriber filters
--     `topic_rid=eq.<topic>:<their own uuid>`, and 'audit:platform' is not that for anybody. The
--     trap migration 395 closed stays closed — including the one it was really about, which is the
--     day somebody wires an audit screen up per restaurant the ordinary way.
--
-- ═══ THE BODIES BELOW ARE THE LIVE ONES, NOT RE-TYPED ═══
--
-- Both came out of `pg_get_functiondef()` with exactly one block substituted each, under a
-- generator that refused to write this file unless removing those blocks returned the live text
-- byte for byte, and unless no restaurant-#1 fallback survived outside a comment. `lfh_rt_emit` sits
-- on EIGHTEEN triggers; migration 155's standing lesson — "a migration recreate reverts a fix" —
-- is why it is generated and never copied from an older migration.
--
-- `lfh_rt_emit`'s grants are restated (service_role only, no anon, exactly what proacl holds today).
-- `lfh_set_topic_rid` is a trigger function that cannot be called directly and holds no grant to
-- restate.
--
-- COST: one breadcrumb row per platform-level admin action, pruned within 15 minutes — which is
-- what it cost before migration 395, and strictly less than the 763 mislabelled rows that preceded
-- both files.
--
-- Guarded by `npm run verify:rid-required` (half D, re-pointed in the same change).

alter table public.realtime_events alter column restaurant_id drop not null;

comment on column public.realtime_events.restaurant_id is
  'The restaurant this breadcrumb belongs to, or NULL for a PLATFORM-LEVEL event that belongs to none — an admin creating an owner, purging a restaurant, uncovering a password (mig 397). lfh_set_topic_rid keys a null row "<topic>:platform", which no per-restaurant subscriber matches and the unscoped admin console does. It was NOT NULL between migrations 358 and 397; do not restore that without reading 395 and 397 together.';

CREATE OR REPLACE FUNCTION public.lfh_set_topic_rid()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- (mig 397) A NULL RESTAURANT KEYS TO 'platform', NOT TO RESTAURANT #1.
  -- This line has coalesced a null to French House's id since migration 145, which is the mislabel
  -- migration 395 was written for one level up. A row keyed 'audit:platform' is matched by NO
  -- per-restaurant subscription (they filter topic_rid=eq.<topic>:<their own id>) and IS delivered
  -- to the admin console, which subscribes unscoped on topic=eq.audit.
  NEW.topic_rid := NEW.topic || ':' || COALESCE(NEW.restaurant_id::text, 'platform');
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.lfh_rt_emit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF random() < 0.01 THEN PERFORM lfh_rt_prune(); END IF;
  RETURN NULL;
END $function$;

revoke all on function public.lfh_rt_emit() from public, anon, authenticated;
grant execute on function public.lfh_rt_emit() to service_role;

notify pgrst, 'reload schema';
