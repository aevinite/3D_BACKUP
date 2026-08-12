-- 102_open_all_tables_rpc.sql
-- ⚠️ RETIRED — the function this file creates NO LONGER EXISTS.
--   (noted 2026-08-05, T8 database sweep)
--   Migration 281 (`281_close_all_removed_and_three_of_four.sql`) DROPPED both bulk table RPCs —
--   `lfh_staff_open_all_tables` and `lfh_staff_close_all_tables` — under the owner's "no table
--   ends itself" rule, and the panels + routes were updated to match (see the note at
--   public/panels/editor/app.js: "/sessions/close-all and /sessions/open-all are now GONE from
--   the server too"). Nothing below is live. Kept for the reasoning, not as truth.
-- INSTANT "Open all" (owner 2026-06-27): the manager's "Open all" fired ONE POST /sessions/open
-- PER table (300 tables → 300 round-trips to the Sydney DB, browser-capped at ~6 concurrent →
-- many seconds, and the tiles only flipped to "open" AFTER all finished). This RPC opens every
-- not-yet-open table in ONE server-side call (one round-trip, one transaction) — mirrors the
-- single-open endpoint's logic exactly:
--   • a table is "open" if it has a non-'closed' session;
--   • for each table 1..table_count WITHOUT one → INSERT a session (status open, opened_by waiter,
--     opened_at + last_activity_at now). NOTE (corrected 2026-08-05): this line used to say the
--     `trg_assign_bill` INSERT trigger still assigns bill_no — it does not, and had not for 62
--     migrations. Migration 040 DROPPED that trigger on purpose, so a table tap no longer burns a
--     bill number; `trg_assign_bill_on_order` gives the session its number when its FIRST order
--     lands. The behaviour here is right; only the comment was wrong. Left in place because the
--     next person to touch this path would otherwise go hunting a trigger that does not exist;
--   • approve any PENDING open/join requests across the floor (those tables are now open);
--   • return how many were opened.
-- The client pairs this with optimistic tiles (flip to "Open" instantly), so it FEELS instant too.
-- service-role only (the editor endpoint calls it via supabaseAdmin).

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- THE CODE THAT USED TO BE HERE IS GONE, ON PURPOSE (2026-08-13, T8 sweep problem P2).
--
-- Everything above is KEPT AS REASONING ONLY. `lfh_staff_open_all_tables` — which opened every table on the floor in one call — was dropped by
-- migration 281 under the owner's "no table ends itself" rule, and the panels and routes were
-- updated to match (/sessions/open-all and /sessions/close-all are gone from the server too).
--
-- This file nevertheless still CREATED it. A full re-seed healed that, because 281 sorts after and
-- drops it again; running THIS FILE ALONE — which CLAUDE.md recommends — brought it back. So the
-- body is now the removal itself. Idempotent; safe where it never existed.
DROP FUNCTION IF EXISTS public.lfh_staff_open_all_tables(uuid);

NOTIFY pgrst, 'reload schema';
