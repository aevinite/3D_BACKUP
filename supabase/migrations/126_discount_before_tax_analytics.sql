-- 126_discount_before_tax_analytics.sql
--
-- BUG (2026-07-05, full-app calc audit): the owner analytics + admin floor + guest
-- live-bill RPCs computed money as `total - discount`, which OVERSTATES every
-- discounted paid bill by `discount × tax_rate`. Stored `orders.total` bakes tax onto
-- the PRE-discount subtotal (total = subtotal×(1+rate)) and `discount` is stored
-- separately, so `total - discount` leaves tax charged on the discounted portion.
-- The source of truth everywhere else — billMath() (editor app.js), the Z-report, the
-- printed bill, and lfh_table_view_summary (migration 122) — applies the discount
-- BEFORE tax:  net = (subtotal - discount) × (1+rate) = total - discount×(1+rate).
--
-- This migration brings every remaining money RPC onto that one rule, so the owner
-- dashboard/reports, the admin floor "due", and the guest's live table total all agree
-- with the printed/paid bill to the rupee. Rate is the per-restaurant effective rate
-- (lfh_effective_tax_rate, migration 119) — never a hardcoded 5%. Paid-only / cancelled
-- filters are unchanged. Pure CREATE OR REPLACE (additive, reversible, no data change);
-- ACLs are preserved across replace.
--
-- Also fixes the owner GST/tax report: collected tax = (subtotal-discount)×rate =
-- (total-subtotal) - discount×rate, so a discounted bill no longer over-reports tax.

-- ── 1. lfh_owner_overview: revenue_today / revenue_all (discount before tax) ──
CREATE OR REPLACE FUNCTION lfh_owner_overview()
RETURNS TABLE (
  restaurant_id    uuid,
  slug             text,
  name             text,
  active           boolean,
  accent_color     text,
  orders_today     bigint,
  revenue_today    numeric,
  orders_all       bigint,
  revenue_all      numeric,
  open_tables      bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH
  day_start AS (
    SELECT (((now() AT TIME ZONE 'Asia/Kolkata') - interval '5 hours')::date
            + interval '5 hours') AT TIME ZONE 'Asia/Kolkata' AS ts
  ),
  ord AS (
    SELECT
      o.restaurant_id,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled'
                         AND o.created_at >= (SELECT ts FROM day_start))                          AS orders_today,
      COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id)))
        FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
                  AND o.created_at >= (SELECT ts FROM day_start)), 0)                              AS revenue_today,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled')                                              AS orders_all,
      COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id)))
        FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)                   AS revenue_all
    FROM orders o
    GROUP BY o.restaurant_id
  ),
  sess AS (
    SELECT s.restaurant_id, COUNT(*) AS open_tables
    FROM sessions s
    WHERE s.status = 'open'
    GROUP BY s.restaurant_id
  )
  SELECT
    r.id, r.slug, r.name, r.active, r.accent_color,
    COALESCE(ord.orders_today, 0)::bigint,
    COALESCE(ord.revenue_today, 0)::numeric,
    COALESCE(ord.orders_all, 0)::bigint,
    COALESCE(ord.revenue_all, 0)::numeric,
    COALESCE(sess.open_tables, 0)::bigint
  FROM restaurants r
  LEFT JOIN ord  ON ord.restaurant_id  = r.id
  LEFT JOIN sess ON sess.restaurant_id = r.id
  ORDER BY r.name;
$$;

-- ── 2. lfh_owner_restaurant_revenue ──
CREATE OR REPLACE FUNCTION lfh_owner_restaurant_revenue(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (restaurant_id uuid, slug text, name text, accent_color text, revenue numeric, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.slug, r.name, r.accent_color,
         COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id))) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(o.id) FILTER (WHERE o.status <> 'cancelled')::bigint
  FROM restaurants r
  LEFT JOIN orders o ON o.restaurant_id = r.id AND o.created_at >= p_from AND o.created_at < p_to
  GROUP BY r.id, r.slug, r.name, r.accent_color
  ORDER BY 5 DESC;
$$;

-- ── 3. lfh_owner_revenue_timeseries ──
CREATE OR REPLACE FUNCTION lfh_owner_revenue_timeseries(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz, p_bucket text)
RETURNS TABLE (bucket timestamptz, restaurant_id uuid, revenue numeric, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT date_trunc(COALESCE(NULLIF(p_bucket, ''), 'day'),
                    o.created_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
         o.restaurant_id,
         COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id))) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint
  FROM orders o
  WHERE o.created_at >= p_from AND o.created_at < p_to
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
  GROUP BY 1, 2
  ORDER BY 1;
$$;

-- ── 4. lfh_owner_hourly ──
CREATE OR REPLACE FUNCTION lfh_owner_hourly(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (hour int, orders bigint, revenue numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXTRACT(hour FROM o.created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint,
         COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id))) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric
  FROM orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.created_at >= p_from AND o.created_at < p_to
  GROUP BY 1
  ORDER BY 1;
$$;

-- ── 5. lfh_owner_payment_breakdown ──
CREATE OR REPLACE FUNCTION lfh_owner_payment_breakdown(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (method text, revenue numeric, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(o.payment_method, ''), 'Not recorded') AS method,
         COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id))), 0)::numeric AS revenue,
         COUNT(*)::bigint AS orders
  FROM orders o
  WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
    AND o.created_at >= p_from AND o.created_at < p_to
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

