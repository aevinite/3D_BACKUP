-- 122_table_summary_due_discount_before_tax.sql
-- BUG H9 (2026-07-05): the manager floor-tile "due" (and the streaming detail due, which
-- reads this summary before the full slice loads) OVERSTATED a discounted table's bill by
-- discount × tax_rate versus the printed bill / pay screen / Z-report.
--
-- WHY: lfh_table_view_summary computed due = Σ(total − discount). The stored `orders.total`
-- already baked tax onto the PRE-discount subtotal (total = subtotal × (1+rate)), but the
-- client's billMath() — the source of truth for the printed bill, pay screen and Z-report —
-- applies the discount BEFORE tax: taxable = subtotal − discount; total = taxable × (1+rate).
-- So (total − discount) overstates by discount × rate (e.g. ₹200 discount at 5% → ₹10 too
-- high). On an unpaid discounted table the tile showed the high number, then it visibly
-- JUMPED down when the full slice arrived and billMath recomputed.
--
-- FIX: due = Σ(total − discount × (1 + rate)) = Σ((subtotal − discount) × (1 + rate)),
-- which is exactly billMath's rule. rate comes from lfh_effective_tax_rate() (mig 119) — the
-- ONE source of truth every other money surface already uses (never a hardcoded 5%). This is
-- the ONLY behavioural change; the rest of the function is byte-identical to migration 101.

CREATE OR REPLACE FUNCTION lfh_table_view_summary(
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001',
  p_table text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
END; $$;

REVOKE EXECUTE ON FUNCTION lfh_table_view_summary(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_table_view_summary(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
