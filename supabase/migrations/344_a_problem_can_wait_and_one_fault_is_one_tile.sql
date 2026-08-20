-- 344 · The Repair board learns to tell the truth about itself
--
-- ⚠ MIGRATION NUMBER: next free after 343. Safe to renumber to the next free slot if a parallel
--   branch took it — the schema part is ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS and
--   is correct at any number. The two DATA rewrites below carry the migration-307 ledger guard,
--   because a re-seed re-runs every migration with no ledger of its own.
--
-- Three things, all from the same complaint: the admin's "Problems right now" board had started to
-- be ignored. Nineteen tiles, four of them a fortnight old, several of them the same fault twice,
-- and five naming no restaurant at all — so the one control meant to narrow the page hid exactly
-- the rows it was opened for.
--
-- NOTHING HERE HIDES A PROBLEM. There is deliberately still no "mute": part C adds a WAIT, which
-- expires by itself and puts the tile back. A brand-new occurrence of anything is never affected —
-- it lands on the board as loudly as any other error. (Migration 219's note on this stands.)

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- A · A PROBLEM CAN BE "NOT NOW" WITHOUT BEING A LIE (owner, 2026-08-20)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The board offered exactly two answers: mark it resolved, or leave it red. Neither is true of a
-- problem you have SEEN, understood, and decided to deal with next week — pressing Resolve writes a
-- record saying it was handled when it was not (and, via migs 218/219, tells Fix-now the problem is
-- already fixed), and leaving it red is how a board with four fortnight-old tiles teaches you to
-- stop reading it.
--
-- `snoozed_until` is a WAIT, not a mute:
--   · the tile leaves the board until that moment, then comes back on its own;
--   · `resolved_at` stays NULL — the problem is still open, and every list that reads the log
--     unfiltered (Audit & logs) still shows it, marked as waiting;
--   · a NEW occurrence of the same fault writes a NEW row, which has no snooze on it. So snoozing
--     "printer failed" cannot silence tonight's printer failure.
ALTER TABLE staff_actions ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;

COMMENT ON COLUMN staff_actions.snoozed_until IS
  'Repair board only: hide this error tile until this moment, then show it again. NEVER a mute — resolved_at stays NULL, the row stays in the log, and a fresh occurrence writes a fresh row with no snooze.';

-- The board's read is "level=error AND resolved_at IS NULL", already served by
-- idx_staff_actions_open_error. The snooze test rides along in the index so the extra condition
-- costs no heap visit; a partial index cannot reference now(), so the comparison stays in the query.
CREATE INDEX IF NOT EXISTS idx_staff_actions_open_error_wait
  ON staff_actions (created_at DESC) INCLUDE (snoozed_until)
  WHERE level = 'error' AND resolved_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- B · A TILE WHOSE ADDRESS NAMES ITS RESTAURANT SHOULD NAME IT TOO
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Five tiles carried no restaurant, three of them from the French House guest menu — whose logged
-- address is literally `/r/french-house/menu`. They arrived that way because the React error
-- boundaries reported through lib/errorReport.ts, which never sent a restaurant at all (only the
-- static panels tagged the tenant). Both halves are fixed in code — the reporter now sends what the
-- page knows, and /api/log/client-error reads the slug off the address for everything else — and
-- this backfills the rows ALREADY on the board so the picker can reach them today.
--
-- Only where the address names a slug that is a LIVE restaurant right now. A slug that has since
-- been renamed matches nothing and stays unattributed on purpose: putting the wrong restaurant on
-- a problem is worse than putting none.
DO $$
DECLARE v_applied boolean := false; v_n integer := 0;
BEGIN
IF to_regprocedure('public.lfh_already_applied(text)') IS NOT NULL THEN
  EXECUTE $probe$ SELECT lfh_already_applied('344_backfill_error_restaurant_from_address') $probe$ INTO v_applied;
END IF;
IF v_applied THEN
  RAISE NOTICE '344_backfill_error_restaurant_from_address: already applied — skipped';
ELSE
  WITH found AS (
    SELECT a.id, r.id AS rid
    FROM staff_actions a
    JOIN restaurants r
      ON r.deleted_at IS NULL
     AND r.slug = lower(substring(a.detail FROM '/r/([a-z0-9][a-z0-9-]*)'))
    WHERE a.restaurant_id IS NULL
      AND a.level = 'error'
  )
  UPDATE staff_actions a SET restaurant_id = f.rid
  FROM found f WHERE a.id = f.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '344: named the restaurant on % error row(s) from their own address', v_n;
END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- C · ONE FAULT, ONE TILE — the stored "already fixed" record follows the new signature
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The same line of code reported by two paths arrives written two ways — window.onerror sends
-- "Uncaught ReferenceError: X is not defined", a caught error's .message sends "X is not defined" —
-- so the board counted one fault as two tiles (one of them ×8) and Fix-now could open two Claude
-- sessions for it. lib/errorSignature.ts now drops that reporter decoration before comparing.
--
-- The signatures already STORED in error_signatures were written the old way, so without this the
-- "already fixed" record would quietly stop matching the very problems it was written for, and
-- Fix-now would send Claude to redo finished work. Same regex as the TypeScript, applied once.
--
-- error_signatures_key_uniq is UNIQUE on (restaurant, panel, action, sig), so two rows can collapse
-- onto one key. The EARLIEST fix wins — that is the one whose pr_url actually fixed it — and the
-- later duplicate goes. Nothing is hidden either way: these rows only answer "have we fixed this
-- before?", they never keep an error off the board.
DO $$
DECLARE v_applied boolean := false; v_dupes integer := 0; v_upd integer := 0;
  c_prefix text := '^\s*(uncaught\s+)?(\(in\s+promise\)\s*:?\s*)?([a-z]*error|domexception)\s*:\s*';
BEGIN
IF to_regprocedure('public.lfh_already_applied(text)') IS NOT NULL THEN
  EXECUTE $probe$ SELECT lfh_already_applied('344_normalise_error_signatures') $probe$ INTO v_applied;
END IF;
IF v_applied THEN
  RAISE NOTICE '344_normalise_error_signatures: already applied — skipped';
ELSE
  -- 1 · drop the duplicates that normalising would collide with (keep the earliest fix)
  WITH norm AS (
    SELECT id, panel, action,
           COALESCE(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid) AS rk,
           regexp_replace(sig, c_prefix, '', 'i') AS newsig,
           fixed_at
    FROM error_signatures
  ), ranked AS (
    SELECT id, row_number() OVER (PARTITION BY rk, panel, action, newsig ORDER BY fixed_at ASC, id ASC) AS rn
    FROM norm
  )
  DELETE FROM error_signatures e USING ranked r WHERE e.id = r.id AND r.rn > 1;
  GET DIAGNOSTICS v_dupes = ROW_COUNT;

  -- 2 · normalise what is left
  UPDATE error_signatures
     SET sig = regexp_replace(sig, c_prefix, '', 'i')
   WHERE sig <> regexp_replace(sig, c_prefix, '', 'i');
  GET DIAGNOSTICS v_upd = ROW_COUNT;
  RAISE NOTICE '344: normalised % signature(s), removed % duplicate record(s)', v_upd, v_dupes;
END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- D · Both rewrites go on the ledger, so a re-seed skips them
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- B is idempotent in practice (a second run finds nothing) but it is still a data rewrite, and C
-- is NOT safely repeatable: run twice against rows written after this migration it would delete
-- records that are legitimately distinct. Migration 307's reasoning, applied here.
INSERT INTO public.lfh_applied_once (key, note) VALUES
  ('344_backfill_error_restaurant_from_address',
   'names the restaurant on old error rows from the /r/<slug> in their own text. One-time; a re-run is harmless but pointless.'),
  ('344_normalise_error_signatures',
   'strips the browser prefix from stored error signatures and drops the duplicates that collapse. A re-run could delete genuinely distinct later records.')
ON CONFLICT (key) DO NOTHING;
