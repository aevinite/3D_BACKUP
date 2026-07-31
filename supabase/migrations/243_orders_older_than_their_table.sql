-- 243 — AN ORDER OLDER THAN THE PARTY IS NOT THE PARTY'S (owner report, 2026-07-31)
--
-- Table 2 showed "0/1 served · ₹441" on its tile and "7 dishes · ₹6,048" in its detail. The two
-- numbers came from two readers of the same table: the server counted only the current party's
-- one dish (right), the browser also counted two live orders from 7 JULY that had **no session at
-- all** — because every reader admitted "any session-less row" with no date test. Tapping
-- "Mark all paid" there would have charged that evening's guests for food ordered 24 days earlier.
--
-- The READING side is fixed in code (the ?table= slice, the manager's ordersForTable and the
-- waiter's ordersOf now require a party-less row to be NEWER than the party sitting there). This
-- migration deals with the rows themselves, because they are still live in the data:
--   · 39 of them on the dev floor when this was written, ₹12,873 between them, oldest 7 July;
--   · 28 still marked New/Cooking, so they sit on the KITCHEN pass as three-week-old tickets that
--     no waiter can clear.
-- The same shape exists on any database that ran the old code, which is why this is a migration
-- and not a one-off script.
--
-- WHAT IT DOES — the same two moves migration 232 makes when a session closes, so there is one
-- rule in this system for "work that has no owner":
--   · unpaid, not a parked khata tab  → status 'cancelled' (a VISIBLE ✕ record) + archived;
--   · anything else (settled bills, khata tabs) → archived only, status untouched.
-- NOTHING is deleted and nothing is hidden: archived rows stay in Bills, in the records search
-- and in every report (reports never filter `archived`). A cancelled order keeps its money on the
-- books as a void, which is exactly how the app's own ✕ Cancel behaves.
--
-- WHICH ROWS — deliberately narrow. An order is only "ownerless" here when ALL of these hold:
--   · it has NO session id at all (a row belonging to a session is already handled by mig 232);
--   · it sits at a REAL table (a takeaway/parcel order legitimately has no table and no party —
--     those are never touched);
--   · it is still on the floor (not archived, not deleted);
--   · and it cannot belong to whoever is there now: either it predates the table's current open
--     session, or the table has no open session and the order is more than 12 hours old.
-- A party-less order taken DURING the current sitting (a banquet line, a legacy path) is left
-- exactly where it is — never hide an order that might be someone's.
--
-- Migration 240 (another session, same day) wrote down the guest-order function that closed the
-- source of these — the guest QR path now always attaches a party — so this is a backfill, not a
-- recurring sweep.

WITH ownerless AS (
  SELECT o.id, o.payment_status, o.khata_at
    FROM orders o
    LEFT JOIN LATERAL (
      SELECT s.opened_at
        FROM sessions s
       WHERE s.restaurant_id = o.restaurant_id
         AND s.table_number  = o.table_number
         AND s.status        = 'open'
       ORDER BY s.last_activity_at DESC NULLS LAST
       LIMIT 1
    ) cur ON TRUE
   WHERE o.session_id IS NULL
     AND o.table_number IS NOT NULL
     AND o.archived = false
     AND o.deleted_at IS NULL
     AND o.status <> 'cancelled'
     AND (
           -- someone is sitting there now, and this order is older than them
           (cur.opened_at IS NOT NULL AND o.created_at < cur.opened_at - INTERVAL '60 seconds')
           -- nobody is sitting there, and it has been on the floor long enough to be nobody's
        OR (cur.opened_at IS NULL     AND o.created_at < NOW() - INTERVAL '12 hours')
         )
)
UPDATE orders o
   SET status       = CASE WHEN w.payment_status <> 'paid' AND w.khata_at IS NULL THEN 'cancelled' ELSE o.status END,
       cancelled_at = CASE WHEN w.payment_status <> 'paid' AND w.khata_at IS NULL THEN COALESCE(o.cancelled_at, NOW()) ELSE o.cancelled_at END,
       archived     = true,
       archived_at  = COALESCE(o.archived_at, NOW())
  FROM ownerless w
 WHERE o.id = w.id;
