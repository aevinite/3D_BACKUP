-- 372 — the printing MODE is not a thing any more. Take the dead key out of the module bag.
--
-- Owner, 2026-08-31: *"in admin panel also we don't need toggle"* … *"with toggle gone it on and off
-- will decide that the helper will be on and off and kitchen panel will always be on."*
--
-- WHAT THE KEY WAS. `settings.modules -> 'printing' -> 'mode'`, one of 'computer' | 'screen' (mig 326
-- put module ladders in the bag so a new module adds no column). It told the Printing board which of
-- two setups to render, and `writeMode()` rewrote all three paper lines whenever it moved.
--
-- WHY IT IS SAFE TO DROP, checked against the DATA and not assumed — three of seventeen restaurants
-- were carrying one:
--
--   AANGAN GARDEN RESTAURANT   mode=screen    kot route = a screen (kitchen)   → the ROUTE already
--     says everything the mode said. Nothing to carry across.
--   ZZ QA Test Bistro          mode=computer  kot route = unanswered           → auto-print is off
--     and not even allowed, so no paper is involved either way.
--   My Little French House     mode=computer  kot route = unanswered           → the one real change,
--     and it is the change he asked for: an unanswered kitchen-slip line used to resolve to "none",
--     which let ANY entitled screen print it. It now resolves to the KITCHEN screen specifically
--     (lib/printHelpers → resolveTarget). So printing narrows from "whichever screen got there" to
--     one room. That is "kitchen panel will always be on", and it is more predictable, but it does
--     mean a counter screen that happened to be doing it stops.
--
-- This is the rule about retiring a setting: move its MEANING first, then delete it. The meaning
-- lives in `routes`, which is where the paper always read it from — the mode was a second copy, and
-- a second copy that can disagree is the whole reason it is going.
--
-- IT REWRITES EXISTING DATA, so it is guarded: a re-seed re-runs every migration with no ledger, and
-- running this twice is harmless (the key is already gone) but the guard keeps the pattern honest and
-- the notice readable.
DO $mode_guard$
DECLARE v_applied boolean := false; v_rows int := 0;
BEGIN
IF to_regprocedure('public.lfh_already_applied(text)') IS NOT NULL THEN
  EXECUTE $probe$ SELECT lfh_already_applied('372_there_is_no_printing_mode') $probe$ INTO v_applied;
END IF;
IF v_applied THEN
  RAISE NOTICE '372_there_is_no_printing_mode: already applied — skipped';
  RETURN;
END IF;

UPDATE settings
SET modules = jsonb_set(modules, '{printing}', (modules -> 'printing') - 'mode')
WHERE modules -> 'printing' ? 'mode';
GET DIAGNOSTICS v_rows = ROW_COUNT;
RAISE NOTICE '372: dropped a dead printing.mode from % settings row(s)', v_rows;
END $mode_guard$;

-- A GUARD IN THE DATABASE ITSELF would be wrong here: the bag is deliberately free-form (that is the
-- point of mig 326 — a module adds no column), so a CHECK naming one forbidden key would have to be
-- edited every time a module retires a setting. `npm run verify:print-helper` asserts the code cannot
-- write one, which is the door the key would have to come back through.
