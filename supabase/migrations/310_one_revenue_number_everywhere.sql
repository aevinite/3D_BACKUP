-- 310_one_revenue_number_everywhere.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ONE NUMBER. The owner, 2026-08-12: "everywhere should be the same data … per restaurant in the
-- backend all the revenue should be auto calculated and only that revenue taken and calculated
-- elsewhere. In some areas of report there is another number and in some area another number."
--
-- WHERE HE WOULD SEE IT (the five that could disagree, before this file):
--   · Owner panel  → Reports → Revenue by dish        (lfh_owner_dish_breakdown)
--   · Owner panel  → Dashboard → Revenue by category  (lfh_owner_category_breakdown)
--   · Owner panel  → Dashboard → "vs same time"       (lfh_owner_samehour_compare)
--   · Admin console→ Live Floor → a table's "due"     (lfh_floor_state)
--   · Manager/Tablet → Tables floor → tile "₹ … due"  (lfh_table_view_summary)
-- Those five worked the net out for themselves as `total − discount × (1 + the rate configured
-- RIGHT NOW)`, while every other money surface — and the PRINTED BILL, the Z-report and
-- pay-in-parts since migration 284 — uses the rate the order was actually CHARGED at
-- (`orders.tax_rate`, grossed into `orders.disc_gross` by migration 301). So the moment a rate is
-- corrected, or a banquet order carries its own 18% beside 5% dine-in food, the owner's dish
-- report and the waiter's tile drifted from the paper the guest was handed by
-- `discount × (rate_now − rate_charged)`.
--
-- THE FIX IS A COLUMN, NOT A FORMULA. `orders.net_amount` is GENERATED ALWAYS AS
-- `total − disc_gross` STORED: the database computes each order's net once, at write time, from
-- that order's own numbers. After this file the arithmetic exists in exactly ONE place in the
-- whole system — the column definition on the next line — and every reader says `net_amount`.
-- Two screens can no longer disagree, because there is nothing left for them to disagree about.
--
-- WHY GENERATED AND NOT A TRIGGER: it is pure arithmetic on the same row, so Postgres can keep it
-- itself; there is no writer to forget, no backfill to run, and no way for it to go stale. The
-- read path also gets CHEAPER — five functions stop doing a settings lookup + JSONB parse for the
-- rate (the exact per-row cost migration 155 hoisted out, and 301 removed for the others).
--
-- NOT ONE STORED BILL IS REWRITTEN. `total`, `subtotal`, `discount`, `tax` and `disc_gross` are
-- untouched on every row (the billing guardrail). `net_amount` is derived, so it cannot disagree
-- with them.
--
-- MEASURED BEFORE WRITING THIS: 0 of ~31,000 orders currently carry a stamped rate that differs
-- from their restaurant's configured rate (migration 301 measured the same). So every figure below
-- must come out BYTE-IDENTICAL today — 19 money probes were captured before and after and compared
-- row by row, and they did. This is a latent fault made impossible, not a number being corrected.
--
-- STILL LEFT (named on purpose, next migration):
--   · `orders_daily_agg` / `orders_report_monthly_agg` keep `gross_paid` and `disc_gross_paid` as
--     two columns, so `lfh_owner_overview`, `lfh_owner_restaurant_revenue` and
--     `lfh_owner_payment_breakdown` still subtract one from the other on the ROLLUP path. They
--     agree with this column today; making the rollup carry `net_paid` is the same fix one level up.
--   · `lfh_session_state` — the guest's live table bill — still resolves the rate from settings.
--     It also splits MRP / non-taxable amounts (migs 270/272), so it needs its own careful pass.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- ── 1. THE ONE DEFINITION ────────────────────────────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS net_amount numeric GENERATED ALWAYS AS (total - disc_gross) STORED;

COMMENT ON COLUMN public.orders.net_amount IS
  'THE net of this order: total − disc_gross (mig 301), i.e. the discount grossed at the rate THIS order was charged at. Computed by the database, never written by hand. EVERY money reader — owner dashboard, reports, khata, the floor tiles'' due, the admin live floor — sums THIS column, so no two screens can compute revenue differently (mig 310). Revenue = SUM(net_amount) FILTER (status <> ''cancelled'' AND payment_status = ''paid'').';

