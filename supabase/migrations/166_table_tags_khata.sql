-- 166_table_tags_khata.sql
-- SPECIAL TABLE TYPES + PAY-LATER (KHATA) — owner feature 2026-07-22.
-- Design: docs/superpowers/specs/2026-07-22-table-tags-design.md
--
--  A. table_tags — a table can be marked vip / family / guest (NOT khata: the owner
--     chose bill-time khata, not a table mark). One row per (restaurant, table).
--     Cleared automatically when the table's session closes; moves with a table shift.
--  B. khata_customers — the "person book" for pay-later bills (name + optional phone).
--  C. orders.khata_at + orders.khata_customer_id — a settled-later bill's markers.
--  D. lfh_rt_emit gains a table_tags branch (breadcrumb carries table_number so the
--     panels' targeted refetch reloads ONLY that table — egress rule).
--  E. Read paths gain the tag: lfh_floor_state (base: 126), lfh_table_view_summary
--     (base: 136), lfh_floor_bundle (base: 100), lfh_kitchen_tickets (base: 081),
--     lfh_admin_floor_all (base: 145 — trimmed field 'g', still money-free).
--  F. lfh_staff_shift_table (base: 096) moves the tag with the party.
--
-- All recreations are based on each function's HIGHEST-numbered prior version
-- (the migration-recreate-reverts-a-fix lesson); every change is marked "-- TAG:".

-- ── A. table_tags ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS table_tags (
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_number  text NOT NULL,
  tag           text NOT NULL CHECK (tag IN ('vip','family','guest')),
  tagged_by     text,
  tagged_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, table_number)
);
-- Staff-only rows: RLS on with NO policies → anon/authenticated read nothing;
-- the panels' API routes use the service-role client (which bypasses RLS).
ALTER TABLE table_tags ENABLE ROW LEVEL SECURITY;

-- The permission ladder's columns (owner rule 2026-07-22, banquet mig-130 pattern):
--   table_tags_allowed       — ADMIN switch 1: the feature on/off (new modules default OFF).
--   table_tags_owner_control — ADMIN switch 2: POWER TRANSFER — may the OWNER toggle the
--                              feature from the owner panel (default OFF: admin-only).
--   table_tags_enabled       — the OWNER's own toggle; consulted ONLY while the admin has
--                              transferred control (defaults ON so a fresh transfer changes nothing).
--   tablet_table_tags        — MANAGER→TABLET rung for marking tables (tri-state like tablet_discount).
--   tablet_khata             — MANAGER→TABLET rung for parking pay-later bills.
-- Effective feature = allowed AND (NOT owner_control OR enabled).
ALTER TABLE settings ADD COLUMN IF NOT EXISTS table_tags_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS table_tags_owner_control boolean NOT NULL DEFAULT false;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS table_tags_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tablet_table_tags TEXT NOT NULL DEFAULT 'off'
  CHECK (tablet_table_tags IN ('off','on','pin'));
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tablet_khata TEXT NOT NULL DEFAULT 'off'
  CHECK (tablet_khata IN ('off','on','pin'));

-- ── B. khata_customers (the person book) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS khata_customers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  phone         text CHECK (phone IS NULL OR char_length(phone) <= 20),
  note          text CHECK (note IS NULL OR char_length(note) <= 200),
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- One person per phone per restaurant (when a phone is given at all).
CREATE UNIQUE INDEX IF NOT EXISTS khata_customers_phone_uq
  ON khata_customers (restaurant_id, phone) WHERE phone IS NOT NULL;
-- The picker searches by name, scoped + limited.
CREATE INDEX IF NOT EXISTS khata_customers_name_ix
  ON khata_customers (restaurant_id, name);
ALTER TABLE khata_customers ENABLE ROW LEVEL SECURITY;

