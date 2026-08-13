-- 321_the_sweep_of_layer_b.sql — the T16 sweep's database fixes (migrations 151–308), 2026-08-13
--
-- ⚠ MIGRATION NUMBER: 321, the next free slot after main's 320. This file was written as 313 and
--   renumbered twice while parallel sessions merged 313–320 underneath it; every statement is
--   CREATE OR REPLACE / INSERT … ON CONFLICT, so it is correct at ANY number. Renumbering before a
--   merge is the process working as intended (see 275/276 in verify-db-grants.mjs's KNOWN_GAPS).
--   Re-checked at merge time that main's newest migrations touch NONE of the functions below —
--   320 only defines lfh_rt_emit_staff_perms — because getting that wrong once already cost this
--   file a full rewrite (see the note under "true latest" below).
--
-- WHAT THIS FILE IS. A 500-check reading of migrations 151–308 found eleven problems. Seven were
-- fixed IN PLACE, in the files that caused them, because only the original file can make ITSELF
-- re-runnable (043, 093, 198, 209, 219, 288, 295 — the same way migration 307 wrapped 043 and 093).
-- This file carries the rest, plus the ledger rows that retire the four one-time data rewrites.
--
-- ⚠️ EVERY BODY BELOW WAS TAKEN FROM THE **TRUE LATEST** DEFINITION, COMPUTED ACROSS THE WHOLE
-- FOLDER — not from the file the sweep happened to read. That distinction cost a rewrite of this
-- migration: the first draft took the report bodies from 301/310, and migrations 315 and 317 had
-- since rewritten them, so applying it would have REVERTED the rollup's net column and the daily
-- rollup's pay-later day. That is migration 270's scar (203/215 copied an older lfh_price_order and
-- put a flat 5% tax back for 55 migrations) repeating itself inside the very sweep that reported it.
-- Sources used, each verified as the newest definition in supabase/migrations:
--   lfh_owner_payment_breakdown · lfh_owner_restaurant_revenue · lfh_owner_revenue_timeseries → 315
--   lfh_table_view_summary → 310 · lfh_bump_orders_watermark → 246 · admin_purge_restaurant → 309
--   lfh_staff_move_order · lfh_staff_move_order_item → 264 · lfh_staff_place_order → 250
--
-- NOT ONE STORED BILL IS REWRITTEN. total, subtotal, discount, tax, disc_gross and tax_rate are
-- untouched on every row (the billing guardrail). Proven before merging: every money figure from the
-- three changed report functions is BYTE-IDENTICAL to the old ones over all-time / 30-day / 12-month
-- windows in both day and month buckets, and 1,851 floor tiles across 9 restaurants come out the
-- same except the ONE that was wrong.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1 · THE FOUR ONE-TIME DATA REWRITES ARE NOW ON THE LEDGER (findings 7510 / 7822)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 198 / 209 / 295 rewrite the ACCESS MODEL — a manager's parcel and platform powers, and all six of
-- a waiter's tablet capability switches — with a WHERE that tests "is it not the value I want"
-- rather than absence. 288 NULLs any stamped tax rate that does not match the restaurant's CURRENT
-- rate. All four are correct exactly once; on a re-seed they hand back access an admin removed, or
-- (288, after a GST change) un-stamp every historical order and let months of filed revenue be
-- re-priced at the new rate. Each file now carries the migration-307 guard; recording the keys HERE
-- is what makes today's databases skip them from now on. On a FRESH database they sort earlier, run
-- their single legitimate time, and land here — the same both-directions reasoning 307 wrote down.
INSERT INTO lfh_applied_once (key, note) VALUES
  ('198_parcel_default_manager_on',
   'grants every manager the parcel power and resets tablet_parcel. A re-run undoes an admin''s choices.'),
  ('209_platform_module_defaults',
   'grants every manager the platform power and resets restaurant #1''s delivery channels to all-on.'),
  ('295_waiter_caps_default_on',
   'forces all six waiter tablet capability switches to on, discarding any deliberate off/pin.'),
  ('288_null_implausible_tax_rates',
   'NULLs a stamped tax_rate that differs from the restaurant''s CURRENT rate. After a GST change a re-run would un-stamp all history and re-price it.')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2 · THE LAST THREE MONEY SCREENS THAT STILL DATED A PAY-LATER BILL BY THE DAY IT WAS OPENED (7517)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHERE THE OWNER SEES IT: Owner → Dashboard → the revenue-over-time chart · Owner → Reports →
-- Payments (revenue by payment method) · the portfolio's revenue-per-restaurant list.
--
-- Migration 185 ruled that a khata bill's revenue belongs to the day it was COLLECTED. Nine owner
-- figures obey it. Migration 190 rewrote four of them onto the daily rollup and dropped the rule
-- from all four; 266 restored it for lfh_owner_overview only, and 315 kept the other three as they
-- were. Migration 317 then made the ROLLUP key its day on the collection date — which leaves these
-- three reading a rollup keyed one way and a live tail filtered the other, so a tab opened before
-- the watermark and collected inside the live window falls into NEITHER and vanishes from the
-- figure altogether.
--
-- The fix is the shape 315/317 already use for the monthly reader: the live-tail fence gains
-- `OR (khata_at IS NOT NULL AND paid_at >= tail_start)` so the row is reachable, and the window
-- comparison moves to the collection date so it is counted once, in the right window.

-- ── 2a · Reports → Payments ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_payment_breakdown(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(method text, revenue numeric, orders bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '128MB'
AS $function$
  WITH
  rates AS MATERIALIZED (SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r),
  wm AS (SELECT rolled_through, ((rolled_through + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS tail_start FROM orders_daily_agg_state),
  hist AS (
    SELECT a.restaurant_id, a.method, SUM(a.gross_paid) gp, SUM(a.disc_paid) dp,
           SUM(COALESCE(a.net_paid, a.gross_paid - COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id))))) net,
           SUM(COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id)))) dpg,
           SUM(a.paid_orders) po
    FROM orders_daily_agg a
    WHERE a.day <= (SELECT rolled_through FROM wm)
      AND a.day >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
      AND a.day <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date
      AND (p_restaurant_id IS NULL OR a.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR a.restaurant_id = ANY (p_ids))
    GROUP BY a.restaurant_id, a.method
  ),
  -- the live tail's split legs, same shape as the rollup's
  legs AS (
    SELECT sp.session_id, sp.method, SUM(sp.amount) AS amt
      FROM session_payments sp
     WHERE sp.reversed_at IS NULL
       AND (p_restaurant_id IS NULL OR sp.restaurant_id = p_restaurant_id)
       AND (p_ids IS NULL OR sp.restaurant_id = ANY (p_ids))
     GROUP BY sp.session_id, sp.method
    HAVING SUM(sp.amount) > 0
  ),
  legw AS (
    SELECT session_id, method,
           amt / SUM(amt) OVER (PARTITION BY session_id) AS w,
           (ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY amt DESC, method) = 1) AS primary_leg
      FROM legs
  ),
  tail AS (
    SELECT o.restaurant_id,
           COALESCE(l.method, NULLIF(o.payment_method, ''), 'Not recorded') AS method,
           COALESCE(SUM(o.total    * COALESCE(l.w, 1)), 0) gp,
           COALESCE(SUM(o.discount * COALESCE(l.w, 1)), 0) dp,
           COALESCE(SUM(o.disc_gross * COALESCE(l.w, 1)), 0) dpg,
           COALESCE(SUM(o.net_amount * COALESCE(l.w, 1)), 0) net,
           COUNT(*) FILTER (WHERE COALESCE(l.primary_leg, true)) po
    FROM orders o
    LEFT JOIN legw l ON o.payment_method = 'Split' AND l.session_id = o.session_id
    WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
      AND (o.created_at >= (SELECT tail_start FROM wm)
           OR (o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL AND o.paid_at >= (SELECT tail_start FROM wm)))
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) <  p_to
      AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR o.restaurant_id = ANY (p_ids))
    GROUP BY o.restaurant_id, COALESCE(l.method, NULLIF(o.payment_method, ''), 'Not recorded')
  ),
  comb AS (
    SELECT restaurant_id, method, SUM(gp) gp, SUM(dp) dp, SUM(dpg) dpg, SUM(net) net, SUM(po) po
    FROM (SELECT * FROM hist UNION ALL SELECT * FROM tail) u
    GROUP BY restaurant_id, method
  )
  SELECT c.method,
    -- (315) one stored net, instead of subtracting two stored columns from each other.
         COALESCE(SUM(c.net), 0)::numeric AS revenue,
    SUM(c.po)::bigint AS orders
  FROM comb c JOIN rates rt ON rt.rid = c.restaurant_id
  GROUP BY c.method
  -- was `HAVING SUM(c.po) > 0` — which would hide the non-primary method of every split bill, the
  -- exact money this migration exists to surface. A method with real money and no order count is a
  -- legitimate answer now.
  HAVING SUM(c.po) > 0 OR SUM(c.gp) <> 0
  ORDER BY revenue DESC;
