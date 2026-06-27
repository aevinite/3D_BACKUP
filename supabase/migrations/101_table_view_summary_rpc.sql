-- 101_table_view_summary_rpc.sql
-- TWO-TIER MANAGER TABLE-VIEW (owner perf, 2026-06-27): the manager floor GRID used to
-- render every tile from the FULL board (lfh_floor_bundle, mig 100) — full session +
-- member + order_item + call + request rows for EVERY open table. At 300 tables that's
-- ~388 kB (≈1 MB with members/calls), re-fetched on every wake / 60s backup poll. The DB
-- query is fast (~55ms); the PAYLOAD is the bottleneck.
--
-- This RPC is TIER 1: a MINIMAL per-tile summary for the GRID. Per table it carries only
-- the small things a tile needs — its computed STATE, label/meta, status COUNTS (not the
-- item rows), member COUNT (not member rows), the badge counts, due, pay ring — plus the
-- small restaurant-wide aggregates the side panel + chimes need (pending calls / requests /
-- joiners, blocklist, a diffable live-order count + the latest order's table for the chime
-- toast). Heavy per-order item rows + full member rows move to TIER 2 (detail-on-tap, which
-- still uses lfh_floor_bundle(?table=N) — unchanged).
--
-- PARITY IS LAW: each tile's state/label/counts/pay/badges MUST match exactly what the
-- panel's tableTileState() (public/panels/editor/app.js) produced from the full board, or
-- the grid lies. So this replicates tableTileState's rules, NOT lfh_floor_state's (which
-- works off ORDER status and lacks 'ready'/'waiting'/'req'). The rules, mirrored 1:1:
--   • orders that BELONG to a table: non-archived, non-cancelled; if sessions ON and the
--     table has NO open session → none (stale leftovers ignored → Free).
--   • per-dish status comes from order_items when the order has them, else orders.items JSON.
--   • counts: nw=received, ck=preparing, rd=ready, sv=served.
--   • isUnpaidBill(o): status NOT IN (cancelled, received) AND payment_status <> 'paid'.
--   • state precedence (orders present): received→'new', else ready→'ready', else
--     preparing→'prep', else any-unpaid→'bill', else 'done'. No orders but open session:
--     members>0→'seated' else 'waiting'. No orders/session but a pending request→'req',
--     else 'free'.
--   • pay ring: any-unpaid→'red', else any ACCEPTED-and-paid→'green', else '' (a brand-new
--     'received' order shows NO ring until staff accept it — same as the tile).
--   • due = Σ (total − discount) over isUnpaidBill orders.
--
-- service-role only (the editor endpoint calls it via supabaseAdmin). Tiny at 300 (the
-- aggregate arrays carry only OPEN tables / PENDING rows, not the whole floor).

