-- 099_auto_close_idle_sessions.sql
-- ============================================================================
-- ⚠️ HALF OF THIS FILE IS HISTORY — read this before believing the rest.
--   (corrected 2026-08-05, T8 database sweep)
--
--   • `lfh_touch_session` (part 1) is LIVE and still does exactly what it says.
--   • `lfh_auto_close_idle_sessions` (part 2) and its 5-minute pg_cron job
--     (part 3) are BOTH GONE. The owner's later rule — NO TABLE ENDS ITSELF —
--     retired them: migration 254 established it and 267 dropped the function
--     and unscheduled the job. `scripts/verify-db-grants.mjs` now lists that
--     job name as FORBIDDEN, so re-adding it fails the checks on purpose.
--
--   So an idle open table staying open is the INTENDED behaviour now, not a
--   leak. Only a person closes a table. Everything below part 1 describes a
--   safety net that no longer exists — kept for the reasoning, not as truth.
-- ============================================================================
-- AUTO-CLOSE ABANDONED TABLE SESSIONS (presence-aware safety net)
-- ============================================================================
-- Today a table session stays status='open' forever once opened (a waiter-call
-- table-add, a guest joining, or a staff order opens it). If nobody ever closes
-- it and the guests just walk away, the floor fills with phantom "open" tables
-- (a stress test left 1,481 sessions stuck open). This migration adds:
--
--   1) lfh_touch_session(p_token)        — guest presence heartbeat (anon).
--      The visible guest menu calls this ~every 60s while the tab is in the
--      foreground, bumping sessions.last_activity_at so "someone is actively
--      viewing this table" KEEPS it open. It ONLY bumps a session that is
--      already status='open' — it never CREATES one, so merely viewing the
--      menu can't open a table.
--
--   2) lfh_auto_close_idle_sessions(p_idle_minutes int DEFAULT 15) — the
--      service-role safety net. Closes every open session that has been idle
--      past the window AND has NO active operation (no unserved order, no
--      unpaid bill). An unpaid bill ALWAYS keeps the table open — we never
--      close a table that still owes money. Setting status='closed' fires the
--      existing rt_emit_sessions trigger (UPDATE OF status → 'ops' + 'table:<n>'
--      breadcrumb), so every panel's floor clears in realtime.
--
--   3) pg_cron schedule every 5 minutes (fail-soft: if pg_cron isn't available
--      on this project the function still lands, and a NOTICE tells you to hit
--      it from a Vercel cron / external scheduler instead).
--
-- This migration is ADDITIVE and does NOT touch the manual table add /
-- change-table / cancel flow — that stays exactly as-is per the owner.
-- ============================================================================

