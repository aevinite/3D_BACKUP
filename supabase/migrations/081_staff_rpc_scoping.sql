-- 081_staff_rpc_scoping.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Phase 1b (staff slice): scope the STAFF-facing RPCs by restaurant, so a
-- restaurant's staff only ever see / act on their OWN tables. The guest RPCs
-- are scoped in a LATER migration — they are deliberately untouched here.
--
-- restaurant_id was added to every tenant table in 078 (NOT NULL, default #1),
-- so these scoped reads/writes stay byte-for-byte correct for the existing
-- single-restaurant ("My Little French House") data: every caller that omits
-- the new arg gets #1, exactly the rows it saw before.
--
-- Four functions, the LATEST live definition of each reproduced verbatim with
-- ONLY restaurant scoping added (SECURITY DEFINER, SET search_path = public,
-- return types and all other behaviour unchanged):
--   1. lfh_floor_state()       — last defined in 041   → gains p_restaurant_id
--   2. lfh_kitchen_tickets()   — last defined in 041   → gains p_restaurant_id
--   3. lfh_staff_place_order() — last defined in 049   → gains p_restaurant_id
--   4. lfh_staff_shift_table() — last defined in 061   → derives it from session
--
-- The first three add a param → their signature CHANGES → DROP the old exact
-- signature, CREATE the new one, then re-apply the staff-only grants (the
-- migration-038 pattern). lfh_staff_shift_table keeps its (uuid, text)
-- signature, so a plain CREATE OR REPLACE preserves its existing grants.
--
-- DEFENSIVE: every restaurant_id that could in theory be NULL is COALESCEd to
-- restaurant #1 ('00000000-0000-0000-0000-000000000001').
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1) lfh_floor_state(p_restaurant_id) — authoritative status of every table ─
--    Signature changes (gains a param) → drop the old no-arg version first.
DROP FUNCTION IF EXISTS lfh_floor_state();
CREATE OR REPLACE FUNCTION lfh_floor_state(
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid         uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
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
  -- One settings row per restaurant now (079); read THIS restaurant's row.
  SELECT sessions_enabled, COALESCE(table_count, 0)
    INTO v_sessions_on, v_table_count
    FROM settings WHERE restaurant_id = v_rid;

  -- The universe of tables to report: 1..table_count, PLUS any table that has an
  -- open session or a live (non-archived, non-cancelled) order — so walk-ins or
  -- parties shifted above the configured count are never dropped. Scoped to this
  -- restaurant so another restaurant's "table 1" is never folded in.
  FOR v_t IN
    -- UNION (not UNION ALL) already de-duplicates the table numbers, so no DISTINCT
    -- is needed — and DISTINCT would forbid ordering by the numeric CASE below.
    SELECT t FROM (
      SELECT generate_series(1, GREATEST(v_table_count, 0))::text AS t
      UNION SELECT table_number FROM sessions
              WHERE status = 'open' AND table_number IS NOT NULL
                AND restaurant_id = v_rid
      UNION SELECT table_number FROM orders
              WHERE NOT archived AND status <> 'cancelled' AND table_number IS NOT NULL
                AND restaurant_id = v_rid
    ) u
    ORDER BY CASE WHEN t ~ '^[0-9]+$' THEN t::int ELSE 2147483647 END, t
  LOOP
    -- The table's OPEN session (if any) — the most recently active one.
    SELECT * INTO v_sess
      FROM sessions
      WHERE table_number = v_t AND status = 'open'
        AND restaurant_id = v_rid
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
        AND o.restaurant_id = v_rid
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

-- ── 2) lfh_kitchen_tickets(p_restaurant_id) — kitchen's slice of the same truth ─
-- Live cooking tickets: not archived, still received/preparing/served. Per-item
-- statuses come from order_items when present, else the order's items JSON.
-- Signature changes (gains a param) → drop the old no-arg version first.
DROP FUNCTION IF EXISTS lfh_kitchen_tickets();
CREATE OR REPLACE FUNCTION lfh_kitchen_tickets(
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
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
  WHERE NOT o.archived AND o.status IN ('received','preparing','served')
    AND o.restaurant_id = COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
$$;

-- ── 3) lfh_staff_place_order(..., p_restaurant_id) — waiter-tablet order entry ─
-- Placing an order auto-opens the table's session (bill-on-first-order) when one
-- isn't already open, so every order is attached to a session and shows
-- consistently everywhere. Idempotent: an existing open session is reused.
-- Now scoped per restaurant: the open-session lookup is for THIS restaurant, and
-- restaurant_id is stamped on the session / order / order_items rows it inserts.
-- Signature changes (gains a trailing param) → drop the old 4-arg version first.
DROP FUNCTION IF EXISTS lfh_staff_place_order(text, jsonb, text[], text);
CREATE OR REPLACE FUNCTION lfh_staff_place_order(
  p_table text, p_items jsonb, p_allergies text[], p_note text,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid   uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_s     sessions; v_order uuid; v_kot int; v_item jsonb; v_priced jsonb;
BEGIN
  -- Same money math as guest orders: priced by the server, sold-out rejected.
  v_priced := lfh_price_order(p_items);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;

  -- The table's open session FOR THIS RESTAURANT, or OPEN ONE NOW so the order is
  -- never an orphan. (Another restaurant's open "table 1" must never be reused.)
  SELECT * INTO v_s FROM sessions
    WHERE table_number = p_table AND status = 'open' AND restaurant_id = v_rid
    ORDER BY last_activity_at DESC LIMIT 1;
  IF v_s.id IS NULL THEN
    INSERT INTO sessions(table_number, status, opened_by, opened_at, restaurant_id)
      VALUES (p_table, 'open', 'waiter', NOW(), v_rid)
      RETURNING * INTO v_s;
  END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id, member_id, restaurant_id)
    VALUES (p_table, v_priced->'items',
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), 'received', v_s.id, NULL, v_rid)
    RETURNING id, kot_no INTO v_order, v_kot;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_priced->'items') LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note, restaurant_id)
      VALUES (v_order, v_s.id,
        COALESCE(v_item->>'title', ''),
        COALESCE((v_item->>'qty')::int, 1),
        COALESCE((v_item->>'price')::numeric, 0),
        v_item->'options',
        CASE WHEN jsonb_typeof(v_item->'removed') = 'array'
             THEN COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(v_item->'removed') x), '{}')
             ELSE '{}' END,
        COALESCE(v_item->>'note', p_note),
        v_rid);
  END LOOP;

  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'order_id', v_order, 'kot_no', v_kot);