-- p_table NULL → whole-floor grid (the default load/poll). p_table set → ONLY that table's
-- tile, for the TARGETED refetch (pollTables, ?table=N) — so a realtime breadcrumb naming one
-- table re-fetches a tiny single-tile summary, not the whole 84 kB board. The restaurant-wide
-- aggregates (calls/requests/joiners/blocklist + order_count) are tiny, so we always return
-- them (the targeted path needs fresh aggregates for the side panel + chimes too).
CREATE OR REPLACE FUNCTION lfh_table_view_summary(
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001',
  p_table text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid         uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_sessions_on boolean;
  v_table_count int;
  v_t           text;
  v_sess        sessions;
  v_members     int;
  v_pending     int;
  v_calls       int;
  -- per-dish status tallies across the table's belonging orders
  v_nw int; v_ck int; v_rd int; v_sv int;
  v_has_orders boolean;
  v_unpaid     boolean;   -- any accepted, unpaid bill
  v_paid_any   boolean;   -- any accepted, paid bill
  v_due        numeric;
  v_reqs       int;
  v_state      text;
  v_label      text;
  v_meta       text;
  v_tiles      jsonb := '{}'::jsonb;
  v_order_count int;
  v_latest_tbl  text;
BEGIN
  SELECT sessions_enabled, COALESCE(table_count, 0)
    INTO v_sessions_on, v_table_count
    FROM settings WHERE restaurant_id = v_rid;
  v_sessions_on := COALESCE(v_sessions_on, false);

  -- Same table universe as lfh_floor_state: 1..table_count PLUS any table with an open
  -- session or a live order, scoped to this restaurant. When p_table is set (targeted
  -- refetch) compute ONLY that one tile.
  FOR v_t IN
    SELECT t FROM (
      SELECT generate_series(1, GREATEST(v_table_count, 0))::text AS t
      UNION SELECT table_number FROM sessions
              WHERE status = 'open' AND table_number IS NOT NULL AND restaurant_id = v_rid
      UNION SELECT table_number FROM orders
              WHERE NOT archived AND status <> 'cancelled' AND table_number IS NOT NULL
                AND restaurant_id = v_rid
    ) u
    WHERE p_table IS NULL OR t = p_table
    ORDER BY CASE WHEN t ~ '^[0-9]+$' THEN t::int ELSE 2147483647 END, t
  LOOP
    -- The table's OPEN session (most recently active), if any.
    SELECT * INTO v_sess
      FROM sessions
      WHERE table_number = v_t AND status = 'open' AND restaurant_id = v_rid
      ORDER BY last_activity_at DESC
      LIMIT 1;

    -- Seated headcount + how many joiners await approval (COUNTS only — the tile shows
    -- "Seated · N" and a 🙋N badge; the full member rows are TIER 2).
    v_members := 0; v_pending := 0;
    IF v_sess.id IS NOT NULL THEN
      SELECT count(*) FILTER (WHERE NOT removed),
             count(*) FILTER (WHERE NOT removed AND NOT approved)
        INTO v_members, v_pending
        FROM session_members WHERE session_id = v_sess.id;
    END IF;

    -- Orders that BELONG to this table (same rule as ordersForTable + the floor brain):
    --   open session → its non-archived, non-cancelled orders (by session id);
    --   sessions OFF + no open session → the table's non-archived, non-cancelled orders;
    --   sessions ON + no open session → none (stale → Free).
    -- For each belonging order, count its dishes by status: from order_items when the
    -- order has any, else the orders.items JSON (mirrors orderItemRows()).
    v_nw := 0; v_ck := 0; v_rd := 0; v_sv := 0;
    v_has_orders := false; v_unpaid := false; v_paid_any := false; v_due := 0;

    WITH belong AS (
      SELECT o.* FROM orders o
      WHERE o.status <> 'cancelled' AND NOT o.archived
        AND o.restaurant_id = v_rid
        AND (
              (v_sess.id IS NOT NULL AND o.session_id = v_sess.id)
           OR (NOT v_sessions_on AND v_sess.id IS NULL AND o.table_number = v_t)
        )
    ),
    -- one row per dish, status normalised, from order_items if present else items JSON
    dishes AS (
      SELECT b.id AS order_id,
             COALESCE(
               (SELECT json_agg(LOWER(COALESCE(oi.status, 'received')))
                  FROM order_items oi WHERE oi.order_id = b.id),
               (SELECT json_agg(LOWER(COALESCE(el->>'status', 'received')))
                  FROM jsonb_array_elements(COALESCE(b.items, '[]'::jsonb)) el)
             ) AS statuses
      FROM belong b
    ),
    flat AS (
      SELECT LOWER(s.value::text) AS st
      FROM dishes d, json_array_elements_text(COALESCE(d.statuses, '[]'::json)) s(value)
    )
    SELECT
      (SELECT count(*) > 0 FROM belong),
      COALESCE((SELECT count(*) FILTER (WHERE st = 'received') FROM flat), 0),
      COALESCE((SELECT count(*) FILTER (WHERE st = 'preparing') FROM flat), 0),
      COALESCE((SELECT count(*) FILTER (WHERE st = 'ready') FROM flat), 0),
      COALESCE((SELECT count(*) FILTER (WHERE st = 'served') FROM flat), 0),
      -- isUnpaidBill: accepted (not 'received'), not cancelled, not paid
      COALESCE((SELECT bool_or(status NOT IN ('received','cancelled') AND payment_status <> 'paid') FROM belong), false),
      COALESCE((SELECT bool_or(status NOT IN ('received','cancelled') AND payment_status =  'paid') FROM belong), false),
      COALESCE((SELECT SUM(total - discount) FILTER (WHERE status NOT IN ('received','cancelled') AND payment_status <> 'paid') FROM belong), 0)
      INTO v_has_orders, v_nw, v_ck, v_rd, v_sv, v_unpaid, v_paid_any, v_due;

    -- Waiter calls only count while the table is actually open (no lingering badges).
    v_calls := 0;
    IF v_sess.id IS NOT NULL THEN
      SELECT count(*) INTO v_calls
        FROM waiter_calls WHERE session_id = v_sess.id AND NOT resolved;
    END IF;

    -- Pending requests for this table. An 'open' request is MOOT once the table is open
    -- (already fulfilled) — exclude it then (mirrors reqsForTable()).
    SELECT count(*) INTO v_reqs
      FROM requests r
      WHERE r.restaurant_id = v_rid AND r.status = 'pending' AND r.table_number = v_t
        AND NOT (r.type = 'open' AND v_sess.id IS NOT NULL);

    -- ── tableTileState precedence, mirrored exactly ──
    IF v_has_orders THEN
      IF    v_nw > 0 THEN v_state := 'new';   v_label := 'New order';
      ELSIF v_rd > 0 THEN v_state := 'ready'; v_label := 'Ready to serve';
      ELSIF v_ck > 0 THEN v_state := 'prep';  v_label := 'Preparing';
      ELSIF v_unpaid THEN v_state := 'bill';  v_label := 'Served';
      ELSE                v_state := 'done';  v_label := 'Cleared';
      END IF;
      -- meta: "<served>/<total> served[ · <due> due]" when there are dishes, else "<n> orders"
      IF (v_nw + v_ck + v_rd + v_sv) > 0 THEN
        v_meta := v_sv || '/' || (v_nw + v_ck + v_rd + v_sv) || ' served'
                  || CASE WHEN v_due > 0 THEN ' · ' || lfh_inr(v_due) || ' due' ELSE '' END;
      ELSE
        -- "<n> order" / "<n> orders" — match the client tile (os.length === 1 ? "order" : "orders").
        DECLARE v_oc int;
        BEGIN
          SELECT count(*) INTO v_oc FROM orders o WHERE o.status <> 'cancelled' AND NOT o.archived
            AND o.restaurant_id = v_rid
            AND ((v_sess.id IS NOT NULL AND o.session_id = v_sess.id)
                 OR (NOT v_sessions_on AND v_sess.id IS NULL AND o.table_number = v_t));
          v_meta := v_oc || ' order' || CASE WHEN v_oc = 1 THEN '' ELSE 's' END;
        END;
      END IF;
    ELSIF v_sess.id IS NOT NULL THEN
      IF v_members > 0 THEN v_state := 'seated'; v_label := 'Seated · ' || v_members; v_meta := 'no orders yet';
      ELSE                  v_state := 'waiting'; v_label := 'Open';                   v_meta := 'waiting for guests';
      END IF;
    ELSIF v_reqs > 0 THEN
      v_state := 'req'; v_label := 'Wants in'; v_meta := 'asked for access';
    ELSE
      v_state := 'free'; v_label := 'Free'; v_meta := 'tap to open';
    END IF;

    v_tiles := v_tiles || jsonb_build_object(v_t, jsonb_build_object(
      'state',   v_state,
      'label',   v_label,
      'meta',    v_meta,
      'members', v_members,
      'pending', v_pending,
      'counts',  jsonb_build_object('nw', v_nw, 'ck', v_ck, 'rd', v_rd, 'sv', v_sv),
      'due',     round(v_due, 2),
      'pay',     CASE WHEN v_unpaid THEN 'red' WHEN v_paid_any THEN 'green' ELSE '' END,
      'hasNew',  v_nw > 0,
      'hasCall', v_calls > 0,
      'hasReq',  v_reqs > 0,
      'hasJoin', v_pending > 0,
      'reqs',    v_reqs,
      'calls',   v_calls
    ));
  END LOOP;

  -- Restaurant-wide aggregates the SIDE PANEL + CHIMES need (all tiny — only OPEN tables /
  -- PENDING rows). The grid never needs full member rows; the side panel's joiner queue does,
  -- but only for the PENDING joiners (a handful), so we ship just those.
  SELECT count(*) FILTER (WHERE NOT archived AND status <> 'cancelled'),
         (SELECT o2.table_number FROM orders o2
            WHERE o2.restaurant_id = v_rid AND NOT o2.archived AND o2.status <> 'cancelled'
            ORDER BY o2.created_at DESC LIMIT 1)
    INTO v_order_count, v_latest_tbl
    FROM orders WHERE restaurant_id = v_rid;

  RETURN json_build_object(
    'tiles', v_tiles,
    'order_count', COALESCE(v_order_count, 0),
    'latest_order_table', v_latest_tbl,
    -- Only calls on an OPEN session (matched by the call's session_id) — so a stale
    -- unresolved call on a closed/freed table can never show a phantom emoji on a 'free'
    -- tile or a phantom "Needs" row. This matches the per-tile hasCall, which already only
    -- counts calls on the open session, AND the old client guard
    -- (callsForTable: if sessions on && no open session → []). Closing a table does NOT
    -- resolve its waiter_calls (lib/sessionClose), so this guard is load-bearing.
    'calls', COALESCE((SELECT json_agg(json_build_object(
                'id', c.id, 'table_number', c.table_number, 'note', c.note,
                'created_at', c.created_at, 'resolved', c.resolved) ORDER BY c.created_at DESC)
               FROM waiter_calls c
              WHERE c.restaurant_id = v_rid AND NOT c.resolved
                -- when sessions are ON, only calls on an OPEN session count (a stale call on a
                -- closed/freed table is ignored); when OFF, calls show regardless. Mirrors the
                -- old client callsForTable guard exactly.
                AND (NOT v_sessions_on
                     OR EXISTS (SELECT 1 FROM sessions s2
                                 WHERE s2.id = c.session_id AND s2.status = 'open'
                                   AND s2.restaurant_id = v_rid))), '[]'::json),
    'requests', COALESCE((SELECT json_agg(json_build_object(
                'id', r.id, 'table_number', r.table_number, 'type', r.type,
                'name', r.name, 'phone', r.phone, 'created_at', r.created_at) ORDER BY r.created_at)
               FROM requests r
              WHERE r.restaurant_id = v_rid AND r.status = 'pending'), '[]'::json),
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
END; $$;

-- Small INR helper for the tile meta string, mirroring the panel's inr() (₹ + thousands
-- separators, no decimals). Kept tiny + IMMUTABLE so the summary can format "₹1,234 due"
-- server-side exactly as the tile did client-side.
CREATE OR REPLACE FUNCTION lfh_inr(n numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT '₹' || to_char(round(COALESCE(n,0)), 'FM999,999,999,990');
$$;

-- Drop any earlier 1-arg version (an earlier apply of this file created lfh_table_view_summary(uuid))
-- so only the 2-arg (uuid, text) signature remains and there's no ambiguous overload.
DROP FUNCTION IF EXISTS lfh_table_view_summary(uuid);

-- Lock down: service-role only (the editor endpoint calls it via supabaseAdmin).
REVOKE EXECUTE ON FUNCTION lfh_table_view_summary(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_table_view_summary(uuid, text) TO service_role;
-- Same lock-down for the helper (rule: every new function REVOKEs from public; harmless
-- pure formatter, but kept consistent — no function ships PUBLIC-executable by default).
REVOKE EXECUTE ON FUNCTION lfh_inr(numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_inr(numeric) TO service_role;

NOTIFY pgrst, 'reload schema';
