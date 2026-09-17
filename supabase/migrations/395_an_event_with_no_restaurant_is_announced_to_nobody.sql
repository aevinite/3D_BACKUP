-- 395 — an activity event that belongs to NO restaurant stops being announced as French House's
-- (owner picked item 7 of sweep #9 terminal 33's report, 2026-09-17)
--
-- ⚠️ RENUMBERED 394 → 395, and the renumber is worth reading because a guard on this branch caused
-- it. This file was written as 394_…; while it sat in a worktree, another terminal landed
-- `394_a_staff_placed_order_is_marked_in_one_call.sql` on `main`. The rebase brought the two
-- together and `verify:grants` went RED naming both — the check this same branch had just taught to
-- identify duplicate numbers BY NUMBER instead of counting them (see the note in
-- scripts/verify-db-grants.mjs). The old count-based version would have said nothing, because 19
-- pairs stayed 19.
--
-- The incumbent keeps its number: theirs was already on `main`, mine was not. Nothing is lost by
-- moving — this file carries NO `lfh_already_applied` key (its whole body is one CREATE OR REPLACE,
-- idempotent by construction), so the rename cannot orphan a ledger entry. That is the trap
-- migration 376's header names: renaming a migration must never change its applied-once key.
--
-- The two files are disjoint anyway (that one replaces lfh_staff_place_order, this one
-- lfh_rt_emit), so order could not have reverted either. Renumbered rather than allow-listed
-- because a pair that does not need to exist should not: 19 known pairs are 19 places a future
-- reader has to check.
--
-- ═══ WHAT WAS WRONG, AND WHY NOTHING WAS WRONG ON A SCREEN ═══
--
-- Migration 386 removed the "answer as French House when no restaurant is given" guess from
-- nineteen function bodies, and deliberately LEFT twenty others that coalesce a ROW's own
-- `restaurant_id` rather than a parameter, with the reason written down: migration 358 made those
-- columns NOT NULL, so the arm is unreachable — dead code, not a trap.
--
-- That is true of nineteen. T33 measured the twentieth and it is the one actually taken:
--
--   · six of the sixty-six tenant tables still have a NULLABLE restaurant_id — action_idempotency,
--     error_signatures, fix_requests, invoice_events, rate_limit_rules, staff_actions — because 358
--     left those on purpose;
--   · `lfh_rt_emit` fires on EIGHTEEN triggers across sixteen tables, and staff_actions is one of
--     them;
--   · 763 of 6,672 rows in staff_actions carry no restaurant, and they are RIGHT to. They are
--     platform-level admin events belonging to no single restaurant — owner_create,
--     restaurant_purge, owner_suspend, admin_reveal_unlocked, login, client_error — the newest
--     dated 2026-09-16. Every one of them wrote a live-update breadcrumb stamped with My Little
--     French House's id.
--
-- NOBODY SAW A WRONG NUMBER, and that is why this is a narrow correction and not an emergency. The
-- `audit` topic has exactly ONE listener — `components/admin/shared.tsx`, and `lib/useRealtime.ts`
-- says so in as many words — and the admin console subscribes with NO restaurant (`topic=eq.audit`),
-- so it received these events either way and still does. The mislabel sat in the stored breadcrumb's
-- `topic_rid`, which nothing reads for this topic.
--
-- IT BECOMES REAL THE MOMENT anyone subscribes to `audit` WITH a restaurant, which is how every
-- other topic in this app is consumed (`lib/useRealtime.ts` → `topic_rid=eq.<topic>:<rid>`). Then
-- French House alone starts being woken by other people's platform events, and the CLAUDE.md SaaS
-- rule that realtime is keyed per restaurant is quietly false for 11% of audit rows.
--
-- ═══ WHICH OF THE TWO SHAPES THIS IS, AND WHY ═══
--
-- The report offered the owner two: (a) emit nothing when an event has no restaurant, or (b) stamp
-- it with the zero-uuid "no restaurant" marker this schema already uses (see
-- `lfh_remember_error_signature`, which coalesces to '…0000'). He said "do 7" without naming one,
-- so this builds (a) — the recommendation — and says so rather than guessing silently.
--
-- (a) IS RIGHT BECAUSE NO SUBSCRIBER SHOULD HEAR IT. A breadcrumb exists to tell a screen scoped to
-- ONE restaurant that something of theirs moved. An event with no restaurant has no such screen:
-- the only listener is unscoped and gets its rows from the `audit` topic filter, not from the
-- restaurant stamp. (b) would keep writing a row that nothing queries — the same shape as a field a
-- panel reads and nobody assigns, inverted.
--
-- ═══ WHAT THIS COSTS, MEASURED RATHER THAN ASSUMED ═══
--
--   · THE ADMIN CONSOLE'S LIVE FEED IS UNCHANGED. It filters on `topic=eq.audit` with no
--     restaurant, so it never read the stamp. Checked by reading lib/useRealtime.ts:129 — the rid
--     branch is the GUEST branch; admin and staff take `topic=eq.<topic>`.
--
--     ⚠️ AND THAT IS THE ONE THING TO KNOW BEFORE CHANGING THIS AGAIN: for a platform-level event
--     there is now NO breadcrumb row at all, so the console's instant refresh for those events
--     comes from nothing — it falls back to useRealtime's own 60-second safety net and the next tab
--     wake. A row that is created and purged, versus a row never created, is the difference between
--     "the admin feed updates instantly on an owner_create" and "within a minute". That is a
--     deliberate trade for correctness, it is written here so it is not rediscovered as a fault,
--     and it is exactly what shape (b) would buy back if the owner ever wants the instant refresh.
--
--   · 763 FEWER breadcrumb rows over the life of this database, and one fewer INSERT on every
--     platform-level admin action. Strictly less work.
--   · THE OPPORTUNISTIC PRUNE IS SKIPPED on those writes (`IF random() < 0.01 THEN PERFORM
--     lfh_rt_prune()`), because the early return comes before it. That is safe and was checked:
--     migration 060 put `lfh-rt-prune` on a 10-minute cron precisely so the sweep is GUARANTEED
--     rather than opportunistic, and `verify:grants` asserts that schedule every run.
--   · No index, no view, no column and no policy changes. Nothing is rewritten.
--
-- ═══ THE BODY BELOW IS THE LIVE ONE, NOT RE-TYPED ═══
--
-- Generated from `pg_get_functiondef()` on the dev database — which is the only true source for
-- this function, since its newest copy in this folder is migration 267's and eighteen triggers
-- depend on it. The generator refused to emit the file unless removing the inserted block returned
-- the live text EXACTLY, and unless no `COALESCE(r.restaurant_id` survived outside a comment. That
-- is this folder's standing lesson — "a migration recreate reverts a fix" (migration 155) — applied
-- to the most-triggered function in the schema.
--
-- CREATE OR REPLACE keeps the existing grants; they are restated below anyway so a fresh database
-- running this file alone still locks the function down (the migration-038 lesson). Restated to
-- EXACTLY what it holds today, read from `pg_proc.proacl`: postgres and service_role, no anon.
-- `lfh_rt_emit` is deliberately NOT on verify:grants' anon allow-list, unlike its two siblings
-- `lfh_rt_emit_cart` and `lfh_rt_emit_platform`, which fire on guest write paths.
--
-- Those two siblings coalesce a row's restaurant_id as well and are LEFT ALONE, correctly: they fire
-- on `sessions` and `aggregator_orders`, where the column is NOT NULL, so their arm really is dead.
--
-- ═══ THE ONE THING THAT COULD MAKE THIS CATASTROPHIC, CHECKED FIRST ═══
--
-- The new path is an EARLY `RETURN NULL`. In a **BEFORE** row trigger, returning NULL SKIPS the
-- write entirely — so if a single one of this function's triggers were BEFORE, this file would
-- silently stop 763-rows-worth of activity ever being recorded, and an audit table quietly losing
-- rows is the worst failure this product has.
--
-- Asked of the catalogue rather than assumed: all **18** triggers on `lfh_rt_emit` are
-- `AFTER … FOR EACH ROW`, zero BEFORE. (It was already true by construction — the function has
-- always ended in `RETURN NULL`, which every invocation reaches, so a BEFORE trigger would have
-- been dropping every write since migration 086. Worth proving anyway, because "it must be fine or
-- we'd have noticed" is not a check.) `npm run verify:rid-required` half D now asserts it every run,
-- so a BEFORE trigger added later goes red instead of losing rows.
--
-- Guarded by `npm run verify:rid-required` (half D, extended in the same change).

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

  -- (mig 395) AN EVENT THAT BELONGS TO NO RESTAURANT IS ANNOUNCED TO NOBODY.
  -- This line used to read
  --     v_rid := COALESCE(r.restaurant_id, '00000000-…-0001'::uuid);
  -- so a row with no restaurant had its breadcrumb stamped with MY LITTLE FRENCH HOUSE'S id.
  -- `staff_actions` is the one table this trigger fires on whose restaurant_id is nullable, and
  -- 763 of its 6,672 rows are rightly empty: they are platform-level admin events — owner_create,
  -- restaurant_purge, owner_suspend, admin_reveal_unlocked, login, client_error — that belong to
  -- no single restaurant. There is no scoped subscriber who should hear them, so none is told.
  IF r.restaurant_id IS NULL THEN
    RETURN NULL;
  END IF;
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