-- ── 6. lfh_owner_sales_report: revenue (discount before tax) + tax net of discount ──
-- tax collected = (subtotal-discount)×rate = (total-subtotal) - discount×rate, so the
-- GST report no longer over-reports tax on discounted bills. subtotal/discount columns
-- and cancelled_value are unchanged.
CREATE OR REPLACE FUNCTION lfh_owner_sales_report(
  p_restaurant_id uuid,
  p_from timestamptz,
  p_to   timestamptz,
  p_bucket text
)
RETURNS TABLE (
  bucket           timestamptz,
  orders           bigint,
  paid_orders      bigint,
  subtotal         numeric,
  tax              numeric,
  discount         numeric,
  revenue          numeric,
  cancelled_orders bigint,
  cancelled_value  numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT date_trunc(COALESCE(NULLIF(p_bucket, ''), 'day'),
                    o.created_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid')::bigint,
         COALESCE(SUM(o.subtotal) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COALESCE(SUM(o.total - o.subtotal - o.discount * lfh_effective_tax_rate(o.restaurant_id)) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id))) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(*) FILTER (WHERE o.status = 'cancelled')::bigint,
         COALESCE(SUM(o.total - o.discount) FILTER (WHERE o.status = 'cancelled'), 0)::numeric
  FROM orders o
  WHERE o.created_at >= p_from AND o.created_at < p_to
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
  GROUP BY 1
  ORDER BY 1;
$$;

-- ── 7. lfh_session_state: guest live table bill (discount before tax + a discount field) ──
CREATE OR REPLACE FUNCTION lfh_session_state(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_s sessions; v_removed session_members;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN
    SELECT * INTO v_removed FROM session_members WHERE token = p_token AND removed;
    IF FOUND THEN
      IF EXISTS (SELECT 1 FROM sessions WHERE id = v_removed.session_id AND status = 'closed') THEN
        RETURN json_build_object('ok', false, 'reason', 'session_closed');
      END IF;
      RETURN json_build_object('ok', false, 'reason', 'removed');
    END IF;
    RETURN json_build_object('ok', false, 'reason', 'invalid_token');
  END IF;
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id;
  RETURN json_build_object(
    'ok', true,
    'session', json_build_object('id', v_s.id, 'table_number', v_s.table_number, 'status', v_s.status, 'auto_approve', v_s.auto_approve),
    'member',  json_build_object('id', v_m.id, 'role', v_m.role, 'approved', v_m.approved, 'phone_verified', v_m.phone_verified, 'name', v_m.name),
    'members', COALESCE((SELECT json_agg(json_build_object('id', id, 'name', name, 'role', role, 'approved', approved, 'phone_verified', phone_verified) ORDER BY joined_at)
                          FROM session_members WHERE session_id = v_s.id AND NOT removed), '[]'::json),
    'pending', COALESCE((SELECT json_agg(json_build_object('id', id, 'name', name) ORDER BY joined_at)
                          FROM session_members WHERE session_id = v_s.id AND NOT approved AND NOT removed), '[]'::json),
    'items',   CASE WHEN v_m.approved
                 THEN COALESCE((SELECT json_agg(json_build_object('id', id, 'title', title, 'qty', qty, 'status', status,
                                                                  'options', options, 'removed', removed, 'note', note) ORDER BY created_at)
                                FROM order_items WHERE session_id = v_s.id), '[]'::json)
                 ELSE '[]'::json END,
    'orders',  CASE WHEN v_m.approved
                 THEN COALESCE((SELECT json_agg(json_build_object('id', id, 'status', status, 'total', total, 'items', items, 'created_at', created_at) ORDER BY created_at)
                                FROM orders WHERE session_id = v_s.id AND status <> 'cancelled'), '[]'::json)
                 ELSE '[]'::json END,
    -- (2026-07-05) discount-before-tax so the guest's live table total equals the
    -- printed/paid bill. taxable = Σsubtotal − Σdiscount; tax on taxable; total on top.
    -- Now also carries a 'discount' field so the guest UI can show the reduction line.
    'bill',    CASE WHEN v_m.approved
                 THEN (SELECT json_build_object(
                         'subtotal', COALESCE(SUM(subtotal), 0),
                         'discount', COALESCE(SUM(discount), 0),
                         'tax',   round(GREATEST(COALESCE(SUM(subtotal), 0) - COALESCE(SUM(discount), 0), 0) * lfh_effective_tax_rate(v_s.restaurant_id), 2),
                         'total', round(GREATEST(COALESCE(SUM(subtotal), 0) - COALESCE(SUM(discount), 0), 0) * (1 + lfh_effective_tax_rate(v_s.restaurant_id)), 2))
                       FROM orders WHERE session_id = v_s.id AND status <> 'cancelled')
                 ELSE json_build_object('subtotal', 0, 'discount', 0, 'tax', 0, 'total', 0) END,
    'calls',   COALESCE((SELECT json_agg(json_build_object('id', id, 'note', note, 'status', CASE WHEN resolved THEN 'attended' ELSE 'open' END) ORDER BY created_at DESC)
                          FROM waiter_calls WHERE session_id = v_s.id AND NOT resolved), '[]'::json));
END; $$;

GRANT EXECUTE ON FUNCTION lfh_session_state(text) TO anon;

-- ── 8. lfh_floor_state (admin floor "due") is appended below by the generator, pulled
--       live from the DB and transformed (SUM(total - discount) → discount-before-tax)
--       to avoid hand-transcribing its ~250 lines. ──

-- ── 8. lfh_floor_state (admin floor "due") — pulled live + discount-before-tax ──
CREATE OR REPLACE FUNCTION public.lfh_floor_state(p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      COALESCE(SUM(total - discount * (1 + lfh_effective_tax_rate(v_rid))) FILTER (WHERE status NOT IN ('received','cancelled') AND payment_status <> 'paid'), 0),
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
END; $function$
;

NOTIFY pgrst, 'reload schema';
