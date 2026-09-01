-- ⚠ RENUMBERED 369 → 376 (2026-09-01, while merging every open PR).
--   FOUR files were sitting at 369, each written by a different lane on 2026-08-28 and each in its
--   own unmerged branch, so nothing noticed until they landed on main together. `npm run
--   verify:grants` refuses a NEW duplicate number, and it is right to: with several files at one
--   number a re-seed applies them in FILENAME order, which is not an order anybody chose.
--   The one that KEEPS 369 is the earliest by commit time (00:01 — a_purge_clears_the_pending_
--   printer_handshakes); this one was committed at 12:07, so it moved.
--
--   CHECKED BEFORE MOVING, not assumed:
--     · every statement here is CREATE OR REPLACE / IF NOT EXISTS or wrapped in lfh_applied_once,
--       so running it at a later position is safe and re-running it is a no-op;
--     · the applied-once KEY inside this file is unchanged, so a database where it has already run
--       does not run it again — renaming the file must never change that key;
--     · nothing created by 370-373 is used here, and nothing here is undone by them (370 and 371
--       only replace two unrelated functions; 372 removes a dead `modules.printing.mode` key while
--       the print-route file below writes `modules.printing.routes.kot`, a different key; 373 adds a
--       settings column).
--   Moving a migration LATER can only be safer than moving one earlier — the same reasoning the
--   352 → 364 renumber recorded.
-- 369 — the old "which screen prints the kitchen slips?" setting becomes a ROUTE, and retires.
--
-- Owner, 2026-08-28, about the leftover select on the Printing board: *"right now I don't understand
-- three options 'With no answer on the Kitchen slips line below, which screen prints them?' — what do
-- you mean by this option?"* — and then *"do what's left"*. He was right that it is clutter: it asks
-- the SAME question as the Kitchen slips line, in older and vaguer words.
--
-- WHY THIS IS A MIGRATION AND NOT A DELETED DROPDOWN. On the dev stack, 2 of 17 restaurants —
-- French House and Aangan, the two he actually tests with — are on `kot_print_target = 'both'`, and
-- NEITHER has answered the Kitchen slips line. Deleting the setting without carrying its meaning
-- across would silently change how both of them print: 'both' means "the kitchen screen prints, and
-- a counter screen may pick up anything it has left sitting for 30 seconds", and that safety net
-- would just quietly stop existing. So the meaning moves first, and the setting goes second.
--
-- THE MAPPING, in the route model (settings.modules.printing.routes.kot):
--   'kitchen' → { via:"screen", panel:"kitchen" }                                    (the default)
--   'counter' → { via:"screen", panel:"manager" }
--   'both'    → { via:"screen", panel:"kitchen", backupPanel:"manager", backupAfterMs:30000 }
--
-- ONLY restaurants that have NOT answered the Kitchen slips line are touched. A restaurant that has
-- already chosen — a computer, a screen, or "nobody" — has made a newer decision, and this migration
-- must never overwrite it. That precedence is not new: the app has preferred the route over the
-- coarse target since 2026-08-26, when the printing sweep caught the two disagreeing and the older
-- one winning.
--
-- THE COLUMN IS LEFT IN PLACE. Schema changes here are additive, one migrations folder feeds two
-- databases, and dropping a column is the one change that cannot be undone by re-running anything.
-- Nothing reads it after this commit; it is marked retired so the next person does not wire it back.
DO $carry_target_once$
DECLARE
  v_applied boolean := false;
  v_row     record;
  v_kot     jsonb;
  v_answered boolean;
  v_n       int := 0;
BEGIN
  IF to_regprocedure('public.lfh_already_applied(text)') IS NOT NULL THEN
    EXECUTE $probe$ SELECT lfh_already_applied('369_kot_print_target_to_route') $probe$ INTO v_applied;
  END IF;
  IF v_applied THEN
    RAISE NOTICE '369: the coarse print target has already been carried across once — skipped';
    RETURN;
  END IF;

  FOR v_row IN
    SELECT restaurant_id,
           COALESCE(kot_print_target, 'kitchen') AS target,
           COALESCE(modules, '{}'::jsonb)        AS modules
      FROM settings
  LOOP
    v_kot := v_row.modules #> '{printing,routes,kot}';

    -- "Answered" is the same test the screens use: a computer named, a panel named, or a deliberate
    -- off. An absent line, or one holding only nulls, has never been answered.
    v_answered := v_kot IS NOT NULL AND (
         (v_kot ->> 'via') = 'off'
      OR (v_kot ->> 'via') = 'screen'
      OR (v_kot ->> 'agent') IS NOT NULL
    );
    IF v_answered THEN
      CONTINUE;                                   -- a newer decision exists; never overwrite it
    END IF;

    UPDATE settings
       SET modules = jsonb_set(
             jsonb_set(
               jsonb_set(COALESCE(modules, '{}'::jsonb), '{printing}',
                         COALESCE(modules -> 'printing', '{}'::jsonb), true),
               '{printing,routes}',
               COALESCE(modules #> '{printing,routes}', '{}'::jsonb), true),
             '{printing,routes,kot}',
             CASE v_row.target
               WHEN 'counter' THEN
                 jsonb_build_object('via', 'screen', 'panel', 'manager',
                                    'agent', NULL, 'printer', NULL)
               WHEN 'both' THEN
                 jsonb_build_object('via', 'screen', 'panel', 'kitchen',
                                    'agent', NULL, 'printer', NULL,
                                    'backupPanel', 'manager', 'backupAfterMs', 30000)
               ELSE
                 jsonb_build_object('via', 'screen', 'panel', 'kitchen',
                                    'agent', NULL, 'printer', NULL)
             END,
             true)
     WHERE restaurant_id = v_row.restaurant_id;
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE '369: % restaurant(s) had the old coarse target written into the Kitchen slips line', v_n;

  IF to_regclass('public.lfh_applied_once') IS NOT NULL THEN
    INSERT INTO lfh_applied_once (key, note) VALUES
      ('369_kot_print_target_to_route',
       'one-time carry of settings.kot_print_target (mig 336) into settings.modules.printing.routes.kot. Re-running would overwrite choices made AFTER this ran, which is exactly what the marker prevents.')
    ON CONFLICT (key) DO NOTHING;
  END IF;
END $carry_target_once$;

-- RETIRED, not dropped. Say so on the column itself, because a column that still holds a plausible
-- value is the thing somebody wires back up by accident.
COMMENT ON COLUMN public.settings.kot_print_target IS
  'RETIRED 2026-08-28 (mig 369). Was the coarse kitchen|counter|both answer from mig 336. Its meaning now lives in settings.modules.printing.routes.kot — a screen route with an optional backupPanel. NOTHING READS THIS COLUMN. Do not wire it back: two settings for one question is what made the manager screen refuse the owner''s own choice in August.';

NOTIFY pgrst, 'reload schema';