$function$;

-- ── 2b · the portfolio's revenue-per-restaurant list ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_owner_restaurant_revenue(p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(restaurant_id uuid, slug text, name text, accent_color text, revenue numeric, orders bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH
  rates AS MATERIALIZED (SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate FROM restaurants r),
  wm AS (SELECT rolled_through, ((rolled_through + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS tail_start FROM orders_daily_agg_state),
  hist AS (
    SELECT a.restaurant_id, SUM(a.gross_paid) gp, SUM(a.disc_paid) dp,
           SUM(COALESCE(a.net_paid, a.gross_paid - COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id))))) net,
           SUM(COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id)))) dpg,
           SUM(a.all_orders) ao
    FROM orders_daily_agg a
    WHERE a.day <= (SELECT rolled_through FROM wm)
      AND a.day >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
      AND a.day <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date
    GROUP BY a.restaurant_id
  ),
  tail AS (
    SELECT o.restaurant_id,
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) gp,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dp,
      COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dpg,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) net,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled') ao
    FROM orders o
    WHERE (o.created_at >= (SELECT tail_start FROM wm)
           OR (o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL AND o.paid_at >= (SELECT tail_start FROM wm)))
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) <  p_to
    GROUP BY o.restaurant_id
  )
  SELECT r.id, r.slug, r.name, r.accent_color,
    -- (315) one stored net, instead of subtracting two stored columns from each other.
         (COALESCE(h.net, 0) + COALESCE(t.net, 0))::numeric AS revenue,
    (COALESCE(h.ao, 0) + COALESCE(t.ao, 0))::bigint AS orders
  FROM restaurants r
  JOIN rates rt ON rt.rid = r.id
  LEFT JOIN hist h ON h.restaurant_id = r.id
  LEFT JOIN tail t ON t.restaurant_id = r.id
  WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
  ORDER BY revenue DESC;
