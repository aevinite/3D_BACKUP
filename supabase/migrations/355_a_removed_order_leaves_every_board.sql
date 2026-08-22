-- 355_a_removed_order_leaves_every_board.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- THE PROBLEM, found by sweep #6 terminal 22 and watched on the dev stack.
--
-- "Removed from the floor" is written by the app as TWO columns on `orders`:
-- `deleted_at` (the tombstone the bill ledger, the retention window and every index read) and
-- `archived` (the flag every LIVE BOARD reads — lfh_floor_state, lfh_table_view_summary,
-- lfh_kitchen_tickets, lfh_admin_floor_stats). `lib/softDelete.ts` stamps both, and says why in
-- as many words: "a deleted order is definitionally NOT live, so this reuses the `NOT archived`
-- exclusion every live surface already applies".
--
-- Nothing enforced that. One rule, two columns, and any write that stamps only `deleted_at`
-- leaves an order that the floor calls gone and the KITCHEN still calls food. On the dev
-- database 24 orders were in exactly that state — the oldest for over two weeks — so French
-- House's kitchen board carried tickets for parties that had left, on tables the floor showed as
-- free. `npm run verify:lifecycle` went red on it roughly one run in three, depending on which
-- tables its random pick landed on, which is why it read as flakiness rather than as this.
--
-- The same gap has a second face: the QR auto-accept test (migration 164, tightened in 357)
-- asked only about an order's status and payment, so a cleared-off order could auto-accept the
-- NEXT party's first order.
--
-- THE FIX. Make the implication true in the database instead of in every writer:
--     deleted_at IS NOT NULL  ⇒  archived = true
-- A BEFORE INSERT OR UPDATE trigger normalises it. It NORMALISES rather than refuses, because a
-- refused write is a tap that vanishes (CLAUDE.md: "a tap must never vanish in silence") and
-- because every caller that stamps `deleted_at` already means "off the floor".
--
-- It cannot fight the RESTORE path. `restoreOrders()` clears `deleted_at` and deliberately
-- LEAVES `archived` set — "a restore recovers the bill as a RECORD, not onto the live cooking
-- line". This trigger only ever acts while `deleted_at` is set, so a restore is untouched.
--
-- Additive: one trigger function, one trigger, and a ONE-TIME backfill of the rows that are
-- already inconsistent — wrapped in lfh_already_applied so a re-seed cannot run it twice.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.lfh_removed_order_leaves_every_board()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  -- Only the removed direction. A restore (deleted_at back to NULL) is none of our business.
  IF NEW.deleted_at IS NOT NULL AND COALESCE(NEW.archived, false) = false THEN
    NEW.archived    := true;
    -- archived_at doubles as the moment it left the boards, exactly as lib/softDelete.ts sets it.
    NEW.archived_at := COALESCE(NEW.archived_at, NEW.deleted_at);
  END IF;
  RETURN NEW;
END $fn$;

REVOKE ALL ON FUNCTION public.lfh_removed_order_leaves_every_board() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_removed_order_leaves_every_board ON public.orders;
CREATE TRIGGER trg_removed_order_leaves_every_board
  BEFORE INSERT OR UPDATE OF deleted_at, archived ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.lfh_removed_order_leaves_every_board();

-- ── the one-time repair of the rows that are already in the split state ──────────────────────
-- Scoped to exactly the disagreement (deleted_at set, archived false); it can touch nothing else.
-- Wrapped so a re-seed does not run it a second time. `lfh_already_applied` is created by
-- migration 307, which is BEFORE this file, so it is always available here.
DO $backfill_once$
DECLARE v_applied boolean := false; v_n int;
BEGIN
  IF to_regprocedure('public.lfh_already_applied(text)') IS NOT NULL THEN
    EXECUTE $probe$ SELECT lfh_already_applied('355_removed_order_archived_backfill') $probe$ INTO v_applied;
  END IF;
  IF v_applied THEN
    RAISE NOTICE '355: the removed-order backfill has already run once — skipped';
    RETURN;
  END IF;

  UPDATE orders
     SET archived    = true,
         archived_at = COALESCE(archived_at, deleted_at)
   WHERE deleted_at IS NOT NULL
     AND COALESCE(archived, false) = false;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '355: % order(s) that were off the floor but still on the kitchen board are now off both', v_n;

  IF to_regclass('public.lfh_applied_once') IS NOT NULL THEN
    INSERT INTO lfh_applied_once (key, note) VALUES
      ('355_removed_order_archived_backfill',
       'one-time repair of orders with deleted_at set and archived false. The trigger above stops new ones; re-running the UPDATE is harmless but pointless, and the marker keeps the re-seed honest.')
    ON CONFLICT (key) DO NOTHING;
  END IF;
END $backfill_once$;

NOTIFY pgrst, 'reload schema';
