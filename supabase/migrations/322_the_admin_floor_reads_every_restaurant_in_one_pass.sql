-- 322_the_admin_floor_reads_every_restaurant_in_one_pass.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- WHERE: Admin console (/aevinite) → Live Floor — the mini-tiles for every restaurant at once.
-- WHAT HE WOULD SEE: the screen feels slow, and it gets slower every time a restaurant is added.
-- Measured: 9 live restaurants, 1,850 configured tables, 1,851 tiles per load.
--
-- WHY. `lfh_admin_floor_all` loops the restaurants and calls `lfh_floor_state(rid)` for each, and
-- `lfh_floor_state` is a PL/pgSQL loop that runs SEVERAL queries PER TABLE — the open session, the
-- member counts, the belonging orders, the waiter calls, the tag. So one admin screen asked the
-- database roughly 1,851 × 5 small questions, and threw away most of each answer: the admin tiles
-- render five fields (table, state, pay dot, call badge, tag) and NEVER any money, by rule.
--
-- THE REWRITE. One set-based query for ALL restaurants: the table universe, the open session, the
-- order aggregates, the calls and the tags are each computed once as a grouped pass, then joined.
-- `lfh_floor_state` itself is NOT touched — the manager and owner floors keep using it, and it stays
-- the single source of truth for a tile that needs money.
--
-- PARITY IS LAW, so the rules below are transcribed from `lfh_floor_state`'s live body line by line:
--   · universe   = 1..table_count  ∪  tables with an OPEN session  ∪  tables with a live order
--                  (live = not archived, not cancelled), per restaurant, ordered numerically first.
--   · session    = the most recently active OPEN session for that (restaurant, table).
--   · belonging  = if a session is open → its non-archived non-cancelled orders (by session id);
--                  else if sessions are OFF for the restaurant → that table's non-archived
--                  non-cancelled orders; else → none (stale leftovers read as Free).
--   · state      = orders? received→'new', else preparing→'preparing', else any-unpaid→'served',
--                  else 'cleared'.  No orders but an open session → 'seated'. Otherwise 'free'.
--   · pay        = any-unpaid→'red', else any-accepted-and-paid→'green', else ''.
--                  ("accepted" = status NOT IN ('received','cancelled'), exactly as floor_state.)
--   · has_call   = an unresolved waiter call ON THE OPEN SESSION (never a stale one on a freed table).
--   · tag        = table_tags.tag for that (restaurant, table), '' when unmarked.
-- Money (`due`) and the orders array are deliberately absent — the admin sees no earnings.
--
-- PROVED, NOT ASSUMED: the old function's whole payload was captured for all 9 restaurants and all
-- 1,851 tiles and compared tile-by-tile against the new one. They must be identical, including the
-- ORDER of the tiles, because the screen renders them in that order.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.lfh_admin_floor_all()
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH live AS (   -- the restaurants the admin sees, in the SAME order as before (by name)
    SELECT r.id, r.name, COALESCE(s.table_count, 0) AS tcount,
           COALESCE(s.sessions_enabled, false) AS sessions_on
      FROM restaurants r
      LEFT JOIN settings s ON s.restaurant_id = r.id
     WHERE r.deleted_at IS NULL
  ),
  -- ── the table universe, per restaurant (UNION de-duplicates, as floor_state relies on) ──
  universe AS (
    SELECT l.id AS rid, generate_series(1, GREATEST(l.tcount, 0))::text AS t FROM live l
    UNION
    SELECT s.restaurant_id, s.table_number FROM sessions s
      JOIN live l ON l.id = s.restaurant_id
     WHERE s.status = 'open' AND s.table_number IS NOT NULL
    UNION
    SELECT o.restaurant_id, o.table_number FROM orders o
      JOIN live l ON l.id = o.restaurant_id
     WHERE NOT o.archived AND o.status <> 'cancelled' AND o.table_number IS NOT NULL
  ),
  -- ── the open session per (restaurant, table): the most recently active one ──
  sess AS (
    SELECT DISTINCT ON (s.restaurant_id, s.table_number)
           s.restaurant_id AS rid, s.table_number AS t, s.id AS sid
      FROM sessions s
      JOIN live l ON l.id = s.restaurant_id
     WHERE s.status = 'open' AND s.table_number IS NOT NULL
     ORDER BY s.restaurant_id, s.table_number, s.last_activity_at DESC
  ),
  -- ── the orders that BELONG to each tile, aggregated in one grouped pass ──
  -- Session-linked orders (whatever the restaurant's sessions setting is), keyed by the session's
  -- own table…
  by_session AS (
    SELECT se.rid, se.t,
           COALESCE(bool_or(o.status = 'received'), false)  AS has_new,
           COALESCE(bool_or(o.status = 'preparing'), false) AS has_prep,
           COALESCE(bool_or(o.status NOT IN ('received','cancelled') AND o.payment_status <> 'paid'), false) AS unpaid,
           COALESCE(bool_or(o.status NOT IN ('received','cancelled') AND o.payment_status =  'paid'), false) AS paid_any,
           count(*) > 0 AS has_orders
      FROM sess se
      JOIN orders o ON o.session_id = se.sid AND o.status <> 'cancelled' AND NOT o.archived
                   AND o.restaurant_id = se.rid
     GROUP BY se.rid, se.t
  ),
  -- …and, ONLY for a restaurant with sessions OFF and no open session on that table, the orders
  -- matched by table number instead. (floor_state's second branch, verbatim.)
  by_table AS (
    SELECT o.restaurant_id AS rid, o.table_number AS t,
           COALESCE(bool_or(o.status = 'received'), false)  AS has_new,
           COALESCE(bool_or(o.status = 'preparing'), false) AS has_prep,
           COALESCE(bool_or(o.status NOT IN ('received','cancelled') AND o.payment_status <> 'paid'), false) AS unpaid,
           COALESCE(bool_or(o.status NOT IN ('received','cancelled') AND o.payment_status =  'paid'), false) AS paid_any,
           count(*) > 0 AS has_orders
      FROM orders o
      JOIN live l ON l.id = o.restaurant_id AND NOT l.sessions_on
      LEFT JOIN sess se ON se.rid = o.restaurant_id AND se.t = o.table_number
     WHERE o.status <> 'cancelled' AND NOT o.archived AND o.table_number IS NOT NULL
       AND se.sid IS NULL
     GROUP BY o.restaurant_id, o.table_number
  ),
  -- ── unresolved calls, but only on an OPEN session (a stale call on a freed table is ignored) ──
  calls AS (
    SELECT se.rid, se.t, count(*) AS n
      FROM sess se
      JOIN waiter_calls c ON c.session_id = se.sid AND NOT c.resolved
     GROUP BY se.rid, se.t
  ),
  tiles AS (
    SELECT u.rid, u.t,
           (se.sid IS NOT NULL) AS open,
           COALESCE(bs.has_orders, bt.has_orders, false) AS has_orders,
           COALESCE(bs.has_new,    bt.has_new,    false) AS has_new,
           COALESCE(bs.has_prep,   bt.has_prep,   false) AS has_prep,
           COALESCE(bs.unpaid,     bt.unpaid,     false) AS unpaid,
           COALESCE(bs.paid_any,   bt.paid_any,   false) AS paid_any,
           COALESCE(ca.n, 0) > 0 AS has_call,
           COALESCE(tg.tag, '')  AS tag
      FROM universe u
      LEFT JOIN sess       se ON se.rid = u.rid AND se.t = u.t
      LEFT JOIN by_session bs ON bs.rid = u.rid AND bs.t = u.t
      LEFT JOIN by_table   bt ON bt.rid = u.rid AND bt.t = u.t
      LEFT JOIN calls      ca ON ca.rid = u.rid AND ca.t = u.t
      LEFT JOIN table_tags tg ON tg.restaurant_id = u.rid AND tg.table_number = u.t
  )
  SELECT COALESCE(json_agg(x.obj ORDER BY x.name), '[]'::json) FROM (
    SELECT l.name,
           json_build_object(
             'restaurant_id', l.id,
             'tables', COALESCE((
               SELECT json_agg(json_build_object(
                        'n', ti.t,
                        's', CASE WHEN ti.has_orders THEN
                                    CASE WHEN ti.has_new  THEN 'new'
                                         WHEN ti.has_prep THEN 'preparing'
                                         WHEN ti.unpaid   THEN 'served'
                                         ELSE 'cleared' END
                                  WHEN ti.open THEN 'seated'
                                  ELSE 'free' END,
                        'p', CASE WHEN ti.unpaid THEN 'red' WHEN ti.paid_any THEN 'green' ELSE '' END,
                        'c', ti.has_call,
                        'g', ti.tag
                      ) ORDER BY CASE WHEN ti.t ~ '^[0-9]+$' THEN ti.t::int ELSE 2147483647 END, ti.t)
                 FROM tiles ti WHERE ti.rid = l.id), '[]'::json)
           ) AS obj
      FROM live l
  ) x;
$function$;

-- Unchanged from mig 145: staff-only, the admin API holds the service-role key behind its cookie gate.
REVOKE ALL ON FUNCTION public.lfh_admin_floor_all() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.lfh_admin_floor_all() TO service_role;

NOTIFY pgrst, 'reload schema';