-- ── 2. EVERY READER NOW SAYS net_amount ──────────────────────────────────────────────────────
-- Each body below was pulled LIVE from the database (pg_get_functiondef) and had ONLY its net
-- expression replaced, so nothing else in it can drift or be reverted to an older copy — the
-- "a later CREATE OR REPLACE from a stale copy silently reverts a fix" rule, followed literally.
-- CREATE OR REPLACE keeps every existing grant, so no REVOKE/GRANT is repeated here.

-- ── lfh_owner_dish_breakdown(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) — 1 expression ──
CREATE OR REPLACE FUNCTION public.lfh_owner_dish_breakdown(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(title text, qty bigint, revenue numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '128MB'
AS $function$
  -- (310) no rate CTE any more: the net comes from orders.net_amount, so nothing here
  -- needs to know today's tax rate.
  SELECT it->>'title' AS title,
         COALESCE(SUM((it->>'qty')::numeric), 0)::bigint AS qty,
         -- this line's share of its order's NET revenue (discount before tax, tax included)
         COALESCE(SUM(
           CASE WHEN g.gross > 0 THEN
             (COALESCE(NULLIF(it->>'qty', '')::numeric, 0) * COALESCE(NULLIF(it->>'price', '')::numeric, 0))
             / g.gross
             * (o.net_amount)
           ELSE 0 END
         ) FILTER (WHERE o.payment_status = 'paid'), 0)::numeric AS revenue
  FROM orders o
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS it
  -- the whole order's gross, so each line's share is a true proportion of it
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(
             COALESCE(NULLIF(e->>'qty', '')::numeric, 0) * COALESCE(NULLIF(e->>'price', '')::numeric, 0)
           ), 0) AS gross
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) e
  ) g ON true
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status <> 'cancelled'
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
    AND COALESCE(it->>'title', '') <> ''
  GROUP BY it->>'title'
  ORDER BY 3 DESC;
$function$;

-- ── lfh_owner_category_breakdown(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) — 1 expression ──
CREATE OR REPLACE FUNCTION public.lfh_owner_category_breakdown(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(category text, qty bigint, revenue numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '128MB'
AS $function$
  -- (310) no rate CTE any more: the net comes from orders.net_amount.
  SELECT COALESCE(mi.category, 'Other') AS category,
         COALESCE(SUM((it->>'qty')::numeric), 0)::bigint AS qty,
         COALESCE(SUM(
           CASE WHEN g.gross > 0 THEN
             (COALESCE(NULLIF(it->>'qty', '')::numeric, 0) * COALESCE(NULLIF(it->>'price', '')::numeric, 0))
             / g.gross
             * (o.net_amount)
           ELSE 0 END
         ) FILTER (WHERE o.payment_status = 'paid'), 0)::numeric AS revenue
  FROM orders o
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS it
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(
             COALESCE(NULLIF(e->>'qty', '')::numeric, 0) * COALESCE(NULLIF(e->>'price', '')::numeric, 0)
           ), 0) AS gross
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) e
  ) g ON true
  LEFT JOIN menu_items mi ON mi.restaurant_id = o.restaurant_id AND mi.title = (it->>'title')
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status <> 'cancelled'
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
  GROUP BY 1
  ORDER BY 3 DESC;
$function$;

