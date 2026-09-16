-- 391 — a table that RECEIVES an order gets a bill number, not just one that is handed a new one
-- (owner picked item 4 of sweep #9 terminal 30's round-2 report, 2026-09-16)
--
-- THE RULE, from docs/NUMBERING.md: a bill number is handed out when a table's FIRST ORDER lands
-- (migration 040) — not when the table is opened, which used to burn a number on every tap.
-- `trg_assign_bill_on_order` enforces that, and it is AFTER **INSERT** only. So a session that comes
-- to hold an order some other way never gets one.
--
-- ═══ WHAT I FOUND WHEN I LOOKED, WHICH IS NARROWER AND BETTER THAN THE ITEM ASSUMED ═══
--
-- The report said this would have to fire on every order update and called it high-risk. It does
-- not, because only FOUR database functions ever re-link an order, and no application code does —
-- checked across app/ and lib/. Each was read:
--
--   lfh_staff_move_order    ALREADY DOES THIS BY HAND: "IF v_target.bill_no IS NULL THEN UPDATE
--                           sessions SET bill_no = lfh_next_counter(p_rid,'bill') … AND bill_no IS
--                           NULL". Moving an order to a numberless table already works.
--   lfh_staff_merge_tables  deliberately sets bill_no = COALESCE(v_keep.bill_no, v_drop.bill_no) —
--                           the merged party keeps ONE number, which is the owner's standing rule.
--   lfh_staff_shift_table   changes only table_number, never session_id, so nothing to do.
--   lfh_staff_unmerge_table ← **THE ACTUAL GAP.** It creates a fresh session for the child table,
--                           moves that table's live orders onto it, and never touches bill_no. An
--                           unmerged table therefore holds live orders with NO bill number.
--
-- Plus the case that first exposed this: an order INSERTed with no session and linked a moment
-- later. One such row on the dev stack (2026-08-06) — its order was created 1.4 seconds before its
-- session, so the AFTER-INSERT trigger fired while session_id was still null and the body skipped.
--
-- ═══ SO THIS IS ONE TRIGGER, AND NO FUNCTION BODY CHANGES AT ALL ═══
--
-- The same function, on the same rule, extended to the one event it was missing. Narrow on purpose:
--
--   · `UPDATE OF session_id` — not every update. A price edit, a status change or a payment does
--     not fire it.
--   · `WHEN (NEW.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM OLD.session_id)` — it
--     fires only when an order genuinely CHANGES the party it belongs to, and never when a session
--     link is cleared (the close/delete cleanups set it to NULL; they must not fire).
--   · The function already only assigns when the target has NO number
--     (`SELECT bill_no … FOR UPDATE; IF v_has IS NULL THEN …`), so it is idempotent and cannot give
--     a merged party a second number — merge_tables has already set one by then, and move_order has
--     already set one by hand. On both paths this trigger finds a number and does nothing.
--
-- WHAT CHANGES, PATH BY PATH: unmerge now numbers the child table (the fix); an order linked to a
-- session after creation now gets a number (the fix); merge, move and shift are unaffected, and
-- were each checked rather than assumed.
--
-- COST: none on the paths that already number a table (one indexed SELECT that finds a value and
-- returns). It cannot fire on an ordinary order write, because an ordinary order write does not
-- change session_id.
--
-- Guarded by `npm run verify:bill-number-on-order`.

DROP TRIGGER IF EXISTS trg_assign_bill_on_relink ON public.orders;

CREATE TRIGGER trg_assign_bill_on_relink
AFTER UPDATE OF session_id ON public.orders
FOR EACH ROW
WHEN (NEW.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM OLD.session_id)
EXECUTE FUNCTION lfh_assign_bill_on_order();

NOTIFY pgrst, 'reload schema';