-- ── 1) GUEST PRESENCE HEARTBEAT ─────────────────────────────────────────────
-- Dedicated, tiny RPC the visible guest menu pings ~every 60s. It is SEPARATE
-- from lfh_session_state on purpose: the status widget's backup poll runs even
-- when the tab is HIDDEN, so we must NOT bump liveness from inside that poll
-- (that would keep a backgrounded tab's table alive forever — the exact bug).
-- The client gates this call on document visibility; the server additionally
-- guards "open only" so this can never create or reopen a table.
CREATE OR REPLACE FUNCTION lfh_touch_session(p_token text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  -- Bump liveness ONLY for the open session this token belongs to.
  -- A removed member, a closed/pending session, or a dead token → no-op.
  UPDATE sessions s
     SET last_activity_at = NOW()
    FROM session_members m
   WHERE m.token = p_token
     AND NOT m.removed
     AND m.session_id = s.id
     AND s.status = 'open';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- last_activity_at is NOT in rt_emit_sessions' watch-list (migration 059), so
  -- this heartbeat fires NO realtime breadcrumb — a busy table can't spam staff.
  RETURN json_build_object('ok', v_n > 0);
END $$;

-- ── PERMISSIONS for the heartbeat (migration-038 pattern) ───────────────────────────────────
-- New functions are PUBLIC-executable by default — lock it, then grant the one role that needs it.
-- The heartbeat is guest-facing but can only TOUCH an already-open session: it never reads data and
-- never opens or reopens a table. (These two lines used to live further down this file, below the
-- auto-close code; they were kept here when that code was removed in 2026-08-13 — without them,
-- running this file alone would leave the heartbeat public-executable.)
REVOKE EXECUTE ON FUNCTION lfh_touch_session(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lfh_touch_session(text) TO anon;

-- ── 2) AUTO-CLOSE SAFETY NET ────────────────────────────────────────────────
-- Close every OPEN session idle past p_idle_minutes that has NO blocking order.
--
-- CLOSE-RULE PREDICATE (the load-bearing part) — a table is closed only when:
--   • status = 'open', AND
--   • last_activity_at < now() - p_idle_minutes, AND
--   • NO order on this session is "blocking", where an order BLOCKS close iff:
--       it is NOT cancelled AND NOT archived AND
--       ( it is not yet served  (status IN 'received','preparing')      -- live order
--         OR it is served but UNPAID (payment_status <> 'paid') ).       -- unpaid bill
--
-- So a served+paid order does NOT block (the meal's done & settled → safe to
-- close); a cancelled/archived order does NOT block; but ANY live order OR any
-- unpaid bill keeps the table open regardless of how idle it looks. The order
-- linkage is by session_id (the canonical join the floor brain uses in
-- sessions-on mode — set by lfh_place_order (015) and the staff path (049)).
--
-- p_idle_minutes is a PARAMETER (default 15) so the window is trivial to change
-- and so verification can force an immediate close with (0). 15 (not 10) because
-- a guest between courses may background the tab briefly — but rule above means
-- a live order / unpaid bill is protected no matter the window.
  -- Each status→'closed' fires rt_emit_sessions (UPDATE OF status), so the
  -- manager/owner/admin floor + the guest's status widget clear in realtime.
-- ── PERMISSIONS (migration-038 pattern) ─────────────────────────────────────
-- New functions are PUBLIC-executable by default — lock them down.
-- Heartbeat: anon may call it (it's guest-facing) but it can only TOUCH an
-- already-open session, never read data or open one.
-- Auto-close: service-role ONLY (it bypasses the per-table token, so no guest /
-- authenticated client may ever fire a mass-close).
-- ── 3) SCHEDULE EVERY 5 MINUTES (fail-soft) ─────────────────────────────────
-- Try pg_cron first. If the extension isn't available on this project the whole
-- DO block is caught and we NOTICE the fallback — the safety-net function above
-- still lands, so a Vercel cron / external scheduler can POST to it instead.
  -- Unschedule any prior copy so re-running this migration doesn't error on a
  -- duplicate job name.

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- THE CODE THAT USED TO BE HERE IS GONE, ON PURPOSE (2026-08-13, T8 sweep problem P2).
--
-- Everything above this line from "2) AUTO-CLOSE SAFETY NET" down is KEPT AS REASONING ONLY. The
-- function `lfh_auto_close_idle_sessions(int)` and the pg_cron job that ran it every 5 minutes were
-- dropped by migration 267 under the owner's rule from migration 254: **NO TABLE ENDS ITSELF.**
-- `scripts/verify-db-grants.mjs` lists that job name as FORBIDDEN, so re-adding it fails the checks
-- on purpose.
--
-- But this file still CREATED the function and still called `cron.schedule` for it. A FULL re-seed
-- healed that (267 sorts after this file and drops it again) — the hole was the PARTIAL run, which
-- is what CLAUDE.md actively recommends: "Prefer running just the one migration." Running this file
-- alone brought a table-closing job back to life, and the guard would only report it afterwards.
--
-- So the body is replaced by the removal itself: run this file alone now and it ENFORCES the rule
-- instead of breaking it. Idempotent, and safe on a database where neither exists.
DROP FUNCTION IF EXISTS public.lfh_auto_close_idle_sessions(int);
DO $$
BEGIN
  PERFORM cron.unschedule('lfh_auto_close_idle_sessions')
   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lfh_auto_close_idle_sessions');
EXCEPTION WHEN OTHERS THEN
  NULL; -- pg_cron absent, or the job never existed: nothing to unschedule either way
END $$;

NOTIFY pgrst, 'reload schema';