-- ── C. orders khata markers ──────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS khata_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS khata_customer_id uuid REFERENCES khata_customers(id);
-- The Bills → Khata view: outstanding khata orders per person, scoped.
CREATE INDEX IF NOT EXISTS orders_khata_open_ix
  ON orders (restaurant_id, khata_customer_id)
  WHERE khata_at IS NOT NULL AND payment_status <> 'paid';

-- ── D. lfh_rt_emit — VERBATIM from 086 + the "-- TAG:" table_tags branch ─────
-- (086 is the latest full definition; 096/109 changed other functions/triggers.)
-- table_tags has NO id column (composite PK), so the generic fallback (r.id) would
-- crash — the explicit branch is required, and it carries table_number so panels
-- refetch just that one table.
CREATE OR REPLACE FUNCTION lfh_rt_emit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  k text;
  eid text;
  tn text;
  topic_name text;
  v_rid uuid;
BEGIN
  r := COALESCE(NEW, OLD);
  v_rid := COALESCE(r.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  topic_name := 'ops';  -- default for operational tables
  IF TG_TABLE_NAME = 'orders' THEN
    k := 'order'; eid := r.id::text; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'order_items' THEN
    k := 'order_item'; eid := r.order_id::text;
    SELECT o.table_number INTO tn FROM orders o WHERE o.id = r.order_id;
  ELSIF TG_TABLE_NAME = 'waiter_calls' THEN
    k := 'call'; eid := r.id::text; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'sessions' THEN
    k := 'session'; eid := r.id::text; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'requests' THEN
    k := 'request'; eid := r.id::text; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'session_members' THEN
    k := 'member'; eid := r.id::text;
    SELECT s.table_number INTO tn FROM sessions s WHERE s.id = r.session_id;
  ELSIF TG_TABLE_NAME = 'blocklist' THEN
    k := 'block'; eid := NULL; tn := NULL;             -- ops topic, staff-only
  ELSIF TG_TABLE_NAME = 'staff_actions' THEN
    k := 'action'; eid := r.id::text; tn := NULL;      -- ops topic: drives the admin activity feed
                                                       -- (login/logout/profile/user edits touch no other ops table)
  ELSIF TG_TABLE_NAME = 'table_tags' THEN
    -- TAG: mark/clear/move of a table tag; no id column → entity is the table itself.
    k := 'table_tag'; eid := NULL; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'menu_items' THEN
    k := 'menu_item'; eid := NULL; tn := NULL; topic_name := 'menu';
  ELSIF TG_TABLE_NAME = 'categories' THEN
    k := 'category'; eid := NULL; tn := NULL; topic_name := 'menu';
  ELSIF TG_TABLE_NAME = 'filters' THEN
    k := 'filter'; eid := NULL; tn := NULL; topic_name := 'menu';
  ELSIF TG_TABLE_NAME = 'settings' THEN
    k := 'settings'; eid := NULL; tn := NULL; topic_name := 'menu';
  ELSE
    k := TG_TABLE_NAME; eid := r.id::text; tn := NULL;
  END IF;

  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id)
    VALUES (topic_name, k, eid, tn, v_rid);
  IF tn IS NOT NULL THEN
    INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id)
      VALUES ('table:' || tn, k, eid, tn, v_rid);
  END IF;

  IF random() < 0.01 THEN PERFORM lfh_rt_prune(); END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS rt_emit_table_tags ON table_tags;
CREATE TRIGGER rt_emit_table_tags AFTER INSERT OR UPDATE OR DELETE ON table_tags
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

-- Auto-clear: when a table's session closes, its mark is for THAT party — remove it
-- (unless another session is still open on the same table, e.g. a re-open race).
CREATE OR REPLACE FUNCTION lfh_clear_table_tag_on_close() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status <> 'closed' AND NEW.table_number IS NOT NULL THEN
    DELETE FROM table_tags t
      WHERE t.restaurant_id = COALESCE(NEW.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid)
        AND t.table_number  = NEW.table_number
        AND NOT EXISTS (SELECT 1 FROM sessions s
                         WHERE s.restaurant_id = t.restaurant_id
                           AND s.table_number  = t.table_number
                           AND s.status = 'open' AND s.id <> NEW.id);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION lfh_clear_table_tag_on_close() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clear_table_tag_on_close ON sessions;
