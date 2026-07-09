-- 158 — enforce the platform "1 MONTH MAX" log retention (owner 2026-07-09).
--
-- ⚠ MIGRATION NUMBER: next free after 157. Renumber to the next free slot if a parallel branch
--   took it — plain ALTER DEFAULT + CREATE OR REPLACE, correct at ANY number.
--
-- The admin Settings control is now "one setting for every restaurant, 1 day … 1 month max"
-- (toggleable to 1/3/7/14/30 days). Two enforcement points so the max holds no matter how a
-- value is set:
--   (1) The settings retention columns DEFAULTED to 90 → a newly-created restaurant would start
--       at 3 months, above the cap. Lower the DEFAULT to 30 so new restaurants inherit the max.
--   (2) lfh_prune_logs hard-caps every restaurant's window at 30 days (was 90) — the ultimate
--       "max lock": even if a value >30 is somehow stored, nothing is kept beyond a month.
--
-- Existing rows are already 30 (set by the admin control / one-time backfill). Based on migration
-- 157 (the current lfh_prune_logs) — only the two clamp ceilings change 90 → 30. Same tables, same
-- "LOGS ARE NOT BILLS" guarantee, same platform-default fallback, same grants. Daily 04:00 pg_cron
-- job keeps calling it unchanged.

ALTER TABLE settings ALTER COLUMN oplog_retention_days SET DEFAULT 30;
ALTER TABLE settings ALTER COLUMN custlog_retention_days SET DEFAULT 30;

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
END;
$$;

REVOKE ALL ON FUNCTION lfh_prune_logs() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_prune_logs() TO service_role;

NOTIFY pgrst, 'reload schema';
