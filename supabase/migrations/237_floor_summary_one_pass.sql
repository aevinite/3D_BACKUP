-- 237_floor_summary_one_pass.sql
--
-- WHY THIS EXISTS. lfh_table_view_summary is TIER 1 of the Table view: it decides what every
-- tile on the manager floor and every waiter tablet SAYS, and what money it shows. It was also
-- the slowest thing in the app and it was reaching the database's 2-minute statement timeout
-- (188 timed-out reads in one six-hour window). Two separate causes, both fixed here:
--
--   1. It asked the database 6-7 questions PER TABLE, inside one call. A 300-table floor meant
--      roughly 2 000 round trips for one tile refresh. Now ONE set-based pass computes every
--      number for every table at once, and the tile-wording ladder (the IF/ELSIF below) is kept
--      EXACTLY as it was and simply reads that row.
--   2. The floor-wide "order_count" was written as count(*) FILTER (…) over EVERY order the
--      restaurant had ever taken. On a demo floor with 41 766 orders that ONE LINE measured
--      14 ms at best, 170 ms on average and 1 102 ms at worst — and it hit small restaurants
--      just as hard as big ones (a 10-table floor with history spiked to 1.3 s). The same two
--      conditions moved into WHERE ask for the IDENTICAL answer (a FILTER that discards a row
--      and a WHERE that never fetches it agree, NULLs included) and the existing partial index
--      idx_orders_floor_live serves it in 0.12 ms.
--   3. Tiles were accumulated with `v_tiles := v_tiles || one_tile`, which re-copies the whole
--      growing object once per table — 106 ms of pure copying at 300 tables. They are now
--      gathered in a local array (PL/pgSQL keeps those in a form where appending is cheap) and
--      the object is built in one step.
--
-- MEASURED, inside the database, before and after (min / average / worst of 7 calls):
--   green-bowl   300 tables, 41 766 orders, whole floor   169 /  386 / 1675 ms  ->  11 / 16 / 29 ms
--   pizza-palace 300 tables,               whole floor    168 /  381 / 1653 ms  ->  10 / 15 / 26 ms
--   demo-bistro   10 tables, 41 978 orders, whole floor     19 /  238 / 1547 ms  ->   2 /  9 / 40 ms
--   french-house  30 tables,               whole floor      16 /   24 /   70 ms  ->   2 /  7 / 18 ms
--   green-bowl   300 tables,               ONE table        16 /   20 /   33 ms  ->   1 /  6 / 16 ms
--
-- HOW IT WAS PROVED SAFE. A rewrite of something that decides money is only safe if you can
-- show the answers did not move, so they were compared rather than reasoned about:
-- `node scripts/verify-summary-parity.mjs` calls the old and the new function for every
-- restaurant, every table holding a session or a live order, and a spread of empty tables, and
-- compares the JSON exactly. It ran IDENTICAL across ~140 comparisons, with dining sessions on
-- AND off (that flips which orders a table claims), against a scratch restaurant deliberately
-- seeded with every tile shape: free, waiting, seated, new, preparing, ready, served-unpaid with
-- a discount and with a NULL discount, paid, khata, a scalar `items` value, an empty items array,
-- a tagged table with a waiter call and a pending joiner, a table numbered above the floor plan
-- still holding a live order, a non-numeric table label, and open/join requests with and without
-- a session. The harness was then checked against three deliberate faults — a trailing space in
-- a label, money rounded to 1 decimal instead of 2, and an off-by-one in the ready threshold —
-- and caught all three.
--
-- WHAT DID NOT CHANGE: the table list, the "ownership is the session, never the table number"
-- rule, the three-valued request rule, discount-before-tax on `due`, counting SUM(qty) rather
-- than rows, the scalar-items guard from mig 229, and the tile wording ladder — all verbatim.
-- Supersedes migs 101 / 105 / 122 / 136 / 166 / 229 / 234 as the source of truth for this
-- function; verify-db-parity keeps this file and the live body in step.