$function$;

-- ── 2c · the Dashboard's revenue-over-time chart ──────────────────────────────────────────────
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
           SUM(COALESCE(a.net_paid, a.gross_paid - COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id))))) net,
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
    SELECT o.restaurant_id, ((CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::date AS day,
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) gp,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dp,
      COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dpg,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) net,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled') ao
    FROM orders o
    WHERE (o.created_at >= (CASE WHEN (SELECT b FROM params) = 'day' THEN (SELECT tail_start FROM wm) ELSE 'infinity'::timestamptz END)
           OR (o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL
               AND o.paid_at >= (CASE WHEN (SELECT b FROM params) = 'day' THEN (SELECT tail_start FROM wm) ELSE 'infinity'::timestamptz END)))
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
      AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR o.restaurant_id = ANY(p_ids))
    GROUP BY o.restaurant_id, ((CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata')::date
  ),
  day_comb AS (
    SELECT restaurant_id, day, SUM(gp) gp, SUM(dp) dp, SUM(dpg) dpg, SUM(net) net, SUM(ao) ao
    FROM (SELECT * FROM hist UNION ALL SELECT * FROM tail) u
    GROUP BY restaurant_id, day
  ),
  day_rows AS (
    SELECT (c.day::timestamp AT TIME ZONE 'Asia/Kolkata') AS bucket, c.restaurant_id,
           -- (315) one stored net, instead of subtracting two stored columns from each other.
         c.net::numeric AS revenue, c.ao::bigint AS orders
    FROM day_comb c JOIN rates rt ON rt.rid = c.restaurant_id
  ),
  live_rows AS (  -- hour/week/month: original live aggregation, fenced off when b='day'
    SELECT date_trunc((SELECT b FROM params), (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
           o.restaurant_id,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric AS revenue,
           COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint AS orders
    FROM orders o
    JOIN rates rt ON rt.rid = o.restaurant_id
    WHERE (CASE WHEN (SELECT b FROM params) = 'day' THEN 'infinity'::timestamptz ELSE p_from END) <= (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END)
      AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
      AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR o.restaurant_id = ANY(p_ids))
    GROUP BY 1, 2
  )
  SELECT * FROM day_rows
  UNION ALL
  SELECT * FROM live_rows
  ORDER BY 1;
$function$;


-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3 · COLLECTING A PAY-LATER BILL NOW BUSTS THE REPORT SNAPSHOT (finding 7573)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHERE THE OWNER SEES IT: Owner → Reports → Sales / Tax / Discounts / Day summary on a window of
-- 35 days or less, and the Dashboard on the same windows. The report counts a collected pay-later
-- bill in the window it was collected in; the detector that decides whether to recompute the
-- snapshot bumped only the CREATION day, so the cached payload — computed before the money arrived
-- — was served, with nothing on screen saying it was old. Migration 300 fixed exactly this for the
-- month fingerprint and wrote the argument down; the day-bucket watermark never got it.
CREATE OR REPLACE FUNCTION public.lfh_bump_orders_watermark()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rid uuid;
  v_day date;
BEGIN
  -- A DELETE must still invalidate the window the row USED to be in.
  IF TG_OP = 'DELETE' THEN
    v_rid := OLD.restaurant_id;
    v_day := (OLD.created_at AT TIME ZONE 'Asia/Kolkata')::date;
  ELSE
    v_rid := NEW.restaurant_id;
    v_day := (NEW.created_at AT TIME ZONE 'Asia/Kolkata')::date;
  END IF;

  IF v_rid IS NOT NULL THEN
    INSERT INTO public.orders_change_watermark (restaurant_id, day, changes, last_change_at)
    VALUES (v_rid, v_day, 1, now())
    ON CONFLICT (restaurant_id, day)
    DO UPDATE SET changes = public.orders_change_watermark.changes + 1, last_change_at = now();
  END IF;

  -- A pay-later bill counts as revenue on the day it was COLLECTED (mig 185, and mig 317 made the
  -- daily rollup agree), so collecting one changes a report window that this row's created_at day is
  -- not in. Mark the payment day too, or the snapshot cache is never told the money arrived
  -- (T16 finding 7573; mig 300 fixed the same blindness in the MONTH fingerprint and said so).
  -- Over-including can only cause one needless recompute; missing a change is the only unsafe
  -- direction — mig 246's own rule, three paragraphs up.
  IF TG_OP <> 'DELETE' AND NEW.khata_at IS NOT NULL AND NEW.paid_at IS NOT NULL
     AND NEW.restaurant_id IS NOT NULL
     AND (NEW.paid_at AT TIME ZONE 'Asia/Kolkata')::date
         IS DISTINCT FROM (NEW.created_at AT TIME ZONE 'Asia/Kolkata')::date THEN
    INSERT INTO public.orders_change_watermark (restaurant_id, day, changes, last_change_at)
    VALUES (NEW.restaurant_id, (NEW.paid_at AT TIME ZONE 'Asia/Kolkata')::date, 1, now())
    ON CONFLICT (restaurant_id, day)
    DO UPDATE SET changes = public.orders_change_watermark.changes + 1, last_change_at = now();
  END IF;

  -- If created_at itself moved (a correction), the OLD day must be invalidated too, or a
  -- report covering it would keep showing a figure that no longer includes this order.
  IF TG_OP = 'UPDATE' AND OLD.created_at IS DISTINCT FROM NEW.created_at AND OLD.restaurant_id IS NOT NULL THEN
    INSERT INTO public.orders_change_watermark (restaurant_id, day, changes, last_change_at)
    VALUES (OLD.restaurant_id, (OLD.created_at AT TIME ZONE 'Asia/Kolkata')::date, 1, now())
    ON CONFLICT (restaurant_id, day)
    DO UPDATE SET changes = public.orders_change_watermark.changes + 1, last_change_at = now();
  END IF;

  RETURN NULL; -- AFTER trigger: the return value is ignored
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4 · A TILE NEVER CALLS COOKING FOOD "SERVED", NOR PROMISES AN AMOUNT IT HASN'T GOT (7902)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHERE THE WAITER SEES IT: Manager → Tables floor, and Tablet → Tables. Observed live on the
-- backup site while sweeping: a tile labelled "Served" with the red unpaid outline and no ₹ amount,
-- whose only live order was still `preparing`. The ladder reads the LINE counts, and an order can
-- have none to count — no order_items rows and an `items` that is empty or not an array (the scalar
-- case migration 229 exists for). 229/234 stopped that shape ERRORING; nothing made the label
-- honest. Two additive changes: fall back to the orders' own status before deciding a table is
-- waiting to pay, and when the red outline has no amount behind it, say so.
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
             -- (T16 7902) The ladder below reads the LINE counts, and an order can have none to
             -- count: no order_items rows and an `items` that is empty or not an array (the scalar
             -- case mig 229 exists for). Those tiles fell through to "unpaid => Served" and labelled
             -- cooking food as served. Carry the ORDERS' own statuses so the fallback can be honest.
             COALESCE(bool_or(status = 'received'),  false) AS any_new_order,
             COALESCE(bool_or(status = 'preparing'), false) AS any_prep_order,
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
           COALESCE(bagg.any_new_order, false)  AS any_new_order,
           COALESCE(bagg.any_prep_order, false) AS any_prep_order,
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
      -- (T16 7902) With no countable lines, fall back to the ORDERS' own status before deciding
      -- this table is waiting to pay — a 'preparing' order must never read as "Served".
      ELSIF (r.nw + r.ck + r.rd + r.sv) = 0 AND r.any_new_order  THEN v_state := 'new';  v_label := 'New order';
      ELSIF (r.nw + r.ck + r.rd + r.sv) = 0 AND r.any_prep_order THEN v_state := 'prep'; v_label := 'Preparing';
      ELSIF r.unpaid THEN v_state := 'bill';  v_label := 'Served';
      ELSE                v_state := 'done';  v_label := 'Cleared';
      END IF;
      IF (r.nw + r.ck + r.rd + r.sv) > 0 THEN
        v_meta := r.sv || '/' || (r.nw + r.ck + r.rd + r.sv) || ' served'
                  || CASE WHEN r.due > 0 THEN ' · ' || lfh_inr(r.due) || ' due' ELSE '' END;
      ELSE
        -- (T16 7902) An unpaid tile is drawn with the red outline, which promises an amount. When
        -- there is none, say so rather than leaving the waiter to tap a pay button that does nothing.
        v_meta := r.oc || ' order' || CASE WHEN r.oc = 1 THEN '' ELSE 's' END
                  || CASE WHEN r.unpaid AND r.due <= 0 THEN ' · nothing to pay' ELSE '' END;
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


-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5 · A PURGE CLEARS THE OPERATIONAL TABLES AGAIN (finding 7523)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHERE IT LIVES: Admin console → Restaurants → Recycle bin → purge permanently. Backend only
-- afterwards — the leftover rows are invisible, which is why nobody noticed them.
CREATE OR REPLACE FUNCTION admin_purge_restaurant(p_rid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r restaurants%rowtype;
begin
  select * into r from restaurants where id = p_rid for update;
  if not found then raise exception 'Restaurant % not found', p_rid; end if;
  if p_rid = '00000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'The default restaurant can never be purged';
  end if;
  if r.deleted_at is null then
    raise exception 'Restaurant is not in the recycle bin — delete it first';
  end if;
  if now() < r.deleted_at + interval '90 days' then
    raise exception 'Retention lock: this restaurant cannot be purged until 90 days after deletion (deleted_at=%)', r.deleted_at;
  end if;
  if r.purged_at is not null then
    raise exception 'This restaurant has already been purged (purged_at=%) — its bills are kept on purpose', r.purged_at;
  end if;

  -- THE MONEY IS NOT TOUCHED (owner, 2026-08-11 — "keep bills forever, purge only the rest").
  -- Deliberately NOT deleted here, and the `lfh.allow_purge` escape hatch is NOT opened, so mig
  -- 190's immutability trigger still stands guard over every one of them:
  --   orders · order_items · sessions · payments · session_payments · credit_notes
  --   invoice_events · deletion_audit · daily_counters · seq_counters
  -- Everything below is operational: it describes how the restaurant RAN, not what it SOLD.
  delete from aggregator_orders where restaurant_id = p_rid;
  delete from feedback         where restaurant_id = p_rid;
  delete from reviews          where restaurant_id = p_rid;
  delete from waiter_calls     where restaurant_id = p_rid;
  delete from requests         where restaurant_id = p_rid;
  delete from session_members  where restaurant_id = p_rid;
  delete from menu_items       where restaurant_id = p_rid;
  delete from categories       where restaurant_id = p_rid;
  delete from filters          where restaurant_id = p_rid;
  delete from customers        where restaurant_id = p_rid;
  delete from blocklist        where restaurant_id = p_rid;
  delete from otp_codes        where restaurant_id = p_rid;
  delete from verification_codes where restaurant_id = p_rid;
  delete from staff_actions    where restaurant_id = p_rid;   -- the working log; the AUDIT stays
  delete from realtime_events  where restaurant_id = p_rid;
  delete from restaurant_owners   where restaurant_id = p_rid;
  delete from restaurant_payments where restaurant_id = p_rid;
  delete from restaurant_billing  where restaurant_id = p_rid;
  delete from issues              where restaurant_id = p_rid;
  update restaurants set owner_user_id = null where id = p_rid;
  delete from staff_users where restaurant_id = p_rid;
  delete from settings    where restaurant_id = p_rid;
  -- ── the operational tables that used to go with the restaurants ROW (T16 finding 7523) ──────
  -- Migration 190's purge ended with `delete from restaurants`, so every table declaring
  -- `restaurant_id … REFERENCES restaurants(id) ON DELETE CASCADE` was cleared for free and none of
  -- them was ever named here. Mig 309 stopped deleting that row (the kept bills hang off it), so the
  -- cascade never fires any more and 20+ tables survived a purge — the whole inventory book, printer
  -- history, QR codes and guest contact data. Named explicitly now.
  -- Child-before-parent order matters: item_id on movements/waste/count_lines is NOT a cascade.
  delete from inv_recipe_lines    where restaurant_id = p_rid;
  delete from inv_movements       where restaurant_id = p_rid;
  delete from inv_waste_entries   where restaurant_id = p_rid;
  delete from inv_count_lines     where restaurant_id = p_rid;
  delete from inv_purchase_lines  where restaurant_id = p_rid;
  delete from inv_counts          where restaurant_id = p_rid;
  delete from inv_purchases       where restaurant_id = p_rid;
  delete from inv_items           where restaurant_id = p_rid;
  delete from inv_vendors         where restaurant_id = p_rid;
  delete from expenses            where restaurant_id = p_rid;
  delete from printer_events      where restaurant_id = p_rid;
  delete from print_jobs          where restaurant_id = p_rid;
  delete from table_qr_codes      where restaurant_id = p_rid;
  delete from table_tags          where restaurant_id = p_rid;
  delete from error_signatures    where restaurant_id = p_rid;
  delete from rate_limit_rules    where restaurant_id = p_rid;
  delete from rate_limit_counters where restaurant_id = p_rid;
  delete from rate_limit_events   where restaurant_id = p_rid;
  delete from customer_visits     where restaurant_id = p_rid;   -- guest phones: `customers` is
  delete from customer_devices    where restaurant_id = p_rid;   -- already purged, these are copies
  delete from banquet_items       where restaurant_id = p_rid;   -- banquet CONFIG (bills are kept)
  delete from orders_change_watermark where restaurant_id = p_rid;
  --
  -- DELIBERATELY KEPT, and why:
  --   khata_customers — kept `orders.khata_customer_id` references it with no ON DELETE, so deleting
  --                     it would FAIL; the pay-later book belongs with the kept bills.
  --   table_merges    — the audit trail of who joined which tables (mig 249: never deleted).
  --   banquet_bills / session_payments / invoice_events / credit_notes / deletion_audit — money.
  --   staff_payments  — already gone: it cascades from staff_users, deleted above.

  -- The row STAYS, marked. It is what the kept bills hang off, and it is already out of every
  -- list in the product (deleted_at is set, which is the precondition for getting here at all).
  update restaurants set purged_at = now() where id = p_rid;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 6 · ONE JOINED PARTY, ONE TABLE NUMBER ON THE TICKET (finding 7787)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHERE THE RUNNER SEES IT: Kitchen → the ticket header. The guest path stamps the PHYSICAL table
-- and lets the SESSION follow the merge parent; these two stamped the parent on the order row too,
-- so one joined party showed two different numbers on the same board. The bill is unaffected: it is
-- the session that makes it one bill, and that still follows the parent.
CREATE OR REPLACE FUNCTION lfh_staff_move_order(p_order uuid, p_to text, p_rid uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_o      orders;
  v_from   text;
  v_to     text;
  v_src    sessions;      -- source session (may be absent: orders.session_id is nullable)
  v_target sessions;
BEGIN
  SELECT * INTO v_o FROM orders WHERE id = p_order AND restaurant_id = p_rid;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_order'); END IF;
  -- Never re-home a PAID order — it's settled revenue on a closed bill; moving it onto
  -- another party's live bill would double-count / corrupt the money trail.
  IF v_o.payment_status = 'paid' THEN RETURN json_build_object('ok', false, 'reason', 'order_paid'); END IF;
  IF p_to !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'reason', 'bad_table'); END IF;
  -- A JOINED TABLE MEANS ITS PARTY'S BILL (mig 264): sending a KOT "to table 29" while 29 is
  -- merged into 28 means the one bill those tables share. Resolving here is what stops the old
  -- behaviour — a brand-new second session inserted ON the joined table. Same-table covers both
  -- spellings: the KOT's own table, and any member of the party it already belongs to.
  v_to := lfh_merge_parent_table(p_rid, p_to);
  IF p_to = v_o.table_number OR v_to = lfh_merge_parent_table(p_rid, v_o.table_number) THEN
    RETURN json_build_object('ok', false, 'reason', 'same_table');
  END IF;
  v_from := v_o.table_number;

  -- Don't pull an order OFF a bill whose invoice is already generated (and not voided):
  -- the guest holds a printed invoice that would now overstate the total. Same rule for
  -- the target side below. A voided invoice never blocks (it's being re-billed anyway).
  IF v_o.session_id IS NOT NULL THEN
    SELECT * INTO v_src FROM sessions WHERE id = v_o.session_id AND restaurant_id = p_rid;
    IF FOUND AND v_src.invoice_no IS NOT NULL AND NOT COALESCE(v_src.invoice_voided, false) THEN
      RETURN json_build_object('ok', false, 'reason', 'source_invoiced');
    END IF;
  END IF;

  -- Find (or open) the target table's session, then re-home the order onto it.
  SELECT * INTO v_target FROM sessions
   WHERE table_number = v_to AND restaurant_id = p_rid AND status <> 'closed'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND AND v_target.invoice_no IS NOT NULL AND NOT COALESCE(v_target.invoice_voided, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'target_invoiced');
  END IF;
  IF NOT FOUND THEN
    INSERT INTO sessions (table_number, status, opened_by, opened_at, restaurant_id)
    VALUES (v_to, 'open', 'waiter', NOW(), p_rid)
    RETURNING * INTO v_target;
  END IF;

  -- (T16 7787) The order keeps the PHYSICAL table it was moved to; only the SESSION follows the
  -- merge parent, which is what makes it one bill. Writing v_to here sent the kitchen ticket to
  -- the parent's number while the guest path (lfh_place_order_public) keeps the child's, so one
  -- joined party showed two different table numbers on the same board.
  UPDATE orders      SET table_number = p_to, session_id = v_target.id WHERE id = p_order;
  UPDATE order_items SET session_id = v_target.id WHERE order_id = p_order;

  -- The target now has an order, so make sure it has a bill number (the bill trigger
  -- only fires on session INSERT, not on this move — assign it if missing).
  IF v_target.bill_no IS NULL THEN
    UPDATE sessions SET bill_no = lfh_next_counter(p_rid, 'bill')
     WHERE id = v_target.id AND bill_no IS NULL;
  END IF;

  -- Re-split each side's whole-bill discount over its (new) set of orders.
  IF v_src.id IS NOT NULL THEN PERFORM lfh_split_bill_discount(v_src.id); END IF;
  PERFORM lfh_split_bill_discount(v_target.id);

  -- Nudge BOTH table topics (guests) AND BOTH tables on 'ops' (staff panels' targeted
  -- refetch) so the OLD table's ticket disappears and the NEW table's appears — the
  -- mig-096 four-row pattern.
  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id) VALUES
    ('table:' || v_from, 'order', p_order::text, v_from, p_rid),
    ('table:' || v_to,   'order', p_order::text, v_to,   p_rid),
    ('ops',              'order', p_order::text, v_to,   p_rid),
    ('ops',              'order', p_order::text, v_from, p_rid);

  RETURN json_build_object('ok', true, 'from', v_from, 'to', p_to, 'parent_table', v_to, 'target_session', v_target.id);
END; $$;

CREATE OR REPLACE FUNCTION lfh_staff_move_order_item(p_item uuid, p_to text, p_rid uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item   order_items;
  v_order  orders;        -- source order (the KOT the line leaves)
  v_src    sessions;      -- source session
  v_target sessions;
  v_new    orders;        -- fresh order (new KOT) on the target
  v_from   text;
  v_to     text;
  v_left   int;
BEGIN
  SELECT * INTO v_item FROM order_items WHERE id = p_item AND restaurant_id = p_rid;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'item_not_found'); END IF;
  SELECT * INTO v_order FROM orders WHERE id = v_item.order_id AND restaurant_id = p_rid;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'order_not_found'); END IF;
  IF v_order.payment_status = 'paid' THEN RETURN json_build_object('ok', false, 'reason', 'order_paid'); END IF;
  IF v_order.status = 'cancelled' THEN RETURN json_build_object('ok', false, 'reason', 'order_cancelled'); END IF;
  IF p_to !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'reason', 'bad_table'); END IF;
  -- A JOINED TABLE MEANS ITS PARTY'S BILL (mig 264) — see lfh_staff_move_order above.
  v_to := lfh_merge_parent_table(p_rid, p_to);
  IF p_to = v_order.table_number OR v_to = lfh_merge_parent_table(p_rid, v_order.table_number) THEN
    RETURN json_build_object('ok', false, 'reason', 'same_table');
  END IF;
  v_from := v_order.table_number;

  -- Printed-invoice locks on either side (a live invoice total must never drift).
  IF v_order.session_id IS NOT NULL THEN
    SELECT * INTO v_src FROM sessions WHERE id = v_order.session_id AND restaurant_id = p_rid;
    IF FOUND AND v_src.invoice_no IS NOT NULL AND NOT COALESCE(v_src.invoice_voided, false) THEN
      RETURN json_build_object('ok', false, 'reason', 'source_invoiced');
    END IF;
  END IF;
  SELECT * INTO v_target FROM sessions
   WHERE table_number = v_to AND restaurant_id = p_rid AND status <> 'closed'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND AND v_target.invoice_no IS NOT NULL AND NOT COALESCE(v_target.invoice_voided, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'target_invoiced');
  END IF;
  IF NOT FOUND THEN
    INSERT INTO sessions (table_number, status, opened_by, opened_at, restaurant_id)
    VALUES (v_to, 'open', 'waiter', NOW(), p_rid)
    RETURNING * INTO v_target;
  END IF;

  -- Fresh order = fresh KOT number (assigned by the orders INSERT trigger). Its real
  -- totals/status/items-json all come from lfh_reprice_order right after the move.
  -- (T16 7787) the new ticket carries the PHYSICAL table (p_to), not the merge parent — see
  -- lfh_staff_move_order for why.
  INSERT INTO orders (session_id, table_number, status, payment_status, items, subtotal, tax, total, restaurant_id)
  VALUES (v_target.id, p_to,
          CASE WHEN v_item.status = 'served' THEN 'served'
               WHEN v_item.status IN ('preparing', 'ready') THEN 'preparing'
               ELSE 'received' END,
          'unpaid', '[]'::jsonb, 0, 0, 0, p_rid)
  RETURNING * INTO v_new;

  UPDATE order_items SET order_id = v_new.id, session_id = v_target.id WHERE id = p_item;

  -- Source: reprice the survivors, or cancel the KOT if the moved line was its last
  -- dish (lfh_reprice_order alone would leave a ₹0 'received' ghost on the bill).
  SELECT COUNT(*) INTO v_left FROM order_items WHERE order_id = v_order.id;
  IF v_left = 0 THEN
    UPDATE orders SET status = 'cancelled', subtotal = 0, tax = 0, total = 0, items = '[]'::jsonb
     WHERE id = v_order.id;
  ELSE
    PERFORM lfh_reprice_order(v_order.id);
    UPDATE orders SET edited_at = NOW() WHERE id = v_order.id;  -- ✎ Edited badge: staff re-check the shrunk ticket
  END IF;
  PERFORM lfh_reprice_order(v_new.id);

  -- The target now bills something — make sure it has a bill number (INSERT-only trigger).
  IF v_target.bill_no IS NULL THEN
    UPDATE sessions SET bill_no = lfh_next_counter(p_rid, 'bill')
     WHERE id = v_target.id AND bill_no IS NULL;
  END IF;

  -- mig-096 four-row breadcrumb pattern: both tables, guests + staff ops.
  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id) VALUES
    ('table:' || v_from, 'order', v_new.id::text, v_from, p_rid),
    ('table:' || v_to,   'order', v_new.id::text, v_to,   p_rid),
    ('ops',              'order', v_new.id::text, v_to,   p_rid),
    ('ops',              'order', v_new.id::text, v_from, p_rid);

  RETURN json_build_object('ok', true, 'from', v_from, 'to', p_to, 'parent_table', v_to,
                           'new_order', v_new.id, 'source_cancelled', v_left = 0,
                           'target_session', v_target.id);
