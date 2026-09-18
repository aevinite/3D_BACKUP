-- ⚠️ NOT A MIGRATION YET, ON PURPOSE — THAT IS WHY IT LIVES IN docs/ AND NOT IN
-- supabase/migrations/. A re-seed runs every file in the migrations folder with no ledger
-- (CLAUDE.md), so an unverified change to the realtime plumbing sitting there would eventually
-- reach a database on its own. It is unit-tested (see the header below and docs/STRESS-TEST.md
-- §3a) and it is NOT applied anywhere. To ship it: verify a new order reaching the kitchen board,
-- a dish marked ready moving the manager's tile and the waiter's tablet, and a removed dish
-- leaving every board — on a real browser, on a non-#1 restaurant — then move this file to
-- supabase/migrations/ as the next free number and apply it with scripts/run-migration.mjs.
--
-- 400 — ONE BREADCRUMB PER WRITE, NOT ONE PER DISH.
--
-- DRAFT — measured before merging (see the bottom of this header). Found by the 62-restaurant
-- stress run (owner, 2026-09-18: "my app should survive all the things").
--
-- WHAT A SINGLE ORDER COSTS THE BREADCRUMB TABLE TODAY
--   lfh_rt_emit fires FOR EACH ROW, and it writes TWO rows per row-change: one on the topic
--   ('ops'), one on `table:<n>` so a panel can refetch a single tile instead of the whole floor.
--   `order_items` gets one row per dish, so a three-dish order writes:
--       orders      INSERT → 1 row-change  → 2 breadcrumbs
--       order_items INSERT → 3 row-changes → 6 breadcrumbs
--   and every status move after that repeats the shape: the kitchen's
--   `UPDATE order_items SET status='ready' WHERE order_id = X` is one statement, N row-changes,
--   2N breadcrumbs. A table's whole lifecycle — join, order, accept, ready, serve, pay, close —
--   emitted roughly 48 breadcrumb rows for a three-dish party.
--
-- AND THOSE N ROWS CARRY NO EXTRA INFORMATION. Look at what the trigger puts in an order_items
-- breadcrumb: `entity_id := r.order_id`, and the table number looked up FROM that order. Not the
-- item id — the ORDER id. So the N rows a multi-dish write produces are byte-for-byte identical
-- apart from their own primary key. Every subscriber already treats a breadcrumb as "this order
-- changed, go and read it": lib/useRealtime.ts and public/panels/realtime.js refetch by entity.
-- Nothing anywhere renders per-dish from a breadcrumb.
--
-- WHY IT COSTS MORE THAN THE ROWS THEMSELVES
--   realtime_events is in the `supabase_realtime` publication — that is how a board hears about
--   a change at all. Every row written to it therefore also pays for: WAL, logical decoding, and
--   Realtime's per-subscriber RLS evaluation. In pg_stat_statements on the dev database that
--   evaluation is the single largest consumer of database time in the whole schema —
--   3,249,528 calls, 23,146 seconds, 7.1 ms each — and it is charged PER ROW, PER SUBSCRIBER.
--   Halving the rows halves it. This is the same instance the app's own queries run on, so that
--   time is taken directly out of what is left for orders.
--
-- WHAT THIS MIGRATION DOES
--   order_items keeps its breadcrumbs but emits them ONCE PER STATEMENT instead of once per row,
--   using transition tables (Postgres 17) to collapse the changed rows to their DISTINCT orders.
--   A one-dish write is unchanged (one statement, one order, two breadcrumbs). A four-dish write
--   goes from eight breadcrumbs to two. A statement that spans two orders still emits for both —
--   DISTINCT is on the order, not on the statement.
--
--   The table-number lookup goes the same way: it was one `SELECT o.table_number` per dish row,
--   it is now one join for the whole statement.
--
--   `orders`, `sessions`, `waiter_calls` and the other fifteen tables are LEFT ALONE. They are
--   written a row at a time in normal use, so per-row and per-statement are the same thing there,
--   and changing them would be churn with no number behind it.
--
-- WHAT MUST STILL BE TRUE AFTER IT (the verification, not a hope)
--   · a new order still reaches the kitchen board within a second or two
--   · a dish marked ready still moves the manager's tile and the waiter's tablet
--   · a cancelled/removed dish still leaves every board
--   · the `table:<n>` topic still carries the right table, including for a merged table
--   Checked on the live deploy across manager / kitchen / tablet before this ships — realtime is
--   what makes every board feel instant, so a regression here is worse than the saving.
--
-- Verify:  node scripts/verify-db-grants.mjs  ·  npm run verify:busy  ·  npm run verify:live

-- ── the statement-level emitter for order_items ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_rt_emit_order_items_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Two parallel arrays, not one: the breadcrumb's restaurant must come from the ORDER_ITEMS row
  -- (that is what the row-level trigger used — `v_rid := r.restaurant_id`), while the table
  -- number comes from the order. Keeping both means this emits exactly what the old trigger did.
  v_ids  uuid[];
  v_rids uuid[];
