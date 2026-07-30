-- 233_floor_summary_qty_cast_guard.sql — the SIBLING of mig 229: a malformed QTY can't
-- take down the floor view either.
--
-- THE BUG (found in the inventory full-wire sweep, 2026-07-30): mig 229 hardened this
-- function so a non-array `items` can't kill the whole Table view. But one line below the
-- guard it added, the same function still did
--     GREATEST(COALESCE(NULLIF(el->>'qty','')::int, 1), 0)
-- an UNGUARDED cast — while the table-number cast six lines above it IS regex-guarded
--     ORDER BY CASE WHEN t ~ '^[0-9]+$' THEN t::int ELSE 2147483647 END
-- So a single order line whose `qty` is not a plain integer ("x", "2.5", "two") raises
-- 22P02 "invalid input syntax for type integer" and the ENTIRE call fails. That call is
-- TIER 1 of the Table view, so one bad row anywhere blanks the whole floor grid for every
-- manager and waiter with a 500 they can do nothing about — the owner's "most important
-- screen", dead. Proven on the dev DB: I created one such row while testing junk order
-- shapes and Green Bowl's floor 500'd until the row was removed; the other restaurants
-- were unaffected, which is exactly how it would present in production (one restaurant
-- mysteriously dead).
--
-- THE FIX: cast only when the value really IS an integer; anything else counts as 1, which
-- is precisely what the existing COALESCE(..., 1) already means for a MISSING qty. Same
-- shape as the guard already used for the table number in this function, and the same
-- "make the READ side unwilling to fall over" reasoning as mig 229.
--
-- The write paths do validate (lfh_staff_place_order, mig 029/203), so today's rows are
-- clean — this is hardening a fragile read, not chasing current data. What can still reach
-- it: a replayed offline write, an aggregator/integration payload, a restore, or a future
-- code path that forgets to coerce.
--
-- The body below is mig 229's body (which IS the live definition — 230 only added an index
-- and does not redefine this function) with that ONE cast patched. Not a copy of an older
-- migration file: copying a stale copy is how a fix got silently reverted here before.

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
  v_rate        numeric;   -- (H9) effective tax rate, so due applies discount BEFORE tax
  v_t           text;
  v_sess        sessions;
  v_members     int;
  v_pending     int;
  v_calls       int;
  v_nw int; v_ck int; v_rd int; v_sv int;
  v_has_orders boolean;
  v_unpaid     boolean;
  v_paid_any   boolean;
  v_due        numeric;
  v_reqs       int;
  v_state      text;
  v_label      text;
  v_meta       text;
  v_tag        text;   -- TAG: this table's mark (vip/family/guest) or NULL
  v_tiles      jsonb := '{}'::jsonb;
  v_order_count int;
  v_latest_tbl  text;
