-- 359_a_tablet_switch_holds_only_its_three_values_and_the_limiter_forgets_dead_counters.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Two small pieces of housekeeping, both from sweep #6 terminal 22 and both approved by the owner
-- on 2026-08-22 ("do all the things you told in the need decision"). They are in one file because
-- this terminal's reserved block of migration numbers ends here; they are independent of each
-- other and either can be undone without the other.
--
-- ── A · the last two tablet switches get the value check the other seven have (improvement I2) ──
-- `settings` carries nine tablet capability switches. Seven of them — banquet, discount, invoice,
-- khata, mark_paid, table_ops, table_tags — are declared with
-- CHECK (col IN ('off','on','pin')). Two are not: `tablet_take_orders` (migration 178) and
-- `tablet_parcel` (migration 197), both from this same range, and both DOCUMENTED as tri-states in
-- their own headers. Migration 178 even repairs values outside those three, which is the author
-- saying out loud what the column is for.
--
-- A value outside the three reads as "off" to the tablet, so a single stray write would quietly
-- stop a restaurant taking orders on the tablet, or hide parcel — with nothing on any screen to
-- say why. The repair below runs FIRST so the constraint can never fail on existing data (all 17
-- rows on the dev stack already hold valid values; this makes the file safe on any stack).
--
-- ── B · the nightly prune also forgets dead rate-limit counters (improvement I3) ───────────────
-- Body below is the CURRENT LIVE DEFINITION of lfh_prune_logs taken from the database with
-- pg_get_functiondef, with ONE delete added at the end — the method migrations 206/207 used, so
-- the per-restaurant retention windows, the one-month hard cap and the agent_runs / fix_requests
-- sweeps that migrations 152, 157, 158 and 162 built are all preserved exactly.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- ── A ────────────────────────────────────────────────────────────────────────────────────────
-- Repair first, constrain second. Both columns default to a valid value, so this touches nothing
-- on a healthy database.
UPDATE settings SET tablet_take_orders = 'on'
 WHERE tablet_take_orders IS NULL OR tablet_take_orders NOT IN ('off', 'on', 'pin');
UPDATE settings SET tablet_parcel = 'off'
 WHERE tablet_parcel IS NULL OR tablet_parcel NOT IN ('off', 'on', 'pin');

DO $tablet_tristates$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.settings'::regclass
                    AND conname = 'settings_tablet_take_orders_check') THEN
    ALTER TABLE settings ADD CONSTRAINT settings_tablet_take_orders_check
      CHECK (tablet_take_orders IN ('off', 'on', 'pin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.settings'::regclass
                    AND conname = 'settings_tablet_parcel_check') THEN
    ALTER TABLE settings ADD CONSTRAINT settings_tablet_parcel_check
      CHECK (tablet_parcel IN ('off', 'on', 'pin'));
  END IF;
END $tablet_tristates$;

-- ── B ────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_prune_logs()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- (359) …and the rate limiter's dead counters.
  -- rate_limit_counters holds one row per (restaurant, key, SUBJECT) and nothing has ever removed
  -- them except a restaurant purge or an admin pressing "Allow" on one subject. The subject for
  -- 'join_session' is the guest's DEVICE, so a busy restaurant grows one permanently dead row per
  -- phone that ever scanned a table. Harmless at 140 rows; unbounded over years.
  --
  -- A row is only removed once its window is provably CLOSED, so this can never reset a limit
  -- somebody is still inside. The window comes from the same rule lfh_rate_check resolves — a
  -- restaurant's own row beats the global default — and we wait at least a day on top, so even a
  -- rule edited to a very long window is safe. A closed window is already worth nothing to
  -- enforcement: lfh_rate_check restarts the count the moment it finds one.
  --
  -- rate_limit_EVENTS are deliberately NOT touched. An open one is a problem waiting on the admin's
  -- screen, and a resolved one is the record of what happened.
  DELETE FROM rate_limit_counters c
   WHERE c.window_start < now() - GREATEST(
           -- alias `rr`, NOT `r`: this function already DECLAREs `r RECORD` for its
           -- per-restaurant loop, and PL/pgSQL resolves a bare `r.x` to that variable rather
           -- than to a table alias — which fails at run time with
           -- 'record "r" has no field "window_seconds"'. Caught by running the prune.
           COALESCE((SELECT make_interval(secs => rr.window_seconds)
                       FROM rate_limit_rules rr
                      WHERE rr.key = c.key
                        AND (rr.restaurant_id = NULLIF(c.restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid)
                             OR rr.restaurant_id IS NULL)
                      ORDER BY (rr.restaurant_id IS NOT NULL) DESC
                      LIMIT 1), interval '1 day'),
           interval '1 day');
END;
$function$;

REVOKE ALL ON FUNCTION public.lfh_prune_logs() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.lfh_prune_logs() TO service_role;

NOTIFY pgrst, 'reload schema';
