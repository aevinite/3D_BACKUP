-- ⚠ RENUMBERED 369 → 374 (2026-09-01, while merging every open PR).
--   FOUR files were sitting at 369, each written by a different lane on 2026-08-28 and each in its
--   own unmerged branch, so nothing noticed until they landed on main together. `npm run
--   verify:grants` refuses a NEW duplicate number, and it is right to: with several files at one
--   number a re-seed applies them in FILENAME order, which is not an order anybody chose.
--   The one that KEEPS 369 is the earliest by commit time (00:01 — a_purge_clears_the_pending_
--   printer_handshakes); this one was committed at 00:28, so it moved.
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
-- 369 · A table's mark must not outlive its party when the party's row is DELETED
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHERE THIS BITES: Manager panel → Tables floor. A table can be marked 👑 VIP / 🏠 Family /
-- 🤝 Owner's guest (migration 166). Migration 166 also added `clear_table_tag_on_close`, so the
-- mark is dropped when the party CLOSES — and it works: `verify:lifecycle` scenario 1 and ledger
-- row P10813 both prove it. What nobody ever drove is the other way a party can end.
--
-- THE FAULT (T22, sweep #7, 2026-08-28). `sessions` has two cleanup triggers and they are meant to
-- be mirrors of each other:
--
--   trg_session_close   BEFORE UPDATE  → lfh_session_close_cleanup()
--   trg_session_delete  BEFORE DELETE  → lfh_session_delete_cleanup()
--
-- The delete side clears session_members, waiter_calls, requests, the party's orders and — since
-- migration 249's mirror — table_merges. It does NOT clear table_tags. And the mark's own trigger
-- cannot help, because migration 166 declared it `AFTER UPDATE OF status ON sessions`: a DELETE
-- never fires it. So when a party's session row is removed rather than closed, the table keeps its
-- mark for ever.
--
-- WHAT THE OWNER WOULD SEE, and why it is not cosmetic. On the dev database this migration was
-- written against, `table_tags` held exactly two rows and BOTH were orphans — Pizza Palace table 12
-- marked 👑 VIP and Demo Bistro table 2 marked 🤝 Owner's guest, both dated 2026-07-23, both on
-- tables with no session row at all. On the floor that is a VIP badge sitting on a table the tile
-- calls Free. Worse, the mark travels onto the KITCHEN TICKET (ledger row P10811), so the NEXT
-- party to sit at that table gets someone else's VIP printed on their food — and an 🏠/🤝 mark is
-- what the on-the-house settle looks for, so a stale one offers a free-of-charge bill on a party
-- that was never promised it. That is party state leaking to the next party, which is the one thing
-- "a table shows only its own party" exists to stop.
--
-- WHY THE CLOSE PATH IS NOT ENOUGH ON ITS OWN. It is not that closing is the only real route. A
-- session row is genuinely deleted in the product — that is what migration 146 wrote
-- lfh_session_delete_cleanup FOR, and migration 249 extended it for exactly this "the close side
-- does X, the delete side must too" reason. Migration 166 simply predates the habit of writing both.
--
-- WHAT THIS MIGRATION CHANGES: one block added to lfh_session_delete_cleanup, and a one-time repair
-- of the marks already orphaned. Nothing else about the function moves.
--
-- BUILT FROM THE LIVE BODY, NOT FROM MIGRATION 146. Five migrations have edited this function
-- (146, 232, 249, 302, …) and recreating it from an older file is precisely how migration 342
-- silently dropped twenty-two of migration 321's deletes — the accident migration 345 had to undo.
-- The body below was read out of the database with pg_get_functiondef immediately before this file
-- was written, so every earlier fix is carried forward verbatim.
--
-- THE GUARD: scripts/verify-merge-keeps-mark.mjs — the file that already owns the mark's whole
-- lifecycle — now asserts that the delete path clears the mark, beside its existing assertion that
-- the close path still does.

CREATE OR REPLACE FUNCTION public.lfh_session_delete_cleanup()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE session_members SET removed = true WHERE session_id = OLD.id AND NOT removed;
  UPDATE waiter_calls SET resolved = true WHERE session_id = OLD.id AND NOT resolved;
  UPDATE requests     SET status = 'denied' WHERE table_number = OLD.table_number AND restaurant_id = OLD.restaurant_id AND status = 'pending';
  UPDATE orders
     SET status = 'cancelled', archived = true,
         archived_at = COALESCE(archived_at, NOW()),
         cancelled_at = COALESCE(cancelled_at, NOW())
   WHERE session_id = OLD.id AND NOT archived AND deleted_at IS NULL
     AND status <> 'cancelled' AND payment_status <> 'paid' AND khata_at IS NULL;
  UPDATE orders
     SET archived = true, archived_at = COALESCE(archived_at, NOW())
   WHERE session_id = OLD.id AND NOT archived AND deleted_at IS NULL;
  -- Mirror of mig 249 on the close side: the tables this party had joined are separated
  -- again, and the record says why.
  UPDATE table_merges SET ended_at = NOW(), ended_reason = 'session_deleted'
   WHERE session_id = OLD.id AND ended_at IS NULL;

  -- ── THE MARK, added by migration 369 ────────────────────────────────────────────────────────
  -- Mirror of mig 166's clear_table_tag_on_close, which a DELETE cannot fire (it is declared
  -- AFTER UPDATE OF status). Same shape and the same guard as the close side, deliberately: the
  -- mark only goes if NO OTHER party is still open on that table, so a merged sibling or a second
  -- seating does not lose a mark that is still theirs. `OLD.id` is excluded because this row is on
  -- its way out. A NULL table_number (a takeaway/parcel session) owns no table and no mark.
  IF OLD.table_number IS NOT NULL THEN
    DELETE FROM table_tags t
      WHERE t.restaurant_id = COALESCE(OLD.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid)
        AND t.table_number  = OLD.table_number
        AND NOT EXISTS (SELECT 1 FROM sessions s
                         WHERE s.restaurant_id = t.restaurant_id
                           AND s.table_number  = t.table_number
                           AND s.status = 'open' AND s.id <> OLD.id);
  END IF;

  RETURN OLD;
