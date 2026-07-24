-- 179 — Error rows get a "seen" and a "resolved" state (admin Everything Log + bell).
--
-- ⚠ MIGRATION NUMBER: next free after 178 (tablet_take_orders_cap). If a parallel branch
--   already took 179, renumber to the next free slot — this is purely additive (two nullable
--   columns + one partial index) and correct at ANY number, no ordering dependency.
--
-- WHY: before this, the admin panel had NO memory of the admin having dealt with an error.
--   Both the red error rows in the log AND the notification-bell badge were recomputed live
--   from staff_actions (level='error' in the last 24h) on every 60s poll, so nothing the admin
--   clicked could ever clear them — they nagged until they simply aged out after 24h. The owner
--   asked for TWO separate, deliberate states:
--     • RESOLVED — the admin marks an error handled; it then stops showing red in the log.
--     • SEEN     — opening the bell marks the shown errors seen; they stop counting on the badge
--                  (with a "mark unread" to clear seen_at and make it count again).
--   These are intentionally independent: an error you've SEEN (so the bell stops nagging) can
--   still be UNRESOLVED (still red in the log, because it's still a real un-fixed error).
--
-- Purely ADDITIVE & non-breaking. Both columns are nullable and default NULL, so every existing
-- row and every existing logAction insert is unchanged (a fresh error = seen_at NULL, resolved_at
-- NULL = unseen + unresolved, exactly today's behaviour).

-- 1) The two state columns. NULL = not seen / not resolved.
ALTER TABLE staff_actions
  ADD COLUMN IF NOT EXISTS seen_at     timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

-- 2) Cheap "unseen errors" read for the bell badge count (the hot, polled path). Partial index
--    so it only carries the handful of error rows that still need attention — tiny even as the
--    full log grows to millions of info rows.
CREATE INDEX IF NOT EXISTS idx_staff_actions_error_unseen
  ON staff_actions (created_at DESC)
  WHERE level = 'error' AND seen_at IS NULL;

NOTIFY pgrst, 'reload schema';