CREATE TRIGGER clear_table_tag_on_close AFTER UPDATE OF status ON sessions
  FOR EACH ROW EXECUTE FUNCTION lfh_clear_table_tag_on_close();

-- ── F. lfh_staff_shift_table — VERBATIM from 096 + the "-- TAG:" move ───────
CREATE OR REPLACE FUNCTION lfh_staff_shift_table(p_session uuid, p_to text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s sessions; v_from text; v_rid uuid;
BEGIN
  SELECT * INTO v_s FROM sessions WHERE id = p_session;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_session'); END IF;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF p_to !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'reason', 'bad_table'); END IF;
  IF p_to = v_s.table_number THEN RETURN json_build_object('ok', false, 'reason', 'same_table'); END IF;
  v_rid := COALESCE(v_s.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  IF EXISTS (SELECT 1 FROM sessions WHERE table_number = p_to AND status = 'open' AND restaurant_id = v_rid) THEN
    RETURN json_build_object('ok', false, 'reason', 'target_occupied');
  END IF;
  v_from := v_s.table_number;
  UPDATE sessions     SET table_number = p_to, last_activity_at = NOW() WHERE id = p_session;
  UPDATE orders       SET table_number = p_to WHERE session_id = p_session;
  UPDATE waiter_calls SET table_number = p_to WHERE session_id = p_session AND NOT resolved;
  -- TAG: the mark belongs to the PARTY — move it with them. Only when the party HAS a
  -- mark: the target's stale tag then gives way (PK). An unmarked party shifting onto a
  -- pre-marked free table leaves that mark alone. Rows fire the table_tags trigger → repaint.
  IF EXISTS (SELECT 1 FROM table_tags WHERE restaurant_id = v_rid AND table_number = v_from) THEN
    DELETE FROM table_tags WHERE restaurant_id = v_rid AND table_number = p_to;
    UPDATE table_tags SET table_number = p_to
      WHERE restaurant_id = v_rid AND table_number = v_from;
  END IF;
  -- Nudge BOTH table topics (guests) AND BOTH tables on 'ops' (staff panels' targeted
  -- refetch) so the OLD table clears and the NEW table fills — no wrong/duplicated tile.
  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id) VALUES
    ('table:' || v_from, 'session', p_session::text, v_from, v_rid),
    ('table:' || p_to,   'session', p_session::text, p_to,   v_rid),
    ('ops',              'session', p_session::text, p_to,   v_rid),
    ('ops',              'session', p_session::text, v_from, v_rid);
  RETURN json_build_object('ok', true, 'from', v_from, 'to', p_to);
END; $$;

-- ── E1. lfh_floor_state — VERBATIM from 126 + the "-- TAG:" lookup/field ─────
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
  v_tag         text;   -- TAG: this table's mark (vip/family/guest) or NULL
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

    -- TAG: this table's special mark, if any.
    SELECT tag INTO v_tag
      FROM table_tags WHERE restaurant_id = v_rid AND table_number = v_t;

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
      'tag',              COALESCE(v_tag, ''),   -- TAG: '' when unmarked
      'orders',           v_orders,
      'last_activity_at', v_sess.last_activity_at
    ));
  END LOOP;

  RETURN array_to_json(v_arr);
END; $function$
;

-- ── E2. lfh_table_view_summary — VERBATIM from 136 + the "-- TAG:" field ─────
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
             GREATEST(COALESCE(NULLIF(el->>'qty','')::int, 1), 0) AS qty
        FROM belong b
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(b.items, '[]'::jsonb)) el
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
END; $$;