END; $function$;

-- ── the marks that are ALREADY orphaned ─────────────────────────────────────────────────────────
-- A one-time repair, not a recurring job: from here the trigger above keeps the table clean. It is
-- wrapped because a re-seed re-runs every migration with no ledger (CLAUDE.md), and this statement
-- rewrites tenant data — re-running it is harmless in principle, but the guard is the house rule
-- for a data-rewriting migration and it also stops a re-seed clearing a mark set since.
--
-- SCOPED TO PROVABLE ORPHANS ONLY: a mark whose table has no session that is anything other than
-- closed. A live party, a party waiting to be seated, a merged child — none of those match.
DO $reseed_guard$
DECLARE v_applied boolean := false; v_n integer := 0;
BEGIN
IF to_regprocedure('public.lfh_already_applied(text)') IS NOT NULL THEN
  EXECUTE $probe$ SELECT lfh_already_applied('369_orphan_table_tags_cleared') $probe$ INTO v_applied;
END IF;
IF v_applied THEN
  RAISE NOTICE '369: orphan-mark repair already applied — skipped';
  RETURN;
END IF;

DELETE FROM table_tags t
 WHERE NOT EXISTS (SELECT 1 FROM sessions s
                    WHERE s.restaurant_id = t.restaurant_id
                      AND s.table_number  = t.table_number
                      AND s.status <> 'closed');
GET DIAGNOSTICS v_n = ROW_COUNT;
RAISE NOTICE '369: cleared % mark(s) that had outlived their party', v_n;

IF to_regclass('public.lfh_applied_once') IS NOT NULL THEN
  INSERT INTO lfh_applied_once(key, note)
  VALUES ('369_orphan_table_tags_cleared',
          'Cleared the marks that had outlived their party, once. The trigger above keeps the table clean from here, so a re-run would only risk removing a mark set since.')
  ON CONFLICT (key) DO NOTHING;
END IF;
END $reseed_guard$;

NOTIFY pgrst, 'reload schema';

-- ── AND THE GRANTS, SPELLED OUT (added 2026-09-01, with the 369 → 374 renumber) ────────────────
-- A new Postgres function is PUBLIC-executable by default (the migration 038/267 lesson), and
-- `verify:ui-integrity` checks every new migration for this pair. It had never looked at this file,
-- because the file used to be numbered below its high-water mark — the renumber is what surfaced it.
--
-- Nothing here CHANGES: `lfh_session_delete_cleanup()` is a TRIGGER function, so Postgres invokes it
-- when the trigger fires and never checks EXECUTE against the caller, and CREATE OR REPLACE keeps
-- whatever privileges the function already had. The pair is written down anyway, because the rule is
-- "every staff-only function carries it" and a file that relies on an earlier file's grants is a file
-- someone will copy without them.
REVOKE ALL ON FUNCTION public.lfh_session_delete_cleanup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_session_delete_cleanup() TO service_role;
