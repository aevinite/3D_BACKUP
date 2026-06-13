-- 041_floor_state_brain.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- THE "BRAIN": one source of truth for the live floor.
--
-- Problem this fixes: today every staff screen (editor / kitchen / tablet) works
-- out "is this table busy or free?" on its own, from raw rows, with slightly
-- different rules — and some only look at TODAY's orders while sessions have no
-- date limit. So they disagree (e.g. an open table from last night with an
-- unpaid bill shows busy on one screen, free on another).
--
-- Fix: ONE function, lfh_floor_state(), computes each table's status once. Every
-- staff screen just renders what it returns — nobody recomputes. Plus a small
-- companion, lfh_kitchen_tickets(), giving the kitchen its slice of the SAME
-- truth. Both are service-role only (staff servers call them with the service
-- key); the guest menu keeps its own lfh_table_status (it only needs open/closed
-- for its own table).
--
-- KEY RULE that kills the overnight-table bug: an OPEN table always carries its
-- unpaid orders, matched by the open session's id — NEVER clipped to "today".
-- ─────────────────────────────────────────────────────────────────────────────

-- ── lfh_floor_state() — authoritative status of every table ──────────────────
CREATE OR REPLACE FUNCTION lfh_floor_state()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sessions_on boolean;
  v_table_count int;
  v_t           text;
  v_sess        sessions;
  v_members     int;
  v_pending     int;
  v_has_orders  boolean;
  v_has_new     boolean;
  v_has_prep    boolean;
  v_unpaid      boolean;
  v_paid_any    boolean;
  v_due         numeric;
  v_orders      json;
  v_calls       int;
  v_state       text;
  v_arr         json[] := '{}';
BEGIN
  SELECT sessions_enabled, COALESCE(table_count, 0)
    INTO v_sessions_on, v_table_count
    FROM settings WHERE id = 'site';

  -- The universe of tables to report: 1..table_count, PLUS any table that has an
  -- open session or a live (non-archived, non-cancelled) order — so walk-ins or
  -- parties shifted above the configured count are never dropped.
  FOR v_t IN
    -- UNION (not UNION ALL) already de-duplicates the table numbers, so no DISTINCT
    -- is needed — and DISTINCT would forbid ordering by the numeric CASE below.
    SELECT t FROM (
      SELECT generate_series(1, GREATEST(v_table_count, 0))::text AS t
      UNION SELECT table_number FROM sessions
              WHERE status = 'open' AND table_number IS NOT NULL
      UNION SELECT table_number FROM orders
              WHERE NOT archived AND status <> 'cancelled' AND table_number IS NOT NULL
    ) u
    ORDER BY CASE WHEN t ~ '^[0-9]+$' THEN t::int ELSE 2147483647 END, t
  LOOP
    -- The table's OPEN session (if any) — the most recently active one.
    SELECT * INTO v_sess
      FROM sessions
      WHERE table_number = v_t AND status = 'open'
      ORDER BY last_activity_at DESC
      LIMIT 1;

    -- Seated headcount + how many joiners are still awaiting approval.
    v_members := 0; v_pending := 0;
    IF v_sess.id IS NOT NULL THEN
      SELECT count(*) FILTER (WHERE NOT removed),
             count(*) FILTER (WHERE NOT removed AND NOT approved)
        INTO v_members, v_pending
        FROM session_members WHERE session_id = v_sess.id;
    END IF;

    -- Orders that BELONG to this table, by the canonical rule:
    --   • if there's an open session → its non-archived, non-cancelled orders
    --     (matched by session id, so date never matters);
    --   • else if sessions are OFF → the table's non-archived, non-cancelled orders;
    --   • else (sessions ON, no open session) → none (stale leftovers ignored → Free).
    WITH belong AS (
      SELECT o.* FROM orders o
      WHERE o.status <> 'cancelled' AND NOT o.archived
        AND (
              (v_sess.id IS NOT NULL AND o.session_id = v_sess.id)
           OR (NOT v_sessions_on AND v_sess.id IS NULL AND o.table_number = v_t)
        )
    )
    SELECT
      count(*) > 0,
      COALESCE(bool_or(status = 'received'), false),
      COALESCE(bool_or(status = 'preparing'), false),
      COALESCE(bool_or(status NOT IN ('received','cancelled') AND payment_status <> 'paid'), false),
      COALESCE(bool_or(status NOT IN ('received','cancelled') AND payment_status =  'paid'), false),
      COALESCE(SUM(total - discount) FILTER (WHERE status NOT IN ('received','cancelled') AND payment_status <> 'paid'), 0),
      COALESCE(json_agg(json_build_object(
        'id', id, 'status', status, 'payment_status', payment_status,
        'total', total, 'discount', discount, 'kot_no', kot_no, 'created_at', created_at
      ) ORDER BY created_at), '[]'::json)
      INTO v_has_orders, v_has_new, v_has_prep, v_unpaid, v_paid_any, v_due, v_orders
      FROM belong;

    -- Waiter calls only count while the table is actually open (no lingering badges).
    v_calls := 0;
    IF v_sess.id IS NOT NULL THEN
      SELECT count(*) INTO v_calls
        FROM waiter_calls WHERE session_id = v_sess.id AND NOT resolved;
    END IF;

    -- The ONE definition of a tile's state.
    IF v_has_orders THEN
      IF    v_has_new  THEN v_state := 'new';
      ELSIF v_has_prep THEN v_state := 'preparing';
      ELSIF v_unpaid   THEN v_state := 'served';
      ELSE                  v_state := 'cleared';
      END IF;
    ELSIF v_sess.id IS NOT NULL THEN
      v_state := 'seated';
    ELSE
      v_state := 'free';
    END IF;

    v_arr := array_append(v_arr, json_build_object(
      'table_number',     v_t,
      'state',            v_state,
      'open',             v_sess.id IS NOT NULL,
      'session_id',       v_sess.id,
      'members',          v_members,
      'pending_members',  v_pending,
      'has_new',          v_has_new,
      'has_call',         v_calls > 0,
      'due',              round(v_due, 2),
      'pay',              CASE WHEN v_unpaid THEN 'red' WHEN v_paid_any THEN 'green' ELSE '' END,
      'orders',           v_orders,
      'last_activity_at', v_sess.last_activity_at
    ));
  END LOOP;

  RETURN array_to_json(v_arr);
END; $$;

-- ── lfh_kitchen_tickets() — the kitchen's slice of the same truth ─────────────
-- Live cooking tickets: not archived, still received/preparing/served. Per-item
-- statuses come from order_items when present, else the order's items JSON.
CREATE OR REPLACE FUNCTION lfh_kitchen_tickets()
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(json_build_object(
    'order_id',     o.id,
    'kot_no',       o.kot_no,
    'table_number', o.table_number,
    'status',       o.status,
    'created_at',   o.created_at,
    'items', COALESCE(
      (SELECT json_agg(json_build_object(
                'title', oi.title, 'qty', oi.qty, 'status', oi.status,
                'note', oi.note, 'removed', oi.removed) ORDER BY oi.created_at)
         FROM order_items oi WHERE oi.order_id = o.id),
      o.items::json)
  ) ORDER BY o.created_at), '[]'::json)
  FROM orders o
  WHERE NOT o.archived AND o.status IN ('received','preparing','served');
$$;

-- ── lock down: staff-only (new functions are PUBLIC-executable by default) ─────
REVOKE EXECUTE ON FUNCTION lfh_floor_state()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION lfh_kitchen_tickets() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_floor_state()     TO service_role;
GRANT  EXECUTE ON FUNCTION lfh_kitchen_tickets() TO service_role;
