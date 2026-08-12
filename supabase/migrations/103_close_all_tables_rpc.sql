-- 103_close_all_tables_rpc.sql
-- ⚠️ RETIRED — the function this file creates NO LONGER EXISTS.
--   (noted 2026-08-05, T8 database sweep)
--   Migration 281 (`281_close_all_removed_and_three_of_four.sql`) DROPPED both bulk table RPCs —
--   `lfh_staff_open_all_tables` and `lfh_staff_close_all_tables` — under the owner's "no table
--   ends itself" rule, and the panels + routes were updated to match (see the note at
--   public/panels/editor/app.js: "/sessions/close-all and /sessions/open-all are now GONE from
--   the server too"). Nothing below is live. Kept for the reasoning, not as truth.
-- INSTANT "Close all" (owner 2026-06-27) — the mirror of mig 102's open-all. The manager's
-- "Close all" fired one POST /sessions/:id/close PER open session (N round-trips to Sydney) and
-- the tiles only freed AFTER all finished. This RPC closes every CLOSEABLE open session in ONE
-- call, replicating lib/sessionClose.ts EXACTLY:
--   • BLOCK guard (closeBlock): a session is NOT closed (unless p_force) if any of its orders is
--     non-archived, non-cancelled AND (still cooking = received/preparing) OR (unpaid = payment_status<>'paid').
--   • for each session that DOES close: status→closed (+closed_at); cancel+archive its active unpaid
--     received/preparing orders; archive the rest; release every member (removed=true). Same as closeSession.
--   • waiter_calls are deliberately NOT touched (matches closeSession — the summary's stale-call guard
--     relies on a closed session's unresolved call being ignored, not resolved).
-- Returns { closed, skipped, closed_tables } — closed_tables drives the client's 8s UNDO (reopen).
-- service-role only (the editor endpoint calls it via supabaseAdmin).

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- THE CODE THAT USED TO BE HERE IS GONE, ON PURPOSE (2026-08-13, T8 sweep problem P2).
--
-- Everything above is KEPT AS REASONING ONLY. `lfh_staff_close_all_tables` — which closed every table on the floor in one call and, with force, CANCELLED cooking food and unpaid bills — was dropped by
-- migration 281 under the owner's "no table ends itself" rule, and the panels and routes were
-- updated to match (/sessions/open-all and /sessions/close-all are gone from the server too).
--
-- This file nevertheless still CREATED it. A full re-seed healed that, because 281 sorts after and
-- drops it again; running THIS FILE ALONE — which CLAUDE.md recommends — brought it back. So the
-- body is now the removal itself. Idempotent; safe where it never existed.
DROP FUNCTION IF EXISTS public.lfh_staff_close_all_tables(uuid, boolean);

NOTIFY pgrst, 'reload schema';
