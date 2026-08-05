-- 299_cross_panel_truth_t13.sql
--
-- Four database-side findings from the T13 cross-panel sweep (2026-08-05). The theme of that sweep:
-- the breadcrumb layer is mature, and what breaks is a change that has to travel through something
-- OTHER than a breadcrumb — or a rendered column nobody added to a watch-list.
--
--   A · sessions.table_number joins the rt_emit watch-list   (which tile a party is on)
--   B · restaurants gets an access breadcrumb                (a permission change reaches an open panel)
--   C · unmerge's "parent gone" path stops going silent      (a stale "⇄ with T…" chip)
--   D · a bill settled in PARTS becomes reportable by method (so the owner can count the till)
--
-- All additive. No column dropped, no row deleted. D re-runs the nightly rollup, which is a full
-- rebuild by design (mig 211), so history is corrected in the same step.

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- A — sessions.table_number IS a rendered column, so it belongs in the watch-list
-- ═════════════════════════════════════════════════════════════════════════════
-- Mig 096 wrote the rule down: "every column a panel renders must be in the watch-list — a rendered
-- column the trigger ignores = a silent missed instant update". `table_number` is the single column
-- that decides WHICH TILE a party appears on, and it was the one rendered column still missing.
--
-- Ordinary service was never affected: lfh_staff_shift_table (mig 264) writes its own four
-- breadcrumbs for both the old and the new table. The watch-list is the safety net for everything
-- ELSE — a data repair, a hand-run SQL fix, a future code path that moves a party without going
-- through that RPC. Any of those published NOTHING, so the party showed on two tables at once on
-- every other device until the 60s backstop.
--
-- Cost: one extra breadcrumb pair on a shift, which already emits four. Nothing writes this column
-- in a loop. (cart / cart_updated_at stay OUT — own trigger, mig 109. last_activity_at stays out —
-- it is a heartbeat and watching it would wake every device on the floor.)
DROP TRIGGER IF EXISTS rt_emit_sessions ON sessions;
CREATE TRIGGER rt_emit_sessions
  AFTER INSERT OR DELETE OR UPDATE OF
    status, bill_no, invoice_no, auto_approve, invoice_voided, void_at,
    discount, discount_note, cust_name, cust_phone, deleted_at, closed_at,
    table_number
  ON sessions
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();


-- ═════════════════════════════════════════════════════════════════════════════
-- B — A PERMISSION CHANGE MUST REACH A PANEL THAT IS ALREADY OPEN
-- ═════════════════════════════════════════════════════════════════════════════
-- The admin's Access & permissions write lands in TWO tables
-- (app/api/admin/restaurants/access-tree/route.ts): `settings` and `restaurants`. `settings` has a
-- full-row rt_emit trigger, so that half already published. `restaurants` had NO trigger at all, so
-- the manager-powers half — manager_permissions, access_config, owner_entitlements — published
-- nothing whatsoever. Combined with the panels reading /whoami exactly once at boot, the owner could
-- ring the admin to take a power off a manager "right now", the admin did it, and the manager's open
-- screen kept offering the control until somebody reloaded the page. Nothing was ever exposed (every
-- gated endpoint refuses on its own, and requireRole re-checks the panel entitlement every 30s) —
-- but the screen disagreed with the truth, and the next tap died with an error, which is exactly
-- what the tap-never-vanishes rule exists to prevent.
--
-- WHY ITS OWN FUNCTION, NOT lfh_rt_emit: that function reads `r.restaurant_id`, and a `restaurants`
-- row has no such column — routing this table through it would raise inside the trigger and FAIL the
-- admin's save. Same reason lfh_rt_emit_cart (mig 109) and lfh_rt_emit_platform (mig 071) are separate.
--
-- WHY THE 'menu' TOPIC: all three staff panels already subscribe to it, and it is the cheap one. An
-- `ops` breadcrumb with no table_number means "reload the whole floor" on every open device — that is
-- exactly what mig 267 moved staff_actions OFF `ops` to avoid. Guests also listen to `menu` scoped to
-- their own restaurant, so they refetch their cached menu bundle once too; an access change is a rare,
-- deliberate admin action, so that is a fair price for every panel being correct.
CREATE OR REPLACE FUNCTION lfh_rt_emit_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rid uuid;
BEGIN
  v_rid := COALESCE(NEW.id, OLD.id);
  IF v_rid IS NOT NULL THEN
    INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id)
      VALUES ('menu', 'access', v_rid::text, NULL, v_rid);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION lfh_rt_emit_access() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_rt_emit_access() TO service_role;

