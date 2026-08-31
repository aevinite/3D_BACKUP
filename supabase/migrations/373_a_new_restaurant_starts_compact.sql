-- 373 — a NEW restaurant's floor starts compact, the way the owner asked.
--
-- (Numbered 372 when it was written; renumbered on 2026-08-31 because another lane took 372 for
-- `372_there_is_no_printing_mode.sql` and reached `main` first. `verify:ui-integrity` refuses a
-- duplicated number, and it is right to: the next collision is the one that touches the same object.
-- Briefly 374, on my own assumption that 373 was spoken for — it was not. Checked properly: every
-- worktree on this machine, and `git log --all --diff-filter=A -- 'supabase/migrations/373_*'`. A
-- guessed gap is its own fault, and `verify:grants` says so: "373 are MISSING from the sequence".)
--
-- WHAT WAS WRONG (T25 round 3, item 37, 2026-08-31).
--
-- `settings.floor_per_row` decides how many table tiles the manager's floor puts in a row. Two
-- defaults exist for it and they disagreed:
--
--   · lib/floorLayout.ts → FLOOR_PER_ROW_DEFAULT = 12, with the reason written beside it:
--     "compact by default (owner, 2026-07-31)";
--   · this column → DEFAULT 6, set by migration 226 on 2026-07-27, four days BEFORE that decision.
--
-- The code default only applies when the value is absent or unreadable. The column default is what a
-- brand-new restaurant actually gets — so every restaurant created since has started on 6 per row,
-- which is the opposite of compact. MEASURED on the dev estate before this migration: of 17
-- restaurants, **13 sit on 6**, 2 on 7 and 2 on 12. The thirteen were never a choice anybody made.
--
-- WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT.
--
-- Only the DEFAULT for rows inserted from now on. **No existing row is touched.** A restaurant whose
-- floor is on 6 today keeps 6 — that number is on somebody's screen, and silently re-laying out
-- thirteen live floors is not a fix, it is a surprise. If a restaurant wants 12 it is one picker away
-- (manager → Settings → Tables per row, or admin → the restaurant's settings card).
--
-- The CHECK constraint is untouched: migration 265 deliberately leaves it wider (2..30) than the
-- code's FLOOR_PER_ROW_MAX (12), because a constraint NARROWER than the code is what once made a
-- perfectly good save look like a broken internet connection. 12 sits inside 2..30, so nothing here
-- can trip it.
--
-- Idempotent, and safe to re-run: setting a default twice is the same as setting it once.

ALTER TABLE settings
  ALTER COLUMN floor_per_row SET DEFAULT 12;

COMMENT ON COLUMN settings.floor_per_row IS
  'Target number of table tiles per row on the manager floor (2-30 by constraint, 2-12 offered by the '
  'screens, mirrors lib/floorLayout.ts). New restaurants start at 12 — compact — matching '
  'FLOOR_PER_ROW_DEFAULT (owner, 2026-07-31). The tile shrinks and sheds detail to honour the number; '
  'it only gives a column back below the 44px touch minimum.';
