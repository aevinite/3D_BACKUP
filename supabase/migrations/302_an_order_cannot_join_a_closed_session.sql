-- 302 — an order cannot outlive its session, INCLUDING the two ways it still could
--
-- WHY. Mig 232 made the rule "an order can never outlive its session" true for the case that
-- caused it: a FREE table showing a nine-day-old party's food and ₹1,150 due. It did that with
-- two triggers on `sessions` — a BEFORE UPDATE that fires on the transition
-- (NEW.status='closed' AND OLD.status<>'closed'), and a BEFORE DELETE. Both are correct.
--
-- Neither covers an INSERT, and the 520-phase run on 2026-08-05 found a live one: an order with
-- status='served' sitting unarchived on table "T9-erase" whose session was already `closed`. That
-- session's `closed_at` was NULL — proof it was never UPDATEd into `closed`, it was INSERTed that
-- way, so the transition trigger never ran and nothing archived its orders.
--
-- Two paths escape, and both put a departed party's food on a live table:
--   A. a session INSERTed already closed        → the close cleanup never runs at all
--   B. an order INSERTed onto a session that is ALREADY closed → the cleanup already ran, and
--      does not run again, so the new row simply stays on the floor
--
-- (B) is not hypothetical in a real restaurant: it is the race where a guest's phone submits an
-- order in the same second a waiter closes the table, or a queued offline order is replayed after
-- the party has left. The order must still be RECORDED — never silently dropped — it just must
-- not appear as the next party's food.
--
-- WHAT THIS DOES NOT DO: it does not delete or hide a sale. `archived` only means "not on the
-- floor" — the bill ledger, invoice history, Bills and the GST tables never filter on it, so no
-- sale changes value or disappears (mig 232 established that, and the compliance rules require
-- it). An order that is still owed for is CANCELLED, which is a visible ✕ record of a walk-out,
-- exactly as the existing close path does. Parked khata tabs (khata_at) keep their status,
-- because that is money to collect later.
--
-- Both halves reuse mig 232's rules line for line, so the app path, the close trigger and these
-- produce identical rows.

-- ── A) a session that is BORN closed gets the same cleanup ────────────────────
-- lfh_session_close_cleanup() is a BEFORE UPDATE function: it mutates NEW and returns it. On
-- INSERT the row is already being written, so the child-table work is the part that matters —
-- run it AFTER INSERT, against the row that landed.
CREATE OR REPLACE FUNCTION lfh_session_insert_closed_cleanup()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE session_members SET removed  = true    WHERE session_id = NEW.id AND NOT removed;
  UPDATE waiter_calls    SET resolved = true    WHERE session_id = NEW.id AND NOT resolved;
  UPDATE requests        SET status   = 'denied'
   WHERE table_number = NEW.table_number AND restaurant_id = NEW.restaurant_id AND status = 'pending';

  -- Money still owed → cancelled (a visible record), everything else → simply off the floor.
  UPDATE orders
     SET status = 'cancelled', archived = true,
         archived_at  = COALESCE(archived_at, NOW()),
         cancelled_at = COALESCE(cancelled_at, NOW())
   WHERE session_id = NEW.id AND NOT archived AND deleted_at IS NULL
     AND status <> 'cancelled' AND payment_status <> 'paid' AND khata_at IS NULL;

  UPDATE orders
     SET archived = true, archived_at = COALESCE(archived_at, NOW())
   WHERE session_id = NEW.id AND NOT archived AND deleted_at IS NULL;

  RETURN NULL;                       -- AFTER trigger: return value is ignored
END; $$;

DROP TRIGGER IF EXISTS trg_session_insert_closed ON sessions;
CREATE TRIGGER trg_session_insert_closed
  AFTER INSERT ON sessions
  FOR EACH ROW
  WHEN (NEW.status = 'closed')       -- the normal case (a session opens OPEN) costs nothing
  EXECUTE FUNCTION lfh_session_insert_closed_cleanup();

