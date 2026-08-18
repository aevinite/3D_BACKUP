-- 335: AUTO-PRINT IS A ROW, NOT SOMETHING A BROWSER TAB NOTICED
-- (owner, 2026-08-17: the kitchen PC has one Chrome tab doing the auto-printing, and "if you
--  minimize, or open another app on the same PC, the KOT prints totally stop".)
--
-- WHY IT STOPPED. Until now auto-print lived entirely in public/panels/kitchen/app.js: the tab
-- watched its own board, spotted an order it had not printed, and printed it. Four separate things
-- switch that off the moment the tab is not the thing you are looking at —
--   1. the panel refused to print while `document.hidden` (autoPrintNew / printQueue),
--   2. realtime.js drops its channels after 120s hidden (the egress rule), so the tab never even
--      heard about the order,
--   3. the catch-up poll skips while hidden,
--   4. Chrome throttles background timers, freezes a background tab after ~5 minutes, and marks a
--      window hidden when ANOTHER WINDOW COVERS IT — not only when it is minimised.
-- Nothing was queued anywhere, so a ticket missed while the tab slept was a ticket lost.
--
-- WHAT THIS CHANGES. Migration 269 already built the durable queue (print_jobs: an atomic claim,
-- retries, a manager alert when a job sticks) — but ONLY the manager's manual "Reprint in kitchen"
-- ever put a row in it. Now a NEW ORDER PUTS ITS OWN ROW IN IT, in the database, at the moment the
-- order is written. From then on printing is a queue with claimants instead of an observation:
--   • the kitchen screen claims and prints (as it already does for reprints),
--   • the MANAGER screen can claim and print too (the owner's ask — a counter printer),
--   • a job nobody printed is a row that WAITS, and the manager's floor strip already shouts about
--     one that sticks past 90 seconds,
--   • tomorrow a print AGENT or a cloud printer claims the same rows with no browser involved.
--
-- One row per KOT, written by the same transaction that writes the order, so it covers every door
-- at once — guest menu (all three routes), waiter tablet, manager take-order, ⚡ QO/P, parcel — and
-- no future door can forget to queue its ticket. That coverage is exactly why this is a TRIGGER and
-- not another line in each route handler.

-- ── 1. A finished-or-not lookup by ORDER, which is new ───────────────────────────────────────
-- The kitchen board asks "which of the orders in front of me already have a print job?" so it can
-- tell "the queue has this in hand" from "nothing queued this — print it the old way" (the panel's
-- self-healing net, for a database where this trigger is missing). The 269 index is
-- (restaurant_id, status, created_at) and answers nothing about an order id.
CREATE INDEX IF NOT EXISTS print_jobs_order_idx
  ON print_jobs (restaurant_id, order_id);

-- ── 2. The trigger: a new ticket queues itself ───────────────────────────────────────────────
-- SECURITY DEFINER because the INSERT that fires this arrives as several different roles (service
-- role from the panel routes, and the guest order path through its own definer function) while
-- print_jobs is deliberately RLS-on/policy-less — staff-only, service-role-only. The search_path is
-- pinned for the same reason mig 053 pins it.
--
-- Deliberately narrow, so it can only ever ADD a ticket that would have printed anyway:
--   • only when the ADMIN allowed auto-print AND the owner switched it on (mig 107, both rungs) —
--     the identical test the kitchen route makes for `autoPrintKot`,
--   • only for an order that is actually waiting to be cooked ('received' | 'preparing'), which is
--     the exact filter the old client-side autoPrintNew() used,
--   • never for a soft-deleted row (lib/softDelete.ts) — a ticket removed from the books is not
--     cooked again (the T7 finding of 2026-08-11, honoured at the source this time),
--   • reprint = FALSE, so billdoc.js prints it CLEAN. Only a manual reprint (or a retry, decided by
--     the panel from `attempts`) carries the *** Reprint · Duplicate *** banner.
CREATE OR REPLACE FUNCTION lfh_kot_queue_autoprint()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_on boolean;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM 'received' AND NEW.status IS DISTINCT FROM 'preparing' THEN
    RETURN NEW;
  END IF;

  SELECT (auto_print_kot IS TRUE AND auto_print_kot_allowed IS TRUE)
    INTO v_on
    FROM settings
   WHERE restaurant_id = NEW.restaurant_id
   LIMIT 1;

  IF v_on IS NOT TRUE THEN RETURN NEW; END IF;

  INSERT INTO print_jobs (restaurant_id, kind, order_id, reprint, requested_by)
  VALUES (NEW.restaurant_id, 'kot', NEW.id, false, 'Auto-print');

  RETURN NEW;
END;
$$;
-- Trigger functions are called by the system, not by a caller with EXECUTE — so nobody needs the
-- privilege, and the house rule (mig 038/267: a new function is PUBLIC-executable by default) says
-- take it away rather than leave it lying around. verify:grants checks this.
-- `PUBLIC` alone is not enough on Supabase: `anon` and `authenticated` are granted EXECUTE in their
-- own right, so a revoke from PUBLIC leaves a guest browser able to call it (verify:grants caught
-- exactly this, first run). Same three-role revoke mig 190 uses.
REVOKE ALL ON FUNCTION lfh_kot_queue_autoprint() FROM PUBLIC, anon, authenticated;

-- AFTER INSERT, so kot_no (mig 036) is already stamped on the row this job points at. The job only
-- stores order_id — the ticket's contents are read at print time — but a reader of this file should
-- not have to work that out.
DROP TRIGGER IF EXISTS trg_kot_queue_autoprint ON orders;
CREATE TRIGGER trg_kot_queue_autoprint
  AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION lfh_kot_queue_autoprint();

-- ── 3. An auto ticket adds NO breadcrumb ─────────────────────────────────────────────────────
-- mig 269 gave print_jobs an INSERT breadcrumb so a manual reprint wakes the kitchen instantly.
-- Every order now inserts a job too, and that breadcrumb would be pure waste: it lands in the same
-- millisecond as the ORDER's own breadcrumb (which every panel already reacts to by re-reading the
-- board, print jobs included), and it carries no table number — so it forces a WHOLE-floor reload
-- on every open manager and tablet screen where the order's own event would have refreshed one tile
-- (lib/floorSummary + realtime.js noteEvent: `spans` → full). Twice the reads, less precision.
-- So: reprints keep their instant wake, auto jobs ride the order they belong to.
DROP TRIGGER IF EXISTS rt_emit_print_jobs ON print_jobs;
CREATE TRIGGER rt_emit_print_jobs
  AFTER INSERT ON print_jobs
  FOR EACH ROW
  WHEN (NEW.reprint IS TRUE)
  EXECUTE FUNCTION lfh_rt_emit();
