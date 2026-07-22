-- 163 — fix_requests.mode: the owner picks WHICH Claude gets the problem (owner 2026-07-22:
-- "there will be 2 Claude — the night one and the solve-this-instant one — make sure of both").
--   'instant'   → the live-fix watcher pops a foreground terminal on the owner's Mac
--   'overnight' → left alone for the 02:30 night robot
-- Older rows (created before this column) default to 'instant' — matches the behaviour they had.
-- The night robot still sweeps EVERY open request regardless of mode, so an instant request the
-- Mac never saw (off/asleep) is never lost.

ALTER TABLE fix_requests
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'instant'
  CHECK (mode IN ('instant', 'overnight'));

NOTIFY pgrst, 'reload schema';
