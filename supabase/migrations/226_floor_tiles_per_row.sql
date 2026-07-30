-- 226 — "Tables per row" on the manager floor, set by the ADMIN per restaurant.
--
-- Replaces the manager's per-device S/M/L tile-size toggle (localStorage
-- "lfh_floor_tile_density"), which every device remembered differently and no
-- admin could set. Now ONE number per restaurant decides how many table tiles
-- sit on a row, and the tile size follows from it.
--
-- The number is a TARGET, not a hard rule: the CSS asks for this many per row
-- but never squeezes a tile below its readable floor (~104px), so a narrow
-- screen quietly shows fewer per row instead of a row of slivers. That is what
-- keeps a 300-table restaurant on a phone from rendering unusably.
--
-- Range 2..12 — matches what actually fits and still looks good in the manager
-- floor area (measured: ~1150px with the side rail open, ~1550px collapsed).
-- 6 is the default because it reproduces the old "M" density most closely.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS floor_per_row INT NOT NULL DEFAULT 6;

ALTER TABLE settings
  DROP CONSTRAINT IF EXISTS settings_floor_per_row_range;
ALTER TABLE settings
  ADD CONSTRAINT settings_floor_per_row_range
  CHECK (floor_per_row >= 2 AND floor_per_row <= 12);

COMMENT ON COLUMN settings.floor_per_row IS
  'Admin-set target number of table tiles per row on the manager floor (2-12). The CSS never shrinks a tile below its readable floor, so narrow screens show fewer.';