END; $$;

-- ── 4) lfh_staff_shift_table(p_session, p_to) — move a party to another table ──
-- Signature UNCHANGED → CREATE OR REPLACE preserves its existing grants. The
-- restaurant is DERIVED from the session row; the destination-occupancy check and
-- the realtime breadcrumbs are scoped to that same restaurant.
CREATE OR REPLACE FUNCTION lfh_staff_shift_table(p_session uuid, p_to text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s sessions; v_from text; v_rid uuid;
BEGIN
  SELECT * INTO v_s FROM sessions WHERE id = p_session;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_session'); END IF;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF p_to !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'reason', 'bad_table'); END IF;
  IF p_to = v_s.table_number THEN RETURN json_build_object('ok', false, 'reason', 'same_table'); END IF;
  -- Operate strictly within the session's own restaurant.
  v_rid := COALESCE(v_s.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  -- The destination must be empty WITHIN THIS RESTAURANT: no open session may
  -- already live there (another restaurant's open "table N" is irrelevant).
  IF EXISTS (SELECT 1 FROM sessions WHERE table_number = p_to AND status = 'open' AND restaurant_id = v_rid) THEN
    RETURN json_build_object('ok', false, 'reason', 'target_occupied');
  END IF;
  v_from := v_s.table_number;
  UPDATE sessions     SET table_number = p_to, last_activity_at = NOW() WHERE id = p_session;
  UPDATE orders       SET table_number = p_to WHERE session_id = p_session;
  UPDATE waiter_calls SET table_number = p_to WHERE session_id = p_session AND NOT resolved;
  -- Nudge BOTH table topics (+ ops) so guests at the OLD table refetch immediately
  -- (the moves above only reach the NEW table), and every staff panel updates too.
  -- Stamp the breadcrumb rows with the session's restaurant.
  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id) VALUES
    ('table:' || v_from, 'session', p_session::text, v_from, v_rid),
    ('table:' || p_to,   'session', p_session::text, p_to,   v_rid),
    ('ops',              'session', p_session::text, p_to,   v_rid);
  RETURN json_build_object('ok', true, 'from', v_from, 'to', p_to);
END; $$;

-- ── lock down: staff-only (new functions are PUBLIC-executable by default) ─────
-- (matches the migration-038 pattern). The three that gained a param need their
-- grants re-applied against the NEW signature; lfh_staff_shift_table kept its
-- (uuid, text) signature so CREATE OR REPLACE above retained its grants.
REVOKE EXECUTE ON FUNCTION lfh_floor_state(uuid)     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_floor_state(uuid)     TO service_role;
REVOKE EXECUTE ON FUNCTION lfh_kitchen_tickets(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_kitchen_tickets(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION lfh_staff_place_order(text, jsonb, text[], text, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_staff_place_order(text, jsonb, text[], text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
