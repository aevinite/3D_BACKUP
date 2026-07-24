-- 182 — error rows get a "seen" state for the notification bell (owner 2026-07-24).
--
-- ⚠ MIGRATION NUMBER: next free after 181 (resolve_errors). Additive, one nullable column + one
--   partial index — safe at any number; renumber if a parallel branch takes 182 first.
--
-- WHY: mig 181 already gave errors a RESOLVED state (the admin marks a problem handled → it stops
--   showing red and drops off the Repair list + dashboard "Fix problems" count). But the top-bar
--   notification bell had a SEPARATE gap: its red badge was recomputed live from "errors in the
--   last 24h" every 60s with no memory of the admin having glanced at them, so merely opening the
--   bell could never clear it — it nagged until the errors aged out (owner: "stop showing in the
--   notification when it has been seen"). SEEN is deliberately independent of RESOLVED: opening the
--   bell marks the shown errors seen (badge clears) without claiming they're fixed; a per-error
--   "mark unread" clears seen_at so the badge shows again on purpose.
--
-- Purely ADDITIVE & non-breaking. Nullable, no default → the ADD is instant on this hot
-- append-heavy table, and every existing row / logAction insert is unchanged (seen_at NULL =
-- unseen = today's behaviour).

ALTER TABLE staff_actions ADD COLUMN IF NOT EXISTS seen_at timestamptz;

-- Cheap "unseen errors" read for the bell badge count (the hot, polled path). Partial index so it
-- only carries the handful of error rows still un-glanced — tiny even as the log grows to millions.
CREATE INDEX IF NOT EXISTS idx_staff_actions_error_unseen
  ON staff_actions (created_at DESC)
  WHERE level = 'error' AND seen_at IS NULL;

NOTIFY pgrst, 'reload schema';