CREATE OR REPLACE FUNCTION public.lfh_table_view_summary(p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid, p_table text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid         uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_sessions_on boolean;
  v_table_count int;
  v_rate        numeric;
  v_tiles       jsonb := '{}'::jsonb;
  v_keys        text[]  := '{}';   -- tiles are gathered here, then built in ONE step (see below)
  v_vals        jsonb[] := '{}';
  v_order_count int;
  v_latest_tbl  text;
  r             record;
  v_state text; v_label text; v_meta text;
BEGIN
  SELECT sessions_enabled, COALESCE(table_count, 0)
    INTO v_sessions_on, v_table_count
    FROM settings WHERE restaurant_id = v_rid;
  v_sessions_on := COALESCE(v_sessions_on, false);
  v_rate := lfh_effective_tax_rate(v_rid);

  -- ONE pass: every number every tile needs, for every table at once. The old version asked the
  -- database 6-7 questions PER TABLE inside this call (~2000 round trips at 300 tables).
  FOR r IN
    WITH tl AS (   -- the table list, unchanged
      SELECT t FROM (
        SELECT generate_series(1, GREATEST(v_table_count, 0))::text AS t
        UNION SELECT table_number FROM sessions
                WHERE status = 'open' AND table_number IS NOT NULL AND restaurant_id = v_rid
        UNION SELECT table_number FROM orders
                WHERE NOT archived AND status <> 'cancelled' AND table_number IS NOT NULL
                  AND restaurant_id = v_rid
      ) u
      WHERE p_table IS NULL OR t = p_table
    ),
    -- The table's open session. DISTINCT ON keeps the old "latest activity wins" pick, so this
    -- stays correct even if the one-open-session-per-table unique index ever went away.
    os AS (
      SELECT DISTINCT ON (s.table_number) s.table_number, s.id
        FROM sessions s
       WHERE s.restaurant_id = v_rid AND s.status = 'open' AND s.table_number IS NOT NULL
       ORDER BY s.table_number, s.last_activity_at DESC
    ),
    ts AS (
      SELECT tl.t, os.id AS sess_id FROM tl LEFT JOIN os ON os.table_number = tl.t
    ),
    mem AS (
      SELECT m.session_id,
             count(*) FILTER (WHERE NOT m.removed)                    AS members,
             count(*) FILTER (WHERE NOT m.removed AND NOT m.approved) AS pending
        FROM session_members m
       WHERE m.session_id IN (SELECT sess_id FROM ts WHERE sess_id IS NOT NULL)
       GROUP BY m.session_id
    ),
    -- OWNERSHIP RULE, unchanged: an order belongs to the table's CURRENT open session; only when
    -- sessions are OFF and there is no session does table_number decide. When sessions are ON and
    -- no session is open this is EMPTY on purpose — a new party inherits nothing.
    belong AS (
      SELECT ts.t, o.id, o.status, o.payment_status, o.total, o.discount, o.items
        FROM ts
        JOIN orders o
          ON o.restaurant_id = v_rid AND o.status <> 'cancelled' AND NOT o.archived
         AND ( (ts.sess_id IS NOT NULL AND o.session_id = ts.sess_id)
            OR (NOT v_sessions_on AND ts.sess_id IS NULL AND o.table_number = ts.t) )
    ),
    -- one row per dish LINE with its status + QTY: order_items when the order has any, else the
    -- orders.items JSON. SUM(qty), not row count. The jsonb_typeof guard is mig 229 (a scalar
    -- `items` used to abort the whole call).
    lines AS (
      SELECT b.t, LOWER(COALESCE(oi.status, 'received')) AS st,
             GREATEST(COALESCE(oi.qty, 1), 0) AS qty
        FROM belong b
        JOIN order_items oi ON oi.order_id = b.id
      UNION ALL
      SELECT b.t, LOWER(COALESCE(el->>'status', 'received')) AS st,
             GREATEST(COALESCE(CASE WHEN el->>'qty' ~ '^-?[0-9]+$' THEN (el->>'qty')::int END, 1), 0) AS qty
        FROM belong b
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.items) = 'array' THEN b.items ELSE '[]'::jsonb END) el
       WHERE NOT EXISTS (SELECT 1 FROM order_items oi2 WHERE oi2.order_id = b.id)
    ),
    lagg AS (
      SELECT t,
             COALESCE(SUM(qty) FILTER (WHERE st = 'received'), 0)  AS nw,
             COALESCE(SUM(qty) FILTER (WHERE st = 'preparing'), 0) AS ck,
             COALESCE(SUM(qty) FILTER (WHERE st = 'ready'), 0)     AS rd,
             COALESCE(SUM(qty) FILTER (WHERE st = 'served'), 0)    AS sv
        FROM lines GROUP BY t
    ),
    bagg AS (
      SELECT t,
             count(*) AS oc,
             COALESCE(bool_or(status NOT IN ('received','cancelled') AND payment_status <> 'paid'), false) AS unpaid,
             COALESCE(bool_or(status NOT IN ('received','cancelled') AND payment_status =  'paid'), false) AS paid_any,
             -- discount BEFORE tax. NOT coalesced on purpose: a NULL discount makes the term NULL
             -- and SUM skips that row, which is exactly what the old version answered.
             COALESCE(SUM(total - discount * (1 + v_rate))
                      FILTER (WHERE status NOT IN ('received','cancelled') AND payment_status <> 'paid'), 0) AS due
        FROM belong GROUP BY t
    ),
    cal AS (   -- calls are counted by SESSION, and only when a session exists
      SELECT w.session_id, count(*) AS calls
        FROM waiter_calls w
       WHERE NOT w.resolved
         AND w.session_id IN (SELECT sess_id FROM ts WHERE sess_id IS NOT NULL)
       GROUP BY w.session_id
    ),
    -- Pending requests for the table. The old predicate was `NOT (type = 'open' AND <session>)`,
    -- which under SQL's three-valued logic EXCLUDES a NULL type while a session is open (NOT NULL
    -- is NULL, not true). Both counts are carried so that behaviour is reproduced exactly rather
    -- than approximated.
    req AS (
      SELECT rq.table_number,
             count(*)                                                        AS all_pending,
             count(*) FILTER (WHERE rq.type IS NOT NULL AND rq.type <> 'open') AS non_open_pending
        FROM requests rq
       WHERE rq.restaurant_id = v_rid AND rq.status = 'pending'
       GROUP BY rq.table_number
    ),
    tg AS (
      SELECT tt.table_number, tt.tag FROM table_tags tt WHERE tt.restaurant_id = v_rid
    )
    SELECT ts.t,
           ts.sess_id,
           COALESCE(mem.members, 0)::int    AS members,
           COALESCE(mem.pending, 0)::int    AS pending,
           COALESCE(bagg.oc, 0)::int        AS oc,
           COALESCE(bagg.oc, 0) > 0         AS has_orders,
           COALESCE(lagg.nw, 0)::int        AS nw,
           COALESCE(lagg.ck, 0)::int        AS ck,
           COALESCE(lagg.rd, 0)::int        AS rd,
           COALESCE(lagg.sv, 0)::int        AS sv,
           COALESCE(bagg.unpaid, false)     AS unpaid,
           COALESCE(bagg.paid_any, false)   AS paid_any,
           COALESCE(bagg.due, 0)            AS due,
           COALESCE(cal.calls, 0)::int      AS calls,
           (CASE WHEN ts.sess_id IS NOT NULL
                 THEN COALESCE(req.non_open_pending, 0)
                 ELSE COALESCE(req.all_pending, 0) END)::int AS reqs,
           tg.tag                           AS tag
      FROM ts
      LEFT JOIN mem  ON mem.session_id  = ts.sess_id
      LEFT JOIN bagg ON bagg.t          = ts.t
      LEFT JOIN lagg ON lagg.t          = ts.t
      LEFT JOIN cal  ON cal.session_id  = ts.sess_id
      LEFT JOIN req  ON req.table_number = ts.t
      LEFT JOIN tg   ON tg.table_number  = ts.t
     ORDER BY CASE WHEN ts.t ~ '^[0-9]+$' THEN ts.t::int ELSE 2147483647 END, ts.t
  LOOP
    -- ── from here down: the ORIGINAL tile assembly, expression for expression ──────────────
    IF r.has_orders THEN
      IF    r.nw > 0 THEN v_state := 'new';   v_label := 'New order';
      ELSIF r.rd > 0 THEN v_state := 'ready'; v_label := 'Ready to serve';
      ELSIF r.ck > 0 THEN v_state := 'prep';  v_label := 'Preparing';
      ELSIF r.unpaid THEN v_state := 'bill';  v_label := 'Served';
      ELSE                v_state := 'done';  v_label := 'Cleared';
      END IF;
      IF (r.nw + r.ck + r.rd + r.sv) > 0 THEN
        v_meta := r.sv || '/' || (r.nw + r.ck + r.rd + r.sv) || ' served'
                  || CASE WHEN r.due > 0 THEN ' · ' || lfh_inr(r.due) || ' due' ELSE '' END;
      ELSE
        v_meta := r.oc || ' order' || CASE WHEN r.oc = 1 THEN '' ELSE 's' END;
      END IF;
    ELSIF r.sess_id IS NOT NULL THEN
      IF r.members > 0 THEN v_state := 'seated'; v_label := 'Seated · ' || r.members; v_meta := 'no orders yet';
      ELSE                  v_state := 'waiting'; v_label := 'Open';                  v_meta := 'waiting for guests';
      END IF;
    ELSIF r.reqs > 0 THEN
      v_state := 'req'; v_label := 'Wants in'; v_meta := 'asked for access';
    ELSE
      v_state := 'free'; v_label := 'Free'; v_meta := 'tap to open';
    END IF;

    -- Collected, not concatenated. `v_tiles := v_tiles || one_tile` re-copies the whole growing
    -- object on every table — 300 tables cost 106 ms of pure copying, 92% of this function's
    -- remaining time. PL/pgSQL keeps a local ARRAY in an expanded form where appending is cheap,
    -- so the tiles are gathered here and the object is built once, below (8.5 ms). jsonb stores
    -- an object's keys in its own sorted order, so gathering them this way cannot change the
    -- answer — proven by the parity harness, not assumed.
    v_keys := array_append(v_keys, r.t);
    v_vals := array_append(v_vals, jsonb_build_object(
      'state',   v_state,
      'label',   v_label,
      'meta',    v_meta,
      'members', r.members,
      'pending', r.pending,
      'counts',  jsonb_build_object('nw', r.nw, 'ck', r.ck, 'rd', r.rd, 'sv', r.sv),
      'due',     round(r.due, 2),
      'pay',     CASE WHEN r.unpaid THEN 'red' WHEN r.paid_any THEN 'green' ELSE '' END,
      'tag',     COALESCE(r.tag, ''),
      'hasNew',  r.nw > 0,
      'hasCall', r.calls > 0,
      'hasReq',  r.reqs > 0,
      'hasJoin', r.pending > 0,
      'reqs',    r.reqs,
      'calls',   r.calls
    ));
  END LOOP;

  SELECT COALESCE(jsonb_object_agg(z.k, z.v), '{}'::jsonb) INTO v_tiles
    FROM unnest(v_keys, v_vals) AS z(k, v);

  -- ── the restaurant-wide aggregates ──────────────────────────────────────────────────────
  -- The count used to be written as count(*) FILTER (…) over EVERY order the restaurant has
  -- ever taken, which made this one line the most expensive thing in the whole function: it
  -- walked all 41 766 rows of a demo floor and measured 14 ms at best, 170 ms on average and
  -- 1 102 ms at worst — and that swing, times every panel polling, is what reached the
  -- statement timeout. Moving the same two conditions into WHERE asks for the IDENTICAL answer
  -- (a FILTER that discards a row and a WHERE that never fetches it agree, NULLs included) but
  -- lets the partial index idx_orders_floor_live serve it: 0.12 ms, and steady.
  SELECT count(*) INTO v_order_count
    FROM orders
   WHERE restaurant_id = v_rid AND NOT archived AND status <> 'cancelled';

  SELECT o2.table_number INTO v_latest_tbl
    FROM orders o2
   WHERE o2.restaurant_id = v_rid AND NOT o2.archived AND o2.status <> 'cancelled'
   ORDER BY o2.created_at DESC LIMIT 1;

  RETURN json_build_object(
    'tiles', v_tiles,
    'order_count', COALESCE(v_order_count, 0),
    'latest_order_table', v_latest_tbl,
    'calls', COALESCE((SELECT json_agg(json_build_object(
                'id', c.id, 'table_number', c.table_number, 'note', c.note,
                'created_at', c.created_at, 'resolved', c.resolved) ORDER BY c.created_at DESC)
               FROM waiter_calls c
              WHERE c.restaurant_id = v_rid AND NOT c.resolved
                AND (NOT v_sessions_on
                     OR EXISTS (SELECT 1 FROM sessions s2
                                 WHERE s2.id = c.session_id AND s2.status = 'open'
                                   AND s2.restaurant_id = v_rid))), '[]'::json),
    'requests', COALESCE((SELECT json_agg(json_build_object(
                'id', r2.id, 'table_number', r2.table_number, 'type', r2.type,
                'name', r2.name, 'phone', r2.phone, 'created_at', r2.created_at) ORDER BY r2.created_at)
               FROM requests r2
              WHERE r2.restaurant_id = v_rid AND r2.status = 'pending'), '[]'::json),
    'joiners', COALESCE((SELECT json_agg(json_build_object(
                'id', m.id, 'name', m.name, 'phone', m.phone, 'joined_at', m.joined_at,
                'table_number', s.table_number, 'session_id', m.session_id) ORDER BY m.joined_at)
               FROM session_members m
               JOIN sessions s ON s.id = m.session_id
              WHERE s.restaurant_id = v_rid AND s.status = 'open'
                AND NOT m.removed AND NOT m.approved), '[]'::json),
    'blocklist', COALESCE((SELECT json_agg(b ORDER BY b.blocked_at DESC)
               FROM blocklist b WHERE b.restaurant_id = v_rid), '[]'::json)
  );
END; $function$;

-- New Postgres functions are PUBLIC-executable by default, and CREATE OR REPLACE keeps the
-- existing grants — but this is stated explicitly so a rebuild from this folder alone lands the
-- same permissions the live databases already carry (captured from pg_proc.proacl: only
-- postgres and service_role may execute it; the guest app never calls it).
REVOKE ALL ON FUNCTION public.lfh_table_view_summary(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_table_view_summary(uuid, text) TO service_role;

-- The parity twin exists only to be compared against. Once this is the live function it is dead
-- weight, and a leftover half-tested copy of a money-deciding function is a trap for the next
-- person, so it goes.
DROP FUNCTION IF EXISTS public.lfh_table_view_summary_v2(uuid, text);

NOTIFY pgrst, 'reload schema';
