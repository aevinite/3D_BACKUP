-- 157 — lfh_prune_logs: honour a PLATFORM-WIDE retention DEFAULT (id='site').
--
-- ⚠ MIGRATION NUMBER: next free after 156. Renumber to the next free slot if a parallel branch
--   took it — this is a plain CREATE OR REPLACE + re-GRANT, correct at ANY number.
--
-- WHY: retention is per-restaurant (mig 152 reads each restaurant's OWN oplog/custlog_retention_days,
-- falling back to a hard-coded 90). The admin Settings "platform-wide" control wrote the id='site'
-- row, but prune never consulted it — so it only ever changed restaurant #1 (audit 2026-07-09,
-- resolved cosmetically in #279). This wires it for real: the id='site' value becomes the PLATFORM
-- DEFAULT — a restaurant that set its OWN window still wins; one that hasn't now inherits the
-- platform default, then the 90-day backstop.
--
-- SAFETY (verified on prod before applying): every restaurant currently has its OWN non-null
-- retention value (no null rows, no missing settings rows), so this fallback is INERT today — it
-- changes NO restaurant's pruning. It only takes effect for a future restaurant left unset.
--
-- Based on migration 152 (the current definition) — ONLY the COALESCE fallbacks change (add the
-- id='site' platform default between the per-restaurant value and the 90 backstop). Same tables,
-- same "LOGS ARE NOT BILLS" guarantee, same 1..90 clamp, same SECURITY DEFINER + grants. The daily
-- 04:00 pg_cron job keeps calling it unchanged.

CREATE OR REPLACE FUNCTION lfh_prune_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r           RECORD;
  v_op        INTEGER;
  v_cust      INTEGER;
  v_site_op   INTEGER;   -- platform-default operation-log retention (id='site'), NULL when unset
  v_site_cust INTEGER;   -- platform-default customer-log retention  (id='site'), NULL when unset
BEGIN
  -- Platform defaults from the admin Settings row (id='site'). NULL → the 90-day backstop applies.
  SELECT oplog_retention_days, custlog_retention_days
    INTO v_site_op, v_site_cust
    FROM settings WHERE id = 'site' LIMIT 1;

  FOR r IN
    SELECT rest.id                  AS rid,
           s.oplog_retention_days   AS op_days,
           s.custlog_retention_days AS cust_days
      FROM restaurants rest
      LEFT JOIN settings s ON s.restaurant_id = rest.id
  LOOP
    -- Per restaurant: its OWN window wins; else the PLATFORM DEFAULT (id='site'); else 90.
    -- Same 1..90-day clamp as migration 053/152, applied to whichever value we land on.
    v_op   := GREATEST(1, LEAST(COALESCE(r.op_days,   v_site_op,   90), 90));
    v_cust := GREATEST(1, LEAST(COALESCE(r.cust_days, v_site_cust, 90), 90));

    DELETE FROM staff_actions
     WHERE restaurant_id = r.rid
       AND created_at < now() - make_interval(days => v_op);

    DELETE FROM feedback
     WHERE restaurant_id = r.rid
       AND created_at < now() - make_interval(days => v_cust);

    DELETE FROM waiter_calls
     WHERE restaurant_id = r.rid
       AND created_at < now() - make_interval(days => v_cust);

    DELETE FROM session_members sm
     WHERE sm.restaurant_id = r.rid
       AND sm.joined_at < now() - make_interval(days => v_cust)
       AND NOT EXISTS (
         SELECT 1 FROM sessions s
          WHERE s.id = sm.session_id AND s.status <> 'closed'
       );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION lfh_prune_logs() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_prune_logs() TO service_role;

NOTIFY pgrst, 'reload schema';