-- ── E3. lfh_floor_bundle — VERBATIM from 100 + the "-- TAG:" table_tags key ──
CREATE OR REPLACE FUNCTION lfh_floor_bundle(p_restaurant_id uuid, p_table text DEFAULT NULL)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT * FROM sessions
    WHERE restaurant_id = p_restaurant_id
      AND status <> 'closed'
      AND (p_table IS NULL OR table_number = p_table)
  )
  SELECT json_build_object(
    'sessions',  COALESCE((SELECT json_agg(x ORDER BY x.last_activity_at DESC) FROM s x), '[]'::json),
    'members',   COALESCE((SELECT json_agg(m ORDER BY m.joined_at)
                             FROM session_members m
                            WHERE m.session_id IN (SELECT id FROM s) AND NOT m.removed), '[]'::json),
    'items',     COALESCE((SELECT json_agg(i ORDER BY i.created_at)
                             FROM order_items i
                            WHERE i.session_id IN (SELECT id FROM s)), '[]'::json),
    'requests',  COALESCE((SELECT json_agg(r ORDER BY r.created_at)
                             FROM requests r
                            WHERE r.restaurant_id = p_restaurant_id AND r.status = 'pending'
                              AND (p_table IS NULL OR r.table_number = p_table)), '[]'::json),
    'blocklist', COALESCE((SELECT json_agg(b ORDER BY b.blocked_at DESC)
                             FROM blocklist b
                            WHERE b.restaurant_id = p_restaurant_id), '[]'::json),
    -- TAG: the board's marks (tiny table: at most one row per table).
    'table_tags', COALESCE((SELECT json_agg(json_build_object(
                              'table_number', t.table_number, 'tag', t.tag))
                             FROM table_tags t
                            WHERE t.restaurant_id = p_restaurant_id
                              AND (p_table IS NULL OR t.table_number = p_table)), '[]'::json)
  );
$$;

-- ── E4. lfh_kitchen_tickets — VERBATIM from 081 + the "-- TAG:" join ─────────
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
    -- TAG: the table's mark so the kitchen ticket can show 👑/🏠/🤝 next to T<n>.
    'tag', COALESCE((SELECT t.tag FROM table_tags t
                      WHERE t.restaurant_id = o.restaurant_id
                        AND t.table_number = o.table_number), ''),
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

-- ── E5. lfh_admin_floor_all — VERBATIM from 145 + the "-- TAG:" trimmed field ─
-- Still money-free: 'g' is only the tag word, never an amount.
CREATE OR REPLACE FUNCTION public.lfh_admin_floor_all()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rid   uuid;
  v_tiles json;
  v_out   json[] := '{}';
BEGIN
  FOR v_rid IN
    SELECT id FROM restaurants WHERE deleted_at IS NULL ORDER BY name
  LOOP
    -- Reuse the single source of truth for a table's state, then keep only the rendered
    -- fields (drops the orders array + the money `due`, so the payload stays tiny + money-free).
    SELECT COALESCE(json_agg(json_build_object(
             'n', e->>'table_number',
             's', e->>'state',
             'p', COALESCE(e->>'pay', ''),
             'c', COALESCE((e->>'has_call')::boolean, false),
             'g', COALESCE(e->>'tag', '')          -- TAG: vip/family/guest or ''
           )), '[]'::json)
      INTO v_tiles
      FROM json_array_elements(public.lfh_floor_state(v_rid)) e;

    v_out := array_append(v_out, json_build_object('restaurant_id', v_rid, 'tables', v_tiles));
  END LOOP;

  RETURN array_to_json(v_out);
END;
$function$;

-- Grants: every function above keeps its exact signature, so CREATE OR REPLACE
-- preserves the existing staff-only ACLs (the 038 pattern) — re-asserted here
-- anyway for the ones panels call, so this file stands alone.
REVOKE EXECUTE ON FUNCTION lfh_table_view_summary(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_table_view_summary(uuid, text) TO service_role;
REVOKE EXECUTE ON FUNCTION lfh_floor_bundle(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_floor_bundle(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.lfh_admin_floor_all() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_admin_floor_all() TO service_role;

NOTIFY pgrst, 'reload schema';