DROP TRIGGER IF EXISTS rt_emit_access ON restaurants;
CREATE TRIGGER rt_emit_access
  AFTER UPDATE OF manager_permissions, access_config, owner_entitlements ON restaurants
  FOR EACH ROW
  WHEN (OLD.manager_permissions IS DISTINCT FROM NEW.manager_permissions
     OR OLD.access_config       IS DISTINCT FROM NEW.access_config
     OR OLD.owner_entitlements  IS DISTINCT FROM NEW.owner_entitlements)
  EXECUTE FUNCTION lfh_rt_emit_access();


-- ═════════════════════════════════════════════════════════════════════════════
-- C — ENDING A MERGE IS NEVER SILENT, INCLUDING THE "PARENT IS GONE" PATH
-- ═════════════════════════════════════════════════════════════════════════════
-- Body reproduced from mig 249 with ONE branch changed (nine added lines, nothing removed —
-- mechanically diffed before writing this file, so the v_kots guard, the discount re-spread and the
-- return shape are all exactly as they were).
CREATE OR REPLACE FUNCTION lfh_staff_unmerge_table(p_rid uuid, p_child text, p_actor text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_m        table_merges;
  v_parent   sessions;
  v_new      sessions;
  v_moved    int := 0;
  v_kots     text;
BEGIN
  SELECT * INTO v_m FROM table_merges
   WHERE restaurant_id = p_rid AND child_table = p_child AND ended_at IS NULL LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'not_merged'); END IF;

  SELECT * INTO v_parent FROM sessions WHERE id = v_m.session_id;
  IF NOT FOUND THEN
    -- the parent party is gone; the record is simply stale
    UPDATE table_merges SET ended_at = NOW(), ended_reason = 'session_closed' WHERE id = v_m.id;
    -- …AND SAY SO (mig 299). This branch was the one path out of this function that ended a merge
    -- silently: table_merges has no rt_emit trigger of its own, so a second device kept painting
    -- the "⇄ with T…" chip and kept drawing the child tile from a parent that no longer exists,
    -- until its 60s poll. The same four rows every other merge/unmerge path already writes.
    INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id) VALUES
      ('table:' || p_child,            'session', v_m.id::text, p_child,            p_rid),
      ('table:' || v_m.parent_table,   'session', v_m.id::text, v_m.parent_table,   p_rid),
      ('ops',                          'session', v_m.id::text, p_child,            p_rid),
      ('ops',                          'session', v_m.id::text, v_m.parent_table,   p_rid);
    RETURN json_build_object('ok', true, 'reason', 'parent_gone', 'moved', 0);
  END IF;
  -- A printed bill covers BOTH tables, so it has to be voided before the tables can be separated.
  IF v_parent.invoice_no IS NOT NULL AND NOT COALESCE(v_parent.invoice_voided, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'invoiced');
  END IF;

  SELECT string_agg(DISTINCT '#' || kot_no::text, ', ' ORDER BY '#' || kot_no::text) INTO v_kots
    FROM orders WHERE session_id = v_parent.id AND table_number = p_child
      AND NOT archived AND deleted_at IS NULL AND status <> 'cancelled';

  -- Only give the child a party of its own if it actually has food on it. Otherwise it just goes
  -- back to being free — never an open party with nothing on it (owner, 2026-08-01: a state no
  -- screen can show must not exist in the database either).
  IF v_kots IS NOT NULL THEN
    -- opened_by is CHECKed to ('waiter','guest') — 'staff' is refused, which a test caught before
    -- this shipped. A table separated by a member of staff is a waiter-opened party.
    INSERT INTO sessions(table_number, status, opened_by, opened_at, restaurant_id)
      VALUES (p_child, 'open', 'waiter', NOW(), p_rid) RETURNING * INTO v_new;
    UPDATE orders SET session_id = v_new.id
     WHERE session_id = v_parent.id AND table_number = p_child AND NOT archived AND deleted_at IS NULL;
    UPDATE order_items oi SET session_id = v_new.id
     WHERE oi.order_id IN (SELECT id FROM orders WHERE session_id = v_new.id);
    UPDATE waiter_calls SET session_id = v_new.id
     WHERE session_id = v_parent.id AND table_number = p_child AND NOT resolved;
    SELECT count(*) INTO v_moved FROM orders WHERE session_id = v_new.id;
    -- the parent's whole-bill discount is re-spread over what it still holds
    PERFORM lfh_split_bill_discount(v_parent.id);
    PERFORM lfh_split_bill_discount(v_new.id);
  END IF;

  UPDATE table_merges SET ended_at = NOW(), ended_reason = 'unmerged', ended_by = p_actor WHERE id = v_m.id;
  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_parent.id;

  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id) VALUES
    ('table:' || p_child,            'session', v_m.id::text, p_child,            p_rid),
    ('table:' || v_m.parent_table,   'session', v_m.id::text, v_m.parent_table,   p_rid),
    ('ops',                          'session', v_m.id::text, p_child,            p_rid),
    ('ops',                          'session', v_m.id::text, v_m.parent_table,   p_rid);

  RETURN json_build_object('ok', true, 'child', p_child, 'parent', v_m.parent_table,
                           'moved', v_moved, 'kots', v_kots);