-- ── B) an order that arrives for an ALREADY-CLOSED session never reaches the floor ────
-- BEFORE INSERT so the row is written correct the first time — no second UPDATE, no window in
-- which a panel could read it as live, and no extra realtime breadcrumb.
CREATE OR REPLACE FUNCTION lfh_order_joins_closed_session()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_closed boolean;
BEGIN
  -- A session-less order (banquet, legacy) is NOT touched: mig 232's comment is explicit that a
  -- session-less row still counts, so no order is ever hidden. Only a row that names a session
  -- which is already finished is in scope.
  IF NEW.session_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.archived THEN RETURN NEW; END IF;                    -- caller already did the right thing

  SELECT (s.status IS DISTINCT FROM 'open') INTO v_closed
    FROM sessions s WHERE s.id = NEW.session_id;

  IF COALESCE(v_closed, false) THEN
    NEW.archived    := true;
    NEW.archived_at := COALESCE(NEW.archived_at, NOW());
    -- Same rule as the close path: still owed → cancelled (visible), settled or khata → left as is.
    IF COALESCE(NEW.status, '') <> 'cancelled'
       AND COALESCE(NEW.payment_status, '') <> 'paid'
       AND NEW.khata_at IS NULL THEN
      NEW.status       := 'cancelled';
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_order_joins_closed_session ON orders;
CREATE TRIGGER trg_order_joins_closed_session
  BEFORE INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION lfh_order_joins_closed_session();

-- Staff-only plumbing: nothing outside the database ever calls these (mig 038's rule, and the
-- guard added to verify:ui on 2026-08-05 fails a new migration that creates a function without
-- revoking public execute). Triggers fire as the table owner, so revoking changes no behaviour.
REVOKE ALL ON FUNCTION lfh_session_insert_closed_cleanup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_order_joins_closed_session()    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_session_insert_closed_cleanup() TO service_role;
GRANT  EXECUTE ON FUNCTION lfh_order_joins_closed_session()    TO service_role;

-- ── C) REPAIR what already escaped ────────────────────────────────────────────
-- The two triggers above stop this happening again; they do nothing about rows that already got
-- through. The 520-phase suite's phase 144 ("no order belongs to a session that is already
-- closed") checks CURRENT state, so without this the suite stays red after the fix — and, more to
-- the point, the table carrying that order would still hand a departed party's food to whoever
-- sits there next. One order was in this state on the backup database when this was written.
--
-- Same rules as everywhere else in this file, so a repaired row is indistinguishable from one the
-- close trigger handled at the time:
--   · deleted_at IS NULL  — a soft-deleted order is in the recycle bin, not on the floor, and
--                           mig 232 deliberately leaves those alone. Do not resurrect them.
--   · khata_at IS NULL    — a parked tab is money to collect later; only take it off the floor.
--   · unpaid              — cancelled, which is a VISIBLE walk-out record, never a silent erase.
-- Bounded by the join to sessions on an indexed key, and idempotent: re-running matches nothing.
WITH finished AS (
  SELECT o.id, o.payment_status, o.status, o.khata_at
    FROM orders o
    JOIN sessions s ON s.id = o.session_id
   WHERE o.archived = false
     AND o.deleted_at IS NULL
     AND s.status IS DISTINCT FROM 'open'
)
UPDATE orders o
   SET status       = CASE WHEN f.status <> 'cancelled'
                            AND COALESCE(f.payment_status, '') <> 'paid'
                            AND f.khata_at IS NULL
                           THEN 'cancelled' ELSE o.status END,
       cancelled_at = CASE WHEN f.status <> 'cancelled'
                            AND COALESCE(f.payment_status, '') <> 'paid'
                            AND f.khata_at IS NULL
                           THEN COALESCE(o.cancelled_at, NOW()) ELSE o.cancelled_at END,
       archived     = true,
       archived_at  = COALESCE(o.archived_at, NOW())
  FROM finished f
 WHERE o.id = f.id;
