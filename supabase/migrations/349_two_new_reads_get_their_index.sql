-- 349_two_new_reads_get_their_index.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- TWO READS SHIPPED IN THE SAME BRANCH AS THIS FILE, AND NEITHER HAD AN INDEX THAT FIT.
-- CLAUDE.md, the standing rule: "index every filtered column". Written as its own migration so the
-- reason each index exists is next to the index, not buried in a feature file.
--
-- ⚠ MIGRATION NUMBER: 346 and 347 were skipped — see the note at the top of 348. Both statements
--   here are IF NOT EXISTS, so this file is correct at any number and safe to re-run.
--
-- ── A. "was the food made?" on a closed-unpaid bill ─────────────────────────────────────────
-- WHERE THE OWNER SEES IT: admin console → Bills → the CLOSED UNPAID tile, which now splits its
-- value into "food was made" and "never made" (owner, 2026-08-20).
--
-- The answer lives on the `order_cancelled` row's meta (mig 340 merges it there so a list does not
-- need a sub-query per line), and the admin Bills ledger is CROSS-RESTAURANT, so it can only ask
-- "the answers for these session ids". Every existing index on deletion_audit leads with
-- `restaurant_id`:
--     deletion_audit_by_restaurant   (restaurant_id, at DESC)
--     deletion_audit_rid_kind_at_idx (restaurant_id, kind, at DESC)
--     deletion_audit_kind_ix         (restaurant_id, kind, at DESC)
--     deletion_audit_by_bill/_by_kot/_by_actor  (restaurant_id, …)
-- …so a filter that names no restaurant could only be answered by reading the table. This is the
-- same shape as mig 305 ("every existing index leads with a DIFFERENT column"), and the same fix.
--
-- PARTIAL on purpose: a `deletion_audit` row for a deleted menu item or a reduced quantity has no
-- session, and those rows have no business making this index bigger. `order_id` is INCLUDEd so the
-- lookup is index-only — the query wants nothing else from the row but the id and the meta.
CREATE INDEX IF NOT EXISTS idx_deletion_audit_session_kind
  ON public.deletion_audit (session_id, kind) INCLUDE (order_id)
  WHERE session_id IS NOT NULL;

-- ── B. the bill Change log, page by page ────────────────────────────────────────────────────
-- WHERE THE OWNER SEES IT: admin console → Bills → Change log → the numbered pages at the foot of
-- the list (owner, 2026-08-20: "I want all logs to be shown … till the time it is auto deleted").
--
-- That screen reads `staff_actions` filtered by a list of ~17 bill actions, newest first, and now
-- also asks for an exact total so it can print a last page number. `staff_actions_created_idx
-- (created_at DESC)` orders it but cannot narrow it, so both the count and every page walked rows
-- of every OTHER action to find the bill ones. Leading with `action` makes both an index-only
-- range scan per action, already in the right order within each.
--
-- BOUNDED BY RETENTION, WHICH IS WHY AN EXACT COUNT IS AFFORDABLE HERE AT ALL: mig 158 hard-caps
-- every restaurant's log at 30 days and prunes daily at 04:00, so this index and the count behind
-- it can never grow without limit. Measured on the dev database when this was written: 2,242
-- bill-change rows across 30 days.
CREATE INDEX IF NOT EXISTS idx_staff_actions_action_created
  ON public.staff_actions (action, created_at DESC);
