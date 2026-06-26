-- 099_auto_close_idle_sessions.sql
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
CREATE OR REPLACE FUNCTION lfh_auto_close_idle_sessions(p_idle_minutes int DEFAULT 15)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_closed int;
BEGIN
  UPDATE sessions s
     SET status = 'closed', closed_at = NOW()
   WHERE s.status = 'open'
     AND s.last_activity_at < NOW() - make_interval(mins => GREATEST(p_idle_minutes, 0))
     AND NOT EXISTS (
       SELECT 1 FROM orders o
        WHERE o.session_id = s.id
          AND o.status <> 'cancelled'
          AND NOT o.archived
          AND ( o.status IN ('received', 'preparing')   -- not yet served (live order)
             OR o.payment_status <> 'paid' )            -- served but unpaid (open bill)
     );
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  -- Each status→'closed' fires rt_emit_sessions (UPDATE OF status), so the
  -- manager/owner/admin floor + the guest's status widget clear in realtime.
  RETURN json_build_object('ok', true, 'closed', v_closed);
END $$;

-- ── PERMISSIONS (migration-038 pattern) ─────────────────────────────────────
-- New functions are PUBLIC-executable by default — lock them down.
-- Heartbeat: anon may call it (it's guest-facing) but it can only TOUCH an
-- already-open session, never read data or open one.
REVOKE EXECUTE ON FUNCTION lfh_touch_session(text)            FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lfh_touch_session(text)            TO anon;
-- Auto-close: service-role ONLY (it bypasses the per-table token, so no guest /
-- authenticated client may ever fire a mass-close).
REVOKE EXECUTE ON FUNCTION lfh_auto_close_idle_sessions(int)  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_auto_close_idle_sessions(int)  TO service_role;

-- ── 3) SCHEDULE EVERY 5 MINUTES (fail-soft) ─────────────────────────────────
-- Try pg_cron first. If the extension isn't available on this project the whole
-- DO block is caught and we NOTICE the fallback — the safety-net function above
-- still lands, so a Vercel cron / external scheduler can POST to it instead.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  -- Unschedule any prior copy so re-running this migration doesn't error on a
  -- duplicate job name.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lfh_auto_close_idle_sessions') THEN
    PERFORM cron.unschedule('lfh_auto_close_idle_sessions');
  END IF;
  PERFORM cron.schedule(
    'lfh_auto_close_idle_sessions',
    '*/5 * * * *',                                   -- every 5 minutes
    $cron$ SELECT lfh_auto_close_idle_sessions(); $cron$  -- uses the 15-min default
  );
  RAISE NOTICE 'pg_cron: scheduled lfh_auto_close_idle_sessions every 5 minutes.';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron unavailable (%); lfh_auto_close_idle_sessions() landed but is NOT scheduled. Hit it every 5 min from a Vercel cron / external scheduler (service-role).', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
