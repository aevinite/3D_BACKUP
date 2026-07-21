-- 162 — auto-delete the Claude session history after a MONTH (owner 2026-07-21: "let's keep it
-- for a month"). Extends lfh_prune_logs (nightly pg_cron) with two platform-wide sweeps:
--   • agent_runs older than 30 days (the admin Repair "Claude session history")
--   • fix_requests already handled (fixed/dismissed) older than 30 days — OPEN ones are never
--     deleted; an unhandled request must stay visible no matter how old.
--
-- ⚠ Body is based on the HIGHEST-numbered version of lfh_prune_logs (158) — per the
--   migration-recreate rule, never a stale copy. Only the two deletes after the loop are new.
-- If the owner later wants a longer history (they floated 3/6/12 months), bump the TWO
-- `interval '30 days'` literals below — nothing else.

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
  v_site_op   INTEGER;
  v_site_cust INTEGER;
BEGIN
  -- Platform defaults from the admin Settings (id='site'). NULL → the 30-day cap applies.
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
    -- Per restaurant: OWN window → platform default (id='site') → 30. HARD-CAPPED at 30 days
    -- (the "1 month max"): nothing is kept beyond a month regardless of the stored value.
    v_op   := GREATEST(1, LEAST(COALESCE(r.op_days,   v_site_op,   30), 30));
    v_cust := GREATEST(1, LEAST(COALESCE(r.cust_days, v_site_cust, 30), 30));

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

  -- Platform-wide (not per restaurant): the Claude session history + settled fix requests.
  DELETE FROM agent_runs
   WHERE started_at < now() - interval '30 days';

  DELETE FROM fix_requests
   WHERE status <> 'open'
     AND created_at < now() - interval '30 days';
END;
$$;

REVOKE ALL ON FUNCTION lfh_prune_logs() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_prune_logs() TO service_role;

NOTIFY pgrst, 'reload schema';
