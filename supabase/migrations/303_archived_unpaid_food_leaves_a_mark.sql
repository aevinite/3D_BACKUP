-- 303 — UNPAID FOOD TAKEN OFF THE FLOOR BY HAND LEFT NO MARK (T16 sweep, 2026-08-05)
--
-- Migration 232 installed this system's rule for work with no owner: when a party ends, unpaid
-- non-khata food becomes a VISIBLE ✕ cancelled record and everything else is merely archived.
-- It deliberately lives on the session status change, so every close honours it — the app path,
-- a script, a hand-run UPDATE alike. Migration 243 then repaired the rows that predated it.
--
-- There was a SECOND door into the same outcome that did not honour the rule: the manager panel's
-- "free this table" archives each order with `PATCH /orders/:id { archived: true }`, which set the
-- flag and left `status` alone. Its own comment assumes "the orders left here are cancelled or
-- settled" — nothing enforced that. So an unpaid, still-cooking order could leave the live floor
-- still reading 'preparing': invisible on the floor, with no cancellation, no `cancelled_at`, and
-- nothing recording that a walk-out had happened. The code half is fixed in the same commit as
-- this file (the route now applies migration 232's own decision, and writes the audit row).
--
-- FOUND IN THE DATA, not by reading it: 9 such orders on French House, two of them ₹4,189.50,
-- all archived by hand on 2026-08-04. Aangan — the control restaurant, only ever read — had
-- none, which is what you would expect of something reached by a person pressing a button.
--
-- WHAT THIS DOES — the same two moves as migrations 232 and 243, so there is ONE rule in this
-- system for work nobody owns:
--   · unpaid, not a parked khata tab  → status 'cancelled' + cancelled_at (a VISIBLE ✕ record);
--   · anything else                   → untouched.
-- NOTHING is deleted and nothing is hidden. Archived rows stay in Bills, in the records search
-- and in every report (reports never filter `archived`), and a cancelled order keeps its money on
-- the books as a void — exactly how the app's own ✕ Cancel behaves.
-- (docs/COMPLIANCE-GUARDRAILS.md: a sale is never erased, only marked.)
--
-- WHICH ROWS — deliberately narrow, and re-runnable. An order qualifies only when ALL hold:
--   · it is ARCHIVED (already off the live floor — this changes what the record SAYS, not where
--     the order is, so no tile and no total moves);
--   · it is NOT already cancelled;
--   · it is NOT paid;
--   · it is NOT a parked khata tab (that money is still to be collected — mig 232's exception);
--   · it is not soft-deleted.
-- After it runs, the same predicate matches nothing, so a second run is a no-op.

UPDATE orders
   SET status       = 'cancelled',
       cancelled_at = COALESCE(cancelled_at, archived_at, NOW())
 WHERE archived = true
   AND deleted_at IS NULL
   AND khata_at IS NULL
   AND status <> 'cancelled'
   AND payment_status <> 'paid';

-- A cancellation that predates this repair has no actor to name, and inventing one would be worse
-- than leaving it blank: the deletion_audit is a record of who did what, and "the 2026-08-05
-- repair" is the honest answer. It is recorded here in the schema rather than as 9 audit rows
-- attributed to a person who never pressed anything.
COMMENT ON COLUMN orders.cancelled_at IS
  'When the order was voided. Set by the ✕ Cancel action, by the session-close cleanup (mig 232), '
  'and by the archive rule in the editor PATCH route (mig 303). Rows repaired by mig 303 carry '
  'their archived_at here, because that is when the food actually left the floor.';

NOTIFY pgrst, 'reload schema';
