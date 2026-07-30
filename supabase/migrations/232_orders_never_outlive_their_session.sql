-- 232_orders_never_outlive_their_session.sql
--
-- OWNER REPORT 2026-07-30: "whenever I open the table, it was already in the preparation
-- mode." Opening a FREE table on Aangan's manager floor showed it instantly as
-- "Preparing · 0/5 served · ₹1,150 due" with three KOTs (#16/#17/#18) attached — orders
-- placed NINE DAYS earlier, by a party whose session had been closed on 2026-07-29.
--
-- TWO things had to be true for that to happen, and this migration kills the second one:
--
--   1. The panels decided "which orders are at this table?" by table_number alone, so a
--      NEW party inherited whatever live rows were lying around (fixed in the same PR:
--      public/panels/{editor,tablet}/app.js now scope by the CURRENT session id, which is
--      what the server's lfh_table_view_summary has always done).
--
--   2. THIS: orders could outlive their session. Closing a table only archives its orders
--      in the APP path (lib/sessionClose.ts) and in the bulk RPC (mig 103). The DB's own
--      close-cleanup trigger (mig 020, last touched in 146) cleared the cart, the members,
--      the waiter-calls and the pending requests — but never the ORDERS. So ANY other way
--      of closing a session left its food on the floor forever:
--        • a maintenance/QA script doing UPDATE sessions SET status='closed'  ← what made
--          the owner's three ghosts (no table_close row exists in staff_actions for them),
--        • lfh_leave_session (mig 020) when the last guest leaves,
--        • a hand-run SQL fix, an admin tool, any future path we haven't written yet.
--      12 such rows existed on the dev DB at the time of writing, across 6 tables.
--
-- The rule this migration installs: **an order can never outlive its session.** The
-- cleanup now lives with the STATUS CHANGE ITSELF, so it applies to every path equally.
--
-- COMPLIANCE (docs/COMPLIANCE-GUARDRAILS.md): nothing is deleted or hidden. Unpaid,
-- non-khata work becomes a VISIBLE ✕ Cancelled record (exactly what the app's own
-- close path has done since 2026-07-24 — a walk-out must leave a trace); everything
-- else is merely ARCHIVED, which only means "off the live floor" — reports, the Bills
-- ledger and the GST tables never filter on `archived`, so no sale changes value or
-- disappears. Khata (parked pay-later tabs) are deliberately NOT cancelled: that money
-- is still to be collected.

-- ── 1) CLOSE: mig 146's cleanup, VERBATIM + the orders block ──────────────────
CREATE OR REPLACE FUNCTION lfh_session_close_cleanup()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'closed' AND COALESCE(OLD.status, '') <> 'closed' THEN
    NEW.cart := '[]'::jsonb;
    IF NEW.closed_at IS NULL THEN NEW.closed_at := NOW(); END IF;
    UPDATE session_members SET removed = true WHERE session_id = NEW.id AND NOT removed;
    UPDATE waiter_calls   SET resolved = true WHERE session_id = NEW.id AND NOT resolved;
    UPDATE requests       SET status = 'denied' WHERE table_number = NEW.table_number AND restaurant_id = NEW.restaurant_id AND status = 'pending';
    -- NEW: the party's food leaves the floor WITH the party. Mirrors lib/sessionClose.ts
    -- line for line, so the app path and this net produce identical rows (the app path's
    -- own UPDATEs then simply match nothing — same outcome, no double work).
    -- Money still owed is CANCELLED: a visible ✕ record of a walk-out, never a silent
    -- erase. Parked khata tabs (khata_at) are money to collect later — leave their status.
    UPDATE orders
       SET status = 'cancelled', archived = true,
           archived_at = COALESCE(archived_at, NOW()),
           cancelled_at = COALESCE(cancelled_at, NOW())
     WHERE session_id = NEW.id AND NOT archived AND deleted_at IS NULL
       AND status <> 'cancelled' AND payment_status <> 'paid' AND khata_at IS NULL;
    -- Everything else (settled bills, khata tabs) just stops being "on the floor".
    UPDATE orders
       SET archived = true, archived_at = COALESCE(archived_at, NOW())
     WHERE session_id = NEW.id AND NOT archived AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END; $$;

-- ── 2) DELETE: same net for a session ROW that is deleted outright ────────────
-- orders.session_id is ON DELETE SET NULL (mig 014), so deleting a session used to turn
-- its live orders into SESSION-LESS rows still carrying table_number — and a session-less
-- row at a table is treated as belonging to whoever sits there next (mig 049 even adopts
-- them into the new session). Archive them BEFORE the link is cut. (mig 024's trigger,
-- last touched in 146, kept verbatim + the orders block.)
CREATE OR REPLACE FUNCTION lfh_session_delete_cleanup()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE waiter_calls SET resolved = true WHERE session_id = OLD.id AND NOT resolved;
  UPDATE requests     SET status = 'denied' WHERE table_number = OLD.table_number AND restaurant_id = OLD.restaurant_id AND status = 'pending';
  UPDATE orders
     SET status = 'cancelled', archived = true,
         archived_at = COALESCE(archived_at, NOW()),
         cancelled_at = COALESCE(cancelled_at, NOW())
   WHERE session_id = OLD.id AND NOT archived AND deleted_at IS NULL
     AND status <> 'cancelled' AND payment_status <> 'paid' AND khata_at IS NULL;
  UPDATE orders
     SET archived = true, archived_at = COALESCE(archived_at, NOW())
   WHERE session_id = OLD.id AND NOT archived AND deleted_at IS NULL;
  RETURN OLD;
END; $$;

-- ── 3) ONE-TIME BACKFILL: the ghosts already lying on the floors ──────────────
-- ARCHIVE ONLY — deliberately NOT cancel. Taking these off the live floor is a display
-- correction (the floor summary already ignores them; only the panels' table_number match
-- resurrected them). CANCELLING them would be a money DECISION about a table a human
-- closed days ago, and no script should make that call: an unpaid leftover therefore
-- stays exactly as unpaid in the Bills ledger and in every report. Going forward, part 1
-- makes the decision AT CLOSE TIME, where the staff member is present.
UPDATE orders o
   SET archived = true, archived_at = COALESCE(o.archived_at, NOW())
 WHERE NOT o.archived
   AND o.deleted_at IS NULL
   AND o.session_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM sessions s WHERE s.id = o.session_id AND s.status = 'closed');

NOTIFY pgrst, 'reload schema';