END; $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- D — A BILL SETTLED IN PARTS MUST BE REPORTABLE BY METHOD
-- ═════════════════════════════════════════════════════════════════════════════
-- lib/paySplit.ts records each leg in `session_payments` WITH its own method, then stamps the orders
-- `payment_method = 'Split'`. Every owner-facing money-by-method figure came from
-- lfh_owner_payment_breakdown, which reads orders.payment_method — so a part-settled bill landed in a
-- single "Split" bucket, and NO owner report read session_payments at all. The manager's bill screen
-- said "₹500 cash · ₹300 card"; the owner's Payments report and day sheet said "Split ₹800", and the
-- day's CASH line — the number used to reconcile the drawer at closing — was ₹500 short with nothing
-- anywhere to explain the gap.
--
-- THE FIX: resolve a split order into the methods it was actually paid with, weighting by the leg
-- amounts. Reversed legs are excluded (mig 285: a leg is reversed, never erased, and anything
-- totalling collected money must filter on reversed_at IS NULL).
--
-- WHAT IS AND ISN'T PRESERVED, deliberately:
--   · TOTAL revenue for a day is UNCHANGED — the weights sum to 1 per session, so the money is
--     re-attributed between methods, never created or lost. Every consumer that sums ACROSS methods
--     (lfh_owner_overview, lfh_owner_restaurant_revenue, lfh_owner_revenue_timeseries) therefore
--     returns exactly what it returned before.
--   · The per-method CASH/CARD/UPI figures DO change, and that is the point: they become the money
--     actually taken in that form.
--   · The per-method ORDER COUNT is attributed to the LARGEST leg only, so a split bill is counted
--     once, not once per method — the total order count stays exact.
--   · A 'Split' order whose legs are all reversed, or which has no legs at all, falls back to
--     'Split'. Honest rather than invented.
--
-- One expression, used by BOTH the nightly rollup and the live tail, so the two halves of every
-- report can never disagree.
CREATE OR REPLACE FUNCTION public.lfh_refresh_orders_daily_agg()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target date := (now() AT TIME ZONE 'Asia/Kolkata')::date - 2;  -- keep 2 live days on top
BEGIN
  DELETE FROM public.orders_daily_agg;
  INSERT INTO public.orders_daily_agg (restaurant_id, day, method, gross_paid, disc_paid, paid_orders, all_orders)
  WITH legs AS (
    SELECT sp.session_id, sp.method, SUM(sp.amount) AS amt
      FROM public.session_payments sp
     WHERE sp.reversed_at IS NULL
     GROUP BY sp.session_id, sp.method
    HAVING SUM(sp.amount) > 0
  ),
  legw AS (
    SELECT session_id, method,
           amt / SUM(amt) OVER (PARTITION BY session_id) AS w,
           (ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY amt DESC, method) = 1) AS primary_leg
      FROM legs
  ),
  exp AS (
    SELECT o.restaurant_id,
           (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
           o.status, o.payment_status, o.total, o.discount,
           COALESCE(l.method, NULLIF(o.payment_method, ''), 'Not recorded') AS method,
           COALESCE(l.w, 1)             AS w,
           COALESCE(l.primary_leg, true) AS primary_leg
      FROM public.orders o
      LEFT JOIN legw l
        ON o.payment_method = 'Split' AND l.session_id = o.session_id
     WHERE (o.created_at AT TIME ZONE 'Asia/Kolkata')::date <= v_target
  )
  SELECT e.restaurant_id, e.day, e.method,
         COALESCE(SUM(e.total    * e.w) FILTER (WHERE e.status <> 'cancelled' AND e.payment_status = 'paid'), 0),
         COALESCE(SUM(e.discount * e.w) FILTER (WHERE e.status <> 'cancelled' AND e.payment_status = 'paid'), 0),
         COUNT(*) FILTER (WHERE e.status <> 'cancelled' AND e.payment_status = 'paid' AND e.primary_leg),
         COUNT(*) FILTER (WHERE e.status <> 'cancelled' AND e.primary_leg)
    FROM exp e
   GROUP BY 1, 2, 3
  -- NOT filtered on the primary-leg count: the non-primary method of a split carries real money and
  -- no count, and dropping it here is how the card half of every split bill would have vanished.
  HAVING COUNT(*) FILTER (WHERE e.status <> 'cancelled') > 0;

  UPDATE public.orders_daily_agg_state SET rolled_through = v_target WHERE only_one;
END;
$function$;
REVOKE ALL ON FUNCTION public.lfh_refresh_orders_daily_agg() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_refresh_orders_daily_agg() TO service_role;

-- The live tail (the 2 unfrozen days) gets the SAME expansion, or today's splits would still read as
-- one "Split" lump while yesterday's were correct.
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
    SELECT a.restaurant_id, a.method, SUM(a.gross_paid) gp, SUM(a.disc_paid) dp, SUM(a.paid_orders) po
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
           COUNT(*) FILTER (WHERE COALESCE(l.primary_leg, true)) po
    FROM orders o
    LEFT JOIN legw l ON o.payment_method = 'Split' AND l.session_id = o.session_id
    WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
      AND o.created_at >= (SELECT tail_start FROM wm)
      AND o.created_at >= p_from AND o.created_at < p_to
      AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
      AND (p_ids IS NULL OR o.restaurant_id = ANY (p_ids))
    GROUP BY o.restaurant_id, COALESCE(l.method, NULLIF(o.payment_method, ''), 'Not recorded')
  ),
  comb AS (
    SELECT restaurant_id, method, SUM(gp) gp, SUM(dp) dp, SUM(po) po
    FROM (SELECT * FROM hist UNION ALL SELECT * FROM tail) u
    GROUP BY restaurant_id, method
  )
  SELECT c.method,
    COALESCE(SUM(c.gp - (1 + rt.rate) * c.dp), 0)::numeric AS revenue,
    SUM(c.po)::bigint AS orders
  FROM comb c JOIN rates rt ON rt.rid = c.restaurant_id
  GROUP BY c.method
  -- was `HAVING SUM(c.po) > 0` — which would hide the non-primary method of every split bill, the
  -- exact money this migration exists to surface. A method with real money and no order count is a
  -- legitimate answer now.
  HAVING SUM(c.po) > 0 OR SUM(c.gp) <> 0
  ORDER BY revenue DESC;
$function$;
REVOKE ALL ON FUNCTION public.lfh_owner_payment_breakdown(uuid, timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_payment_breakdown(uuid, timestamptz, timestamptz, uuid[]) TO service_role;

-- Rebuild the rollup now, so the split legs are reflected in history immediately instead of at the
-- next nightly run (mig 211 does the same after changing this function).
SELECT public.lfh_refresh_orders_daily_agg();

COMMIT;

NOTIFY pgrst, 'reload schema';
