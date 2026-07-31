-- 242 — CLASSIC or CUSTOM floor layout (owner, 2026-07-31)
--
-- The floor has always drawn tables in plain numeric order, N per row (the "classic" grid).
-- The owner wants a second mode for restaurants where the SHAPE of the room matters — where
-- the window seats are, which tables are in the A/C section, where the counter is:
--
--   "there will be a toggle option for classic and customise. Whenever custom is selected it
--    will be hardcoded by me according to restaurant structure … I will hardcode that, so you
--    don't need to do that."
--
-- So this is only the switch. The per-restaurant plan itself is DATA the owner writes by hand in
-- public/panels/floor-layouts.js (keyed by restaurant slug) — no editor, no admin drag-and-drop,
-- nothing generated. The panel reads the plan when this is 'custom' and falls back to the classic
-- grid (saying so, on screen) when a restaurant has no plan yet, so choosing custom can never
-- leave someone staring at an empty floor.
--
-- 'classic' is the default and stays the default for every existing restaurant.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS floor_layout_mode TEXT NOT NULL DEFAULT 'classic';

-- Only the two modes the panel knows how to draw. A typo would otherwise silently render as
-- "not classic" and take a restaurant's floor away mid-service.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settings_floor_layout_mode_chk'
  ) THEN
    ALTER TABLE settings
      ADD CONSTRAINT settings_floor_layout_mode_chk
      CHECK (floor_layout_mode IN ('classic', 'custom'));
  END IF;
END $$;
