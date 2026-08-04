-- 266 · lfh_owner_overview: the HISTORY pass must respect the caller's scope
--
-- Found by the 2026-08-04 owner-panel sweep. The route already does the right thing —
-- app/api/owner/overview/route.ts passes the owner's restaurant ids as `p_ids` so the
-- aggregation happens IN the database rather than summing the platform and throwing most of
-- it away in JS (mig 138's fix). But inside the function only TWO of the four CTEs honoured
-- that list:
--
--     tail  → filtered by p_ids  ✔
--     sess  → filtered by p_ids  ✔
--     hist  → NO filter          ✘  grouped orders_daily_agg for EVERY restaurant
--     rates → NO filter          ✘  called lfh_effective_tax_rate() for EVERY restaurant
--
-- So one owner opening their dashboard re-aggregated the whole platform's rollup and computed
-- a tax rate per restaurant on the entire `restaurants` table. It reads the pre-aggregated
-- rollup (not raw `orders`), so it is cheap TODAY — but the cost grows with
-- tenants × days instead of with the owner's own estate, and this endpoint is polled every
-- 60s by every open owner tab (the shell sidebar + the dashboard, shared for 8s by
-- lib/ownerOverviewCache.ts). That is the wrong direction for the one query the owner's
-- headline numbers depend on.
--
-- THE CHANGE IS EXACTLY TWO `WHERE` CLAUSES. Everything else is the body as it stands in the
-- database TODAY — deliberately captured with pg_get_functiondef() rather than copied from
-- migration 190, because the live version has since gained the khata payment-date
-- attribution (`CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at
-- ELSE o.created_at END`) that 190 never had. Re-creating from the old text would have
-- silently reverted it — the documented "a migration that recreates a function reverts a
-- later fix" trap.
--
-- Output is unchanged for every caller: `hist`/`rates` were only ever consumed through a
-- LEFT JOIN / JOIN on `r.id`, and the final SELECT already filters `r.id = ANY(p_ids)`, so
-- the extra rows were computed and then discarded. Verified row-for-row against the previous
-- definition for a single-restaurant scope, a multi-restaurant scope and NULL (admin all).

CREATE OR REPLACE FUNCTION public.lfh_owner_overview(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(restaurant_id uuid, slug text, name text, active boolean, accent_color text, orders_today bigint, revenue_today numeric, orders_all bigint, revenue_all numeric, open_tables bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH
  -- + p_ids: don't compute a tax rate for restaurants this caller will never see.
  rates AS MATERIALIZED (
    SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate
    FROM restaurants r
    WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
  ),
  wm AS (SELECT rolled_through, ((rolled_through + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS tail_start FROM orders_daily_agg_state),
  day_start AS (
    SELECT (((now() AT TIME ZONE 'Asia/Kolkata') - interval '5 hours')::date
            + interval '5 hours') AT TIME ZONE 'Asia/Kolkata' AS ts
  ),
  hist AS (
    SELECT a.restaurant_id, SUM(a.gross_paid) gp, SUM(a.disc_paid) dp, SUM(a.all_orders) ao
    FROM orders_daily_agg a
    WHERE a.day <= (SELECT rolled_through FROM wm)
      -- + p_ids: the sibling `tail` and `sess` CTEs always had this; `hist` never did.
      AND (p_ids IS NULL OR a.restaurant_id = ANY(p_ids))
    GROUP BY a.restaurant_id
  ),
  tail AS (
    SELECT o.restaurant_id,
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) gp_all,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dp_all,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled') ao_all,
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
        AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)), 0) gp_today,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
        AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)), 0) dp_today,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled'
        AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)) ao_today
    FROM orders o
    WHERE (o.created_at >= (SELECT tail_start FROM wm)
           OR (o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL AND o.paid_at >= (SELECT tail_start FROM wm)))
      AND (p_ids IS NULL OR o.restaurant_id = ANY(p_ids))
    GROUP BY o.restaurant_id
  ),
  sess AS (
    SELECT s.restaurant_id, COUNT(*) AS open_tables
    FROM sessions s
    WHERE s.status = 'open' AND (p_ids IS NULL OR s.restaurant_id = ANY(p_ids))
    GROUP BY s.restaurant_id
  )
  SELECT
    r.id, r.slug, r.name, r.active, r.accent_color,
    COALESCE(t.ao_today, 0)::bigint,
    (COALESCE(t.gp_today, 0) - (1 + rt.rate) * COALESCE(t.dp_today, 0))::numeric,
    (COALESCE(h.ao, 0) + COALESCE(t.ao_all, 0))::bigint,
    ((COALESCE(h.gp, 0) + COALESCE(t.gp_all, 0)) - (1 + rt.rate) * (COALESCE(h.dp, 0) + COALESCE(t.dp_all, 0)))::numeric,
    COALESCE(sess.open_tables, 0)::bigint
  FROM restaurants r
  JOIN rates rt ON rt.rid = r.id
  LEFT JOIN hist h ON h.restaurant_id = r.id
  LEFT JOIN tail t ON t.restaurant_id = r.id
  LEFT JOIN sess ON sess.restaurant_id = r.id
  WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
  ORDER BY r.name;
$function$;

-- Keep the work_mem grant mig 190/192 set (CREATE OR REPLACE preserves settings, but be explicit).
ALTER FUNCTION public.lfh_owner_overview(uuid[]) SET work_mem = '128MB';

-- Staff-only, like every other lfh_owner_* aggregate (the mig-038 rule: a new/replaced
-- function is PUBLIC-executable by default).
REVOKE ALL ON FUNCTION public.lfh_owner_overview(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_overview(uuid[]) TO service_role;