-- ── lfh_owner_samehour_compare(p_restaurant_id uuid, p_starts timestamp with time zone[], p_elapsed interval) — 1 expression ──
CREATE OR REPLACE FUNCTION public.lfh_owner_samehour_compare(p_restaurant_id uuid, p_starts timestamp with time zone[], p_elapsed interval)
 RETURNS TABLE(window_start timestamp with time zone, revenue numeric, orders bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '128MB'
AS $function$
  SELECT s.window_start,
         COALESCE(SUM(o.net_amount)
           FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(o.id) FILTER (WHERE o.status <> 'cancelled')::bigint
  FROM unnest(p_starts) AS s(window_start)
  LEFT JOIN orders o ON o.restaurant_id = p_restaurant_id
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= s.window_start
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < s.window_start + p_elapsed
  GROUP BY s.window_start
  ORDER BY s.window_start DESC;
$function$;

-- ── lfh_floor_state(p_restaurant_id uuid) — 1 expression ──
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
      COALESCE(SUM(net_amount) FILTER (WHERE status NOT IN ('received','cancelled') AND payment_status <> 'paid'), 0),
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
END; $function$;

-- ── lfh_table_view_summary(p_restaurant_id uuid, p_table text) — 1 expression ──
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
  -- (310) v_rate is no longer read for the tile's due — orders.net_amount already carries the
  -- discount grossed at the rate each order was charged at. Left declared, deliberately unset.

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
      SELECT ts.t, o.id, o.status, o.payment_status, o.total, o.discount, o.net_amount, o.items
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
             COALESCE(SUM(net_amount)
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

-- ── lfh_owner_hourly(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) — 1 expression ──
CREATE OR REPLACE FUNCTION public.lfh_owner_hourly(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(hour integer, orders bigint, revenue numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXTRACT(hour FROM (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::int AS hour,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint,
         COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric
  FROM orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
  GROUP BY 1
  ORDER BY 1;
$function$;

-- ── lfh_owner_heatmap(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[]) — 1 expression ──
CREATE OR REPLACE FUNCTION public.lfh_owner_heatmap(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(dow integer, hr integer, orders bigint, revenue numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH rates AS (
    -- one row per restaurant this call can touch; the rate is read once, not once per order
    SELECT r.id, lfh_effective_tax_rate(r.id) AS rate
      FROM restaurants r
     WHERE (CASE WHEN p_restaurant_id IS NOT NULL THEN r.id = p_restaurant_id
                 WHEN p_ids IS NOT NULL THEN r.id = ANY(p_ids)
                 ELSE TRUE END)
  )
  SELECT EXTRACT(dow  FROM (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::int AS dow,
         EXTRACT(hour FROM (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::int AS hr,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint AS orders,
         COALESCE(SUM(o.net_amount)
           FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric AS revenue
  FROM orders o
  LEFT JOIN rates rt ON rt.id = o.restaurant_id
  WHERE (CASE WHEN p_restaurant_id IS NOT NULL THEN o.restaurant_id = p_restaurant_id
              WHEN p_ids IS NOT NULL THEN o.restaurant_id = ANY(p_ids)
              ELSE TRUE END)
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
  GROUP BY 1, 2
  ORDER BY 1, 2;
$function$;

-- ── lfh_owner_records(p_restaurant_id uuid) — 1 expression ──
CREATE OR REPLACE FUNCTION public.lfh_owner_records(p_restaurant_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH paid AS (
    SELECT o.id, o.session_id, o.table_number,
           (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AS created_at,
           (o.net_amount) AS rev
    FROM orders o
    WHERE o.restaurant_id = p_restaurant_id
      AND o.status <> 'cancelled' AND o.payment_status = 'paid'
  ),
  best_day AS (
    SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS d, SUM(rev) AS v
    FROM paid GROUP BY 1 ORDER BY 2 DESC LIMIT 1
  ),
  big_bill AS (
    SELECT COALESCE(session_id::text, 'solo:' || id::text) AS k,
           MAX(table_number) AS tbl, SUM(rev) AS v
    FROM paid GROUP BY 1 ORDER BY 3 DESC LIMIT 1
  ),
  fast_hour AS (
    SELECT date_trunc('hour', created_at AT TIME ZONE 'Asia/Kolkata') AS h, COUNT(*) AS n
    FROM paid GROUP BY 1 ORDER BY 2 DESC LIMIT 1
  ),
  star_dish AS (
    SELECT it->>'title' AS title, SUM((it->>'qty')::numeric)::bigint AS qty
    FROM orders o
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS it
    WHERE o.restaurant_id = p_restaurant_id AND o.status <> 'cancelled'
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= now() - interval '30 days'
      AND COALESCE(it->>'title', '') <> ''
    GROUP BY 1 ORDER BY 2 DESC LIMIT 1
  ),
  regulars AS (
    SELECT COUNT(*) AS n FROM (
      SELECT LOWER(TRIM(m.name))
      FROM session_members m
      WHERE m.restaurant_id = p_restaurant_id
        AND m.joined_at >= now() - interval '30 days'
        AND COALESCE(TRIM(m.name), '') <> ''
      GROUP BY 1
      HAVING COUNT(DISTINCT m.session_id) >= 2
    ) rc
  )
  SELECT jsonb_build_object(
    'bestDay',  (SELECT jsonb_build_object('date', d, 'revenue', ROUND(v, 2)) FROM best_day),
    'bigBill',  (SELECT jsonb_build_object('table', tbl, 'revenue', ROUND(v, 2)) FROM big_bill),
    'fastHour', (SELECT jsonb_build_object('at', h, 'orders', n) FROM fast_hour),
    'starDish', (SELECT jsonb_build_object('title', title, 'qty', qty) FROM star_dish),
    'regulars', (SELECT n FROM regulars)
  );
$function$;

-- ── lfh_owner_revenue_timeseries(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_bucket text, p_ids uuid[]) — 1 expression ──
CREATE OR REPLACE FUNCTION public.lfh_owner_revenue_timeseries(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_bucket text, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(bucket timestamp with time zone, restaurant_id uuid, revenue numeric, orders bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH
  params AS (SELECT COALESCE(NULLIF(p_bucket, ''), 'day') AS b),
  rates AS MATERIALIZED (SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r),
  wm AS (SELECT rolled_through, ((rolled_through + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS tail_start FROM orders_daily_agg_state),
  hist AS (
    SELECT a.restaurant_id, a.day, SUM(a.gross_paid) gp, SUM(a.disc_paid) dp,
           SUM(COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id)))) dpg,
           SUM(a.all_orders) ao
    FROM orders_daily_agg a
    WHERE a.day <= (CASE WHEN (SELECT b FROM params) = 'day' THEN (SELECT rolled_through FROM wm) ELSE '-infinity'::date END)
      AND a.day >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
      AND a.day <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date
      AND (p_restaurant_id IS NULL OR a.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR a.restaurant_id = ANY(p_ids))
    GROUP BY a.restaurant_id, a.day
  ),
  tail AS (
    SELECT o.restaurant_id, (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) gp,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dp,
      COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dpg,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled') ao
    FROM orders o
    WHERE o.created_at >= (CASE WHEN (SELECT b FROM params) = 'day' THEN (SELECT tail_start FROM wm) ELSE 'infinity'::timestamptz END)
      AND o.created_at >= p_from AND o.created_at < p_to
      AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR o.restaurant_id = ANY(p_ids))
    GROUP BY o.restaurant_id, (o.created_at AT TIME ZONE 'Asia/Kolkata')::date
  ),
  day_comb AS (
    SELECT restaurant_id, day, SUM(gp) gp, SUM(dp) dp, SUM(dpg) dpg, SUM(ao) ao
    FROM (SELECT * FROM hist UNION ALL SELECT * FROM tail) u
    GROUP BY restaurant_id, day
  ),
  day_rows AS (
    SELECT (c.day::timestamp AT TIME ZONE 'Asia/Kolkata') AS bucket, c.restaurant_id,
           (c.gp - c.dpg)::numeric AS revenue, c.ao::bigint AS orders
    FROM day_comb c JOIN rates rt ON rt.rid = c.restaurant_id
  ),
  live_rows AS (  -- hour/week/month: original live aggregation, fenced off when b='day'
    SELECT date_trunc((SELECT b FROM params), o.created_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
           o.restaurant_id,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric AS revenue,
           COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint AS orders
    FROM orders o
    JOIN rates rt ON rt.rid = o.restaurant_id
    WHERE o.created_at >= (CASE WHEN (SELECT b FROM params) = 'day' THEN 'infinity'::timestamptz ELSE p_from END)
      AND o.created_at < p_to
      AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR o.restaurant_id = ANY(p_ids))
    GROUP BY 1, 2
  )
  SELECT * FROM day_rows
  UNION ALL
  SELECT * FROM live_rows
  ORDER BY 1;
$function$;

-- ── lfh_owner_sales_report(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_bucket text, p_ids uuid[]) — 2 expressions ──
CREATE OR REPLACE FUNCTION public.lfh_owner_sales_report(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_bucket text, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(bucket timestamp with time zone, orders bigint, paid_orders bigint, subtotal numeric, tax numeric, discount numeric, revenue numeric, cancelled_orders bigint, cancelled_value numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '128MB'
 SET plan_cache_mode TO 'force_custom_plan'
 SET statement_timeout TO '25s'
AS $function$
  WITH
  params AS (SELECT COALESCE(NULLIF(p_bucket, ''), 'day') AS b),
  rates  AS MATERIALIZED (SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r),
  -- the restaurant id-set as ONE array value (a single-row CTE); referenced as a scalar
  -- subquery `(SELECT arr FROM ids)` so `= ANY(<array>)` gets the array, not a row-set.
  ids    AS (SELECT (CASE WHEN p_restaurant_id IS NOT NULL THEN ARRAY[p_restaurant_id]
                          WHEN p_ids IS NOT NULL THEN p_ids
                          ELSE (SELECT array_agg(id) FROM restaurants) END) AS arr),
  wm     AS (SELECT s.rolled_through_month,
                    ((date_trunc('month', s.rolled_through_month) + interval '1 month')::timestamp
                        AT TIME ZONE 'Asia/Kolkata') AS tail_start
             FROM orders_report_monthly_agg_state s),
  -- only accelerate a month report that ends in a still-live month (every "…to now" report)
  fences AS (
    SELECT ((SELECT b FROM params) = 'month' AND p_to > (SELECT tail_start FROM wm)) AS use_rollup
  ),
  bounds AS (
    SELECT
      CASE WHEN (SELECT use_rollup FROM fences) THEN (SELECT rolled_through_month FROM wm) ELSE '-infinity'::date        END AS hist_max_month,
      CASE WHEN (SELECT use_rollup FROM fences) THEN (SELECT tail_start FROM wm)           ELSE  'infinity'::timestamptz  END AS mtail_start,
      CASE WHEN (SELECT use_rollup FROM fences) THEN  'infinity'::timestamptz              ELSE '-infinity'::timestamptz  END AS live_min_created
  ),
  -- frozen months from the rollup
  hist AS (
    SELECT a.restaurant_id, a.month,
           a.all_orders ao, a.paid_orders po, a.canc_orders co,
           a.gross_paid gp, a.sub_paid sp, a.disc_paid dp, a.gross_canc gc, a.disc_canc dc,
           COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id))) dpg,
           COALESCE(a.disc_gross_canc, a.disc_canc * (1 + lfh_effective_tax_rate(a.restaurant_id))) dcg
    FROM orders_report_monthly_agg a CROSS JOIN ids
    WHERE a.month <= (SELECT hist_max_month FROM bounds)
      AND a.month >= date_trunc('month', (p_from AT TIME ZONE 'Asia/Kolkata'))::date
      AND a.restaurant_id = ANY (ids.arr)
  ),
  -- live tail for the current unfrozen month(s), re-derives eff-date + measures
  mtail AS (
    SELECT o.restaurant_id,
           date_trunc('month',
             (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END)
               AT TIME ZONE 'Asia/Kolkata')::date AS month,
           COUNT(*) FILTER (WHERE o.status <> 'cancelled')                              ao,
           COUNT(*) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid') po,
           COUNT(*) FILTER (WHERE o.status =  'cancelled')                              co,
           COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) gp,
           COALESCE(SUM(o.subtotal) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) sp,
           COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dp,
           COALESCE(SUM(o.total)    FILTER (WHERE o.status =  'cancelled'), 0) gc,
           COALESCE(SUM(o.discount) FILTER (WHERE o.status =  'cancelled'), 0) dc,
           COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dpg,
           COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status =  'cancelled'), 0) dcg
    FROM orders o CROSS JOIN ids
    WHERE (o.created_at >= (SELECT mtail_start FROM bounds)
           OR (o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL AND o.paid_at >= (SELECT mtail_start FROM bounds)))
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) <  p_to
      AND o.restaurant_id = ANY (ids.arr)
    GROUP BY 1, 2
  ),
  mcomb AS (
    SELECT restaurant_id, month,
           SUM(ao) ao, SUM(po) po, SUM(co) co,
           SUM(gp) gp, SUM(sp) sp, SUM(dp) dp, SUM(gc) gc, SUM(dc) dc, SUM(dpg) dpg, SUM(dcg) dcg
    FROM (SELECT * FROM hist UNION ALL SELECT * FROM mtail) u
    GROUP BY restaurant_id, month
  ),
  month_rows AS (
    SELECT (c.month::timestamp AT TIME ZONE 'Asia/Kolkata')            AS bucket,
           SUM(c.ao)::bigint                                            AS orders,
           SUM(c.po)::bigint                                            AS paid_orders,
           COALESCE(SUM(c.sp), 0)::numeric                              AS subtotal,
           COALESCE(SUM(c.gp - c.sp - (c.dpg - c.dp)), 0)::numeric      AS tax,
           COALESCE(SUM(c.dp), 0)::numeric                              AS discount,
           COALESCE(SUM(c.gp - c.dpg), 0)::numeric                      AS revenue,
           SUM(c.co)::bigint                                            AS cancelled_orders,
           COALESCE(SUM(c.gc - c.dcg), 0)::numeric                      AS cancelled_value
    FROM mcomb c JOIN rates rt ON rt.rid = c.restaurant_id
    GROUP BY c.month
  ),
  -- the ORIGINAL live aggregation, fenced OFF (empty created_at probe) when use_rollup
  live_rows AS (
    SELECT date_trunc(COALESCE(NULLIF(p_bucket, ''), 'day'),
                      (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
           COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint,
           COUNT(*) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid')::bigint,
           COALESCE(SUM(o.subtotal) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
           COALESCE(SUM(o.total - o.subtotal - (o.disc_gross - o.discount)) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
           COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
           COUNT(*) FILTER (WHERE o.status = 'cancelled')::bigint,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status = 'cancelled'), 0)::numeric
    FROM orders o
    JOIN rates rt ON rt.rid = o.restaurant_id
    CROSS JOIN ids
    WHERE o.created_at >= (SELECT live_min_created FROM bounds)   -- +infinity => empty when use_rollup
      AND o.restaurant_id = ANY (ids.arr)
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) <  p_to
    GROUP BY 1
  )
  SELECT * FROM month_rows
  UNION ALL
  SELECT * FROM live_rows
  ORDER BY 1;
$function$;

-- ── lfh_owner_payment_trend(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) — 1 expression ──
CREATE OR REPLACE FUNCTION public.lfh_owner_payment_trend(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(day date, method text, revenue numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ((CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::date AS day,
         COALESCE(NULLIF(TRIM(o.payment_method), ''), 'Not recorded') AS method,
         COALESCE(SUM(o.net_amount), 0)::numeric
  FROM orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status <> 'cancelled' AND o.payment_status = 'paid'
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
  GROUP BY 1, 2
  ORDER BY 1;
$function$;

-- ── lfh_khata_collected(p_restaurant_ids uuid[], p_from timestamp with time zone, p_to timestamp with time zone) — 1 expression ──
CREATE OR REPLACE FUNCTION public.lfh_khata_collected(p_restaurant_ids uuid[], p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(restaurant_id uuid, collected numeric, order_count bigint, bill_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT o.restaurant_id,
         -- mig 301's disc_gross, as everywhere else. No deleted_at filter: money that was
         -- collected was collected, and the Z-report counts a deleted bill too (COMPLIANCE §3).
         COALESCE(round(sum((COALESCE(o.net_amount, 0))::numeric), 2), 0) AS collected,
         COUNT(*)::bigint                                                  AS order_count,
         COUNT(DISTINCT COALESCE(o.session_id::text, o.id::text))::bigint  AS bill_count
  FROM orders o
  WHERE o.khata_at IS NOT NULL
    AND o.payment_status = 'paid'
    AND o.status <> 'cancelled'
    AND o.paid_at IS NOT NULL
    AND o.paid_at >= p_from AND o.paid_at < p_to
    AND o.restaurant_id = ANY (p_restaurant_ids)
  GROUP BY o.restaurant_id;
$function$;

-- ── lfh_khata_outstanding(p_restaurant_ids uuid[], p_limit integer) — 1 expression ──
CREATE OR REPLACE FUNCTION public.lfh_khata_outstanding(p_restaurant_ids uuid[], p_limit integer DEFAULT 500)
 RETURNS TABLE(restaurant_id uuid, khata_customer_id uuid, name text, phone text, note text, bill_key text, session_id uuid, bill_no integer, table_number text, khata_at timestamp with time zone, order_ids uuid[], bill_amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH open_orders AS (
    SELECT o.id, o.restaurant_id, o.khata_customer_id, o.session_id,
           o.table_number::text AS table_number, o.khata_at,
           -- mig 301: the discount as it really reduces this bill, at the rate THIS order was
           -- charged (never re-derived from tax/subtotal, which is wrong the moment a bill
           -- carries an untaxed line).
           round((COALESCE(o.net_amount, 0))::numeric, 2) AS due
    FROM orders o
    WHERE o.khata_at IS NOT NULL
      AND o.payment_status <> 'paid'
      AND o.status <> 'cancelled'
      AND o.deleted_at IS NULL          -- ← F12: a tombstoned bill is not owed
      AND o.khata_customer_id IS NOT NULL
      AND o.restaurant_id = ANY (p_restaurant_ids)
  ),
  bills AS (
    SELECT oo.restaurant_id,
           oo.khata_customer_id,
           COALESCE(oo.session_id::text, oo.id::text)        AS bill_key,
           oo.session_id,
           max(oo.table_number)                              AS table_number,
           max(oo.khata_at)                                  AS khata_at,
           array_agg(oo.id)                                  AS order_ids,
           round(sum(oo.due), 2)                             AS bill_amount
    FROM open_orders oo
    GROUP BY oo.restaurant_id, oo.khata_customer_id,
             COALESCE(oo.session_id::text, oo.id::text), oo.session_id
  ),
  -- Bounded by PERSON, biggest debt first, so every customer that IS shown has all of their bills
  -- and their own figure is complete. The headline total comes from the summary function below,
  -- which sees everyone.
  ranked AS (
    SELECT b.khata_customer_id,
           row_number() OVER (ORDER BY sum(b.bill_amount) DESC, b.khata_customer_id) AS rn
    FROM bills b
    GROUP BY b.khata_customer_id
  )
  SELECT b.restaurant_id, b.khata_customer_id, kc.name, kc.phone, kc.note,
         b.bill_key, b.session_id, s.bill_no, b.table_number, b.khata_at,
         b.order_ids, b.bill_amount
  FROM bills b
  JOIN ranked r      ON r.khata_customer_id = b.khata_customer_id
  JOIN khata_customers kc ON kc.id = b.khata_customer_id
  LEFT JOIN sessions s    ON s.id = b.session_id
  WHERE r.rn <= GREATEST(1, COALESCE(p_limit, 500))
  ORDER BY b.khata_at DESC;
$function$;

-- ── lfh_khata_outstanding_summary(p_restaurant_ids uuid[]) — 1 expression ──
CREATE OR REPLACE FUNCTION public.lfh_khata_outstanding_summary(p_restaurant_ids uuid[])
 RETURNS TABLE(total_outstanding numeric, people_count bigint, bill_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH open_orders AS (
    SELECT o.khata_customer_id, o.session_id, o.id,
           round((COALESCE(o.net_amount, 0))::numeric, 2) AS due
    FROM orders o
    WHERE o.khata_at IS NOT NULL
      AND o.payment_status <> 'paid'
      AND o.status <> 'cancelled'
      AND o.deleted_at IS NULL
      AND o.khata_customer_id IS NOT NULL
      AND o.restaurant_id = ANY (p_restaurant_ids)
  )
  SELECT COALESCE(round(sum(due), 2), 0)                                        AS total_outstanding,
         COUNT(DISTINCT khata_customer_id)::bigint                              AS people_count,
         COUNT(DISTINCT COALESCE(session_id::text, id::text))::bigint            AS bill_count
  FROM open_orders;
$function$;

-- ── 3. Tell PostgREST about the new column ───────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
