-- 265 — "Tables per row" really does go up to 30.
--
-- (Was numbered 260, renamed 2026-08-04: another session had already used 260 that evening
-- for 260_no_second_party_on_a_joined_table.sql, 62 minutes earlier. The two touch different
-- objects so the outcome never depended on which ran first, but verify:db-parity rightly refuses
-- a NEW duplicated number — the next collision is the one that WILL touch the same object.)
--
-- WHAT WENT WRONG. Migration 226 created floor_per_row with CHECK (2..12), because at the time
-- the grid refused to shrink a tile below a readability floor and 12 was all that fitted. On
-- 2026-07-31 the owner overruled that ("I will tell you how much tables I want in a particular
-- row — even if you have to make it very small, make it very small"): the tile now shrinks and
-- sheds detail, lib/floorLayout.ts went to FLOOR_PER_ROW_MAX = 30, the admin form, the manager's
-- Settings card and the server's clampPerRow() all followed — AND THE DATABASE DID NOT.
--
-- So the screen invited a number between 2 and 30, and anything over 12 was refused by this
-- constraint. On 2026-08-02 the owner set 18, saved three times, and got a blue "Sending 3 saved
-- changes… made while you were offline" bar on a perfectly good connection: the constraint threw,
-- the route reported it as a 500, and a 500 means "the server is too busy, keep it and retry" to
-- the offline queue. A permanently impossible write was being retried forever and blamed on his
-- internet. (The other half of that fault — a rejected VALUE must never be mistaken for a busy
-- server — is fixed in lib/dbRefusal.ts: it is now a 400 the person is shown.)
--
-- THE INVARIANT (corrected the same night, after the owner chose a fixed 2..12 picker): this
-- constraint is the OUTER bound and must never be NARROWER than lib/floorLayout.ts's
-- FLOOR_PER_ROW_MAX. Wider is harmless — the code clamps and the drop-down only offers the real
-- choices — while narrower is the exact fault above. So the range stays 2..30 even though the
-- screens now offer 2..12; if the max in the code ever goes past 30, widen this first.
ALTER TABLE settings
  DROP CONSTRAINT IF EXISTS settings_floor_per_row_range;
ALTER TABLE settings
  ADD CONSTRAINT settings_floor_per_row_range
  CHECK (floor_per_row >= 2 AND floor_per_row <= 30);

COMMENT ON COLUMN settings.floor_per_row IS
  'Target number of table tiles per row on the manager floor (2-30, mirrors lib/floorLayout.ts). The tile shrinks and sheds detail to honour the number; it only gives a column back below the 44px touch minimum.';
