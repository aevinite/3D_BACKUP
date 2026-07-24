-- 181 — let the owner mark an error RESOLVED themselves (owner 2026-07-24: "there should be an
-- option of resolve, separate from Fix now/overnight, with an are-you-sure step").
--
-- ⚠ MIGRATION NUMBER: next free after 180. Additive, nullable column + one partial index — safe
--   at any number; renumber if a parallel branch takes 181 first.
--
-- `resolved_at` NULL = still an open problem (shows on admin → Repair "Problems right now" and
-- feeds the dashboard red button); non-NULL = the owner (or a fix) cleared it. The FULL activity
-- log still shows resolved rows — only the Repair problem list + the red-button count hide them.
-- No default, nullable → the ADD is instant (no table rewrite) on this hot append-heavy table.

ALTER TABLE staff_actions ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

-- Keeps the "unresolved errors" list + count cheap (mirrors the level='error' partial index from
-- mig 159, now also excluding resolved rows).
CREATE INDEX IF NOT EXISTS idx_staff_actions_open_error
  ON staff_actions (created_at DESC)
  WHERE level = 'error' AND resolved_at IS NULL;

NOTIFY pgrst, 'reload schema';
