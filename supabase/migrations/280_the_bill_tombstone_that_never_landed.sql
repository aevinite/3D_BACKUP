-- 280_the_bill_tombstone_that_never_landed.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- A whole-bill delete was supposed to tombstone the SESSION too. It never did.
--
-- HOW IT HID FOR SO LONG. `lib/softDelete.ts` built ONE stamp object and sent it to both tables:
--
--     const stamp = { deleted_at, deleted_by, deleted_by_id, delete_reason, archived, archived_at };
--     await sb.from("orders").update(stamp)...     -- fine: orders HAS archived/archived_at
--     await sb.from("sessions").update(stamp)...   -- REJECTED: sessions has neither column
--
-- and the second result was never checked, so it failed in silence. The admin ledger looked
-- correct anyway, because `deriveBillState` ALSO derives "deleted" from `orders.every(deleted)`
-- in JavaScript — so the screen was right while the column everything else depends on stayed
-- NULL. Found on 2026-08-04 by driving the deployed site: a real bill was deleted, the panel
-- correctly stopped showing it, and the ledger's new indexed `deleted_at is not null` query could
-- not find it. A scan then turned up 138 bills in exactly that state.
--
-- WHAT IT COST. `sessions.deleted_at` is what the 90-day retention window is measured from, what
-- `idx_sessions_deleted` (mig 188) indexes, and what the admin's "put this bill back" reads. A
-- whole-bill delete left none of that true — the restore promise rested on a JS fallback and the
-- retention clock never started.
--
-- The writer is fixed in the same change (two separate stamps, and neither UPDATE's error is
-- swallowed any more). This migration repairs the rows already in that state, so the indexed
-- query is correct for history as well as for everything from here.
--
-- SAFE AND CONSERVATIVE: it only fills a NULL `deleted_at`, only where EVERY order on the bill is
-- already deleted (so it is stating a fact the orders already record, not making a new decision),
-- and it takes the time from the orders themselves rather than now(), so the retention window is
-- measured from when the bill was actually removed. No order row is touched. Nothing is erased.
-- ─────────────────────────────────────────────────────────────────────────────

WITH fully_deleted AS (
  SELECT s.id,
         max(o.deleted_at)                     AS when_deleted,
         min(o.deleted_by)                     AS by_whom,
         min(o.delete_reason)                  AS why
    FROM sessions s
    JOIN orders   o ON o.session_id = s.id
   WHERE s.deleted_at IS NULL
   GROUP BY s.id
  HAVING count(*) FILTER (WHERE o.deleted_at IS NULL) = 0   -- every order on the bill is deleted
     AND count(*) > 0
)
UPDATE sessions s
   SET deleted_at    = f.when_deleted,
       deleted_by    = COALESCE(s.deleted_by, f.by_whom),
       delete_reason = COALESCE(s.delete_reason,
                                COALESCE(f.why, 'tombstone repaired by mig 280 — every order on this bill was deleted'))
  FROM fully_deleted f
 WHERE s.id = f.id;

-- Afterwards this must be 0. If it is not, the writer regressed again:
--   select count(*) from sessions s
--    where s.deleted_at is null
--      and exists (select 1 from orders o where o.session_id = s.id)
--      and not exists (select 1 from orders o where o.session_id = s.id and o.deleted_at is null);

NOTIFY pgrst, 'reload schema';