END; $$;


-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 7 · A WAITER IS NEVER TOLD "SENT" FOR AN ORDER THE DATABASE JUST VOIDED (finding 7830)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.lfh_staff_place_order(p_table text, p_items jsonb, p_allergies text[], p_note text, p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid, p_confirm_duplicate boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid   uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_s     sessions; v_order uuid; v_kot int; v_item jsonb; v_priced jsonb;
  v_sig   text; v_alg text;
BEGIN
  -- (1) Serialize concurrent placements on the SAME table for this restaurant. A
  -- transaction-scoped advisory lock: a near-simultaneous second request waits here until
  -- the first commits, so it can reuse the now-open session (no unique violation → no 500)
  -- and see the first order in the dedup check below.
  PERFORM pg_advisory_xact_lock(hashtextextended('lfh_place:' || v_rid::text || ':' || COALESCE(p_table, ''), 0));

  -- Same money math as guest orders, scoped to THIS restaurant's menu (mig 118).
  v_priced := lfh_price_order(p_items, v_rid);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;

  -- (2) Atomic double-tap guard (unless the waiter already confirmed "send anyway").
  -- Signature = sorted per-item (id:qty:options) of the PRICED items (lfh_price_order emits
  -- 'id' + 'options'), plus the sorted order-level allergies. Compared against a
  -- non-cancelled, non-deleted order on this table from the last 3 seconds.
  v_sig := (SELECT string_agg(
              (e->>'id') || ':' || (e->>'qty') || ':' ||
              CASE WHEN jsonb_typeof(e->'options') = 'array'
                   THEN COALESCE((SELECT string_agg((op->>'group') || '/' || (op->>'label'), ','
                                  ORDER BY (op->>'group') || '/' || (op->>'label'))
                                  FROM jsonb_array_elements(e->'options') op), '')
                   ELSE '' END,
              '|' ORDER BY (e->>'id') || ':' || (e->>'qty'))
            FROM jsonb_array_elements(v_priced->'items') e);
  v_alg := (SELECT string_agg(a, ',' ORDER BY a) FROM unnest(COALESCE(p_allergies, '{}'::text[])) a);
  IF NOT COALESCE(p_confirm_duplicate, false) THEN
    IF EXISTS (
      SELECT 1 FROM orders o
      WHERE o.table_number = p_table AND o.restaurant_id = v_rid
        AND o.status <> 'cancelled' AND o.deleted_at IS NULL
        AND o.created_at >= now() - interval '3 seconds'
        AND jsonb_typeof(o.items) = 'array'   -- only array-shaped orders can match (old/scalar rows skipped)
        AND (SELECT string_agg(
               (e->>'id') || ':' || (e->>'qty') || ':' ||
               CASE WHEN jsonb_typeof(e->'options') = 'array'
                    THEN COALESCE((SELECT string_agg((op->>'group') || '/' || (op->>'label'), ','
                                   ORDER BY (op->>'group') || '/' || (op->>'label'))
                                   FROM jsonb_array_elements(e->'options') op), '')
                    ELSE '' END,
               '|' ORDER BY (e->>'id') || ':' || (e->>'qty'))
             FROM jsonb_array_elements(o.items) e) IS NOT DISTINCT FROM v_sig
        AND (SELECT string_agg(a, ',' ORDER BY a) FROM unnest(COALESCE(o.allergies, '{}'::text[])) a)
            IS NOT DISTINCT FROM v_alg
    ) THEN
      RETURN json_build_object('ok', false, 'duplicateWarning', true,
        'error', 'This looks identical to an order just sent for this table.');
    END IF;
  END IF;

  -- The table's open session FOR THIS RESTAURANT, or OPEN ONE NOW so the order is
  -- never an orphan. (Another restaurant's open "table 1" must never be reused.)
  -- A MERGED TABLE ORDERS ONTO THE PARTY IT WAS JOINED TO (owner, 2026-08-01, mig 249: he chose
  -- "let them order, it joins the same bill"). A waiter standing at table 7 while 7 is merged into
  -- 6 must be able to add a dish without walking to 6, and that dish belongs on the ONE bill. The
  -- order still records table_number = p_table below, so the KOT prints for table 7 and an unmerge
  -- can hand it back exactly. Without this, ordering at 7 would open a SECOND party on 7 and
  -- silently split the bill the merge just joined.
  SELECT * INTO v_s FROM sessions
    WHERE table_number = lfh_merge_parent_table(v_rid, p_table)
      AND status = 'open' AND restaurant_id = v_rid
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

  -- (T16 7830) trg_order_joins_closed_session (mig 302) archives + cancels an order whose session
  -- closed between the lookup above and this INSERT — correctly: the order must be RECORDED and must
  -- not appear as the next party's food. But this function still answered ok:true with a KOT number,
  -- so a waiter was told "sent", tore off a ticket, and the kitchen never saw it. Read the row back
  -- and refuse with the SAME code the guest path returns, so the panel can say why (a code, never
  -- prose — the tap-never-vanishes rule).
  IF EXISTS (SELECT 1 FROM orders o WHERE o.id = v_order AND (o.archived OR o.status = 'cancelled')) THEN
    RETURN json_build_object('ok', false, 'reason', 'session_closed',
      'error', 'That table was closed a moment ago — the order was not sent. Open the table again and re-send.');
  END IF;

  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'order_id', v_order, 'kot_no', v_kot);
END; $function$;


-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 8 · RE-ASSERT THE LOCKS (the migration-038 rule, restated after every recreate)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CREATE OR REPLACE keeps a function's existing ACL, so nothing above widened anything. Saying it
-- out loud is what catches the day a signature changes — a NEW signature is a NEW function, and a
-- new function is PUBLIC-executable by default (the migration-038 gotcha). None of these is a
-- guest door; lfh_bump_orders_watermark is a TRIGGER function and needs no EXECUTE grant at all.
REVOKE ALL ON FUNCTION public.lfh_owner_payment_breakdown(uuid, timestamptz, timestamptz, uuid[])        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lfh_owner_restaurant_revenue(timestamptz, timestamptz, uuid[])             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lfh_owner_revenue_timeseries(uuid, timestamptz, timestamptz, text, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lfh_table_view_summary(uuid, text)                                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lfh_bump_orders_watermark()                                                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_purge_restaurant(uuid)                                                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_staff_move_order(uuid, text, uuid)                                            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_staff_move_order_item(uuid, text, uuid)                                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lfh_staff_place_order(text, jsonb, text[], text, uuid, boolean)            FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.lfh_owner_payment_breakdown(uuid, timestamptz, timestamptz, uuid[])        TO service_role;
GRANT EXECUTE ON FUNCTION public.lfh_owner_restaurant_revenue(timestamptz, timestamptz, uuid[])             TO service_role;
GRANT EXECUTE ON FUNCTION public.lfh_owner_revenue_timeseries(uuid, timestamptz, timestamptz, text, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.lfh_table_view_summary(uuid, text)                                         TO service_role;
GRANT EXECUTE ON FUNCTION admin_purge_restaurant(uuid)                                                      TO service_role;
GRANT EXECUTE ON FUNCTION lfh_staff_move_order(uuid, text, uuid)                                            TO service_role;
GRANT EXECUTE ON FUNCTION lfh_staff_move_order_item(uuid, text, uuid)                                       TO service_role;
GRANT EXECUTE ON FUNCTION public.lfh_staff_place_order(text, jsonb, text[], text, uuid, boolean)            TO service_role;

NOTIFY pgrst, 'reload schema';