BEGIN
  -- WHICH TRANSITION TABLE EXISTS DEPENDS ON THE OPERATION: INSERT has only NEW, DELETE only OLD,
  -- UPDATE both. A branch that is not taken is never planned (PL/pgSQL plans each statement on
  -- first execution), so naming a table that does not exist for this event is safe here and only
  -- here — do not hoist these into one statement.
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(d.order_id), array_agg(d.restaurant_id) INTO v_ids, v_rids
      FROM (SELECT DISTINCT order_id, restaurant_id FROM lfh_rt_new WHERE order_id IS NOT NULL) d;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(d.order_id), array_agg(d.restaurant_id) INTO v_ids, v_rids
      FROM (SELECT DISTINCT order_id, restaurant_id FROM lfh_rt_old WHERE order_id IS NOT NULL) d;
  ELSE
    SELECT array_agg(d.order_id), array_agg(d.restaurant_id) INTO v_ids, v_rids
      FROM (
        SELECT DISTINCT order_id, restaurant_id FROM (
          SELECT order_id, restaurant_id FROM lfh_rt_new
          UNION
          SELECT order_id, restaurant_id FROM lfh_rt_old
        ) u WHERE order_id IS NOT NULL
      ) d;
  END IF;

  -- A STATEMENT THAT CHANGED NOTHING ANNOUNCES NOTHING. A statement-level trigger fires even when
  -- the WHERE matched no row, and a breadcrumb for a write that did not happen costs every open
  -- panel a refetch for nothing.
  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN RETURN NULL; END IF;

  -- Both rows for every changed order, in one statement: the topic row, plus the `table:<n>` row
  -- so a tile can refetch itself instead of the whole floor. `entity_id` is the ORDER id —
  -- exactly what the row-level trigger wrote, so no subscriber sees a different shape. The table
  -- number and restaurant come from the order, one join for the whole statement instead of one
  -- lookup per dish.
  -- LEFT JOIN, not JOIN: the row-level trigger emitted the topic row even when the order lookup
  -- found nothing (it simply left the table number NULL), and a dish leaving a board is exactly
  -- the case that must never be swallowed.
  WITH o AS (
    SELECT u.id, u.rid, ord.table_number
      FROM unnest(v_ids, v_rids) AS u(id, rid)
      LEFT JOIN orders ord ON ord.id = u.id
  )
  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id)
  SELECT 'ops', 'order_item', o.id::text, o.table_number, o.rid FROM o
  UNION ALL
  SELECT 'table:' || o.table_number, 'order_item', o.id::text, o.table_number, o.rid
    FROM o WHERE o.table_number IS NOT NULL;

  RETURN NULL;
END $$;

-- A new Postgres function is PUBLIC-executable by default (mig 038/267 lesson).
REVOKE ALL ON FUNCTION public.lfh_rt_emit_order_items_stmt() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_rt_emit_order_items_stmt() TO service_role;

-- ── swap the trigger: the new way REPLACES the old one, it does not sit beside it ──────────────
-- OBITUARY: `rt_emit_order_items` was
--     AFTER INSERT OR UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit()
-- and it is dropped here rather than left disabled. Leaving both would double every breadcrumb,
-- which is the opposite of the point. lfh_rt_emit() itself is untouched — seventeen other tables
-- still use it.
DROP TRIGGER IF EXISTS rt_emit_order_items ON public.order_items;

-- One trigger per operation: transition tables are per-event, so INSERT/UPDATE/DELETE cannot share
-- a single statement-level trigger the way a FOR EACH ROW trigger can.
DROP TRIGGER IF EXISTS rt_emit_order_items_ins ON public.order_items;
CREATE TRIGGER rt_emit_order_items_ins
  AFTER INSERT ON public.order_items
  REFERENCING NEW TABLE AS lfh_rt_new
  FOR EACH STATEMENT EXECUTE FUNCTION public.lfh_rt_emit_order_items_stmt();

DROP TRIGGER IF EXISTS rt_emit_order_items_upd ON public.order_items;
CREATE TRIGGER rt_emit_order_items_upd
  AFTER UPDATE ON public.order_items
  REFERENCING NEW TABLE AS lfh_rt_new OLD TABLE AS lfh_rt_old
  FOR EACH STATEMENT EXECUTE FUNCTION public.lfh_rt_emit_order_items_stmt();

DROP TRIGGER IF EXISTS rt_emit_order_items_del ON public.order_items;
CREATE TRIGGER rt_emit_order_items_del
  AFTER DELETE ON public.order_items
  REFERENCING OLD TABLE AS lfh_rt_old
  FOR EACH STATEMENT EXECUTE FUNCTION public.lfh_rt_emit_order_items_stmt();

NOTIFY pgrst, 'reload schema';