BEGIN
  SELECT sessions_enabled, COALESCE(table_count, 0)
    INTO v_sessions_on, v_table_count
    FROM settings WHERE restaurant_id = v_rid;
  v_sessions_on := COALESCE(v_sessions_on, false);
  v_rate := lfh_effective_tax_rate(v_rid);   -- (H9) per-restaurant rate, matches billMath

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
    SELECT * INTO v_sess
      FROM sessions
      WHERE table_number = v_t AND status = 'open' AND restaurant_id = v_rid
      ORDER BY last_activity_at DESC
      LIMIT 1;

    v_members := 0; v_pending := 0;
    IF v_sess.id IS NOT NULL THEN
      SELECT count(*) FILTER (WHERE NOT removed),
             count(*) FILTER (WHERE NOT removed AND NOT approved)
        INTO v_members, v_pending
        FROM session_members WHERE session_id = v_sess.id;
    END IF;

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
    -- one row per dish LINE carrying its status + QTY, from order_items when the order has any,
    -- else the orders.items JSON (mirrors orderItemRows()). Counting SUM(qty) — not row count —
    -- is the fix (restored from mig 105): a single "2× Cappuccino" line is 2 cooking, not 1.
    lines AS (
      SELECT LOWER(COALESCE(oi.status, 'received')) AS st,
             GREATEST(COALESCE(oi.qty, 1), 0)        AS qty
        FROM belong b
        JOIN order_items oi ON oi.order_id = b.id
      UNION ALL
      SELECT LOWER(COALESCE(el->>'status', 'received')) AS st,
             GREATEST(COALESCE(CASE WHEN el->>'qty' ~ '^-?[0-9]+$' THEN (el->>'qty')::int END, 1), 0) AS qty
        FROM belong b
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.items) = 'array' THEN b.items ELSE '[]'::jsonb END) el
       WHERE NOT EXISTS (SELECT 1 FROM order_items oi2 WHERE oi2.order_id = b.id)
    )
    SELECT
      (SELECT count(*) > 0 FROM belong),
      COALESCE((SELECT SUM(qty) FILTER (WHERE st = 'received')  FROM lines), 0),
      COALESCE((SELECT SUM(qty) FILTER (WHERE st = 'preparing') FROM lines), 0),
      COALESCE((SELECT SUM(qty) FILTER (WHERE st = 'ready')     FROM lines), 0),
      COALESCE((SELECT SUM(qty) FILTER (WHERE st = 'served')    FROM lines), 0),
      COALESCE((SELECT bool_or(status NOT IN ('received','cancelled') AND payment_status <> 'paid') FROM belong), false),
      COALESCE((SELECT bool_or(status NOT IN ('received','cancelled') AND payment_status =  'paid') FROM belong), false),
      -- (H9) discount BEFORE tax: (total − discount×(1+rate)) == (subtotal − discount)×(1+rate)
      COALESCE((SELECT SUM(total - discount * (1 + v_rate)) FILTER (WHERE status NOT IN ('received','cancelled') AND payment_status <> 'paid') FROM belong), 0)
      INTO v_has_orders, v_nw, v_ck, v_rd, v_sv, v_unpaid, v_paid_any, v_due;

    v_calls := 0;
    IF v_sess.id IS NOT NULL THEN
      SELECT count(*) INTO v_calls
        FROM waiter_calls WHERE session_id = v_sess.id AND NOT resolved;
    END IF;

    SELECT count(*) INTO v_reqs
      FROM requests r
      WHERE r.restaurant_id = v_rid AND r.status = 'pending' AND r.table_number = v_t
        AND NOT (r.type = 'open' AND v_sess.id IS NOT NULL);

    -- TAG: this table's special mark, if any.
    SELECT tag INTO v_tag
      FROM table_tags WHERE restaurant_id = v_rid AND table_number = v_t;

    IF v_has_orders THEN
      IF    v_nw > 0 THEN v_state := 'new';   v_label := 'New order';
      ELSIF v_rd > 0 THEN v_state := 'ready'; v_label := 'Ready to serve';
      ELSIF v_ck > 0 THEN v_state := 'prep';  v_label := 'Preparing';
      ELSIF v_unpaid THEN v_state := 'bill';  v_label := 'Served';
      ELSE                v_state := 'done';  v_label := 'Cleared';
      END IF;
      IF (v_nw + v_ck + v_rd + v_sv) > 0 THEN
        v_meta := v_sv || '/' || (v_nw + v_ck + v_rd + v_sv) || ' served'
                  || CASE WHEN v_due > 0 THEN ' · ' || lfh_inr(v_due) || ' due' ELSE '' END;
      ELSE
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
      'tag',     COALESCE(v_tag, ''),   -- TAG: '' when unmarked
      'hasNew',  v_nw > 0,
      'hasCall', v_calls > 0,
      'hasReq',  v_reqs > 0,
      'hasJoin', v_pending > 0,
      'reqs',    v_reqs,
      'calls',   v_calls
    ));
  END LOOP;

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
END; $function$;

NOTIFY pgrst, 'reload schema';
