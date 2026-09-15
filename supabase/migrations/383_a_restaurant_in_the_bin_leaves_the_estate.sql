-- 383 — a restaurant in the recycle bin leaves the owner's estate view
-- (sweep #9, terminal 30, item 3 — migrations 079–154)
--
-- WHAT WAS WRONG, measured through the real gate on the dev stack 2026-09-15:
--   GET /api/owner/overview?scope=all — the whole-platform owner view the ADMIN opens — answered
--   with 177 restaurant rows. Fifty restaurants exist. The other ONE HUNDRED AND TWENTY-SEVEN had
--   been put in the recycle bin, and they came back with their money:
--
--     totals.restaurantCount   177   (should be 50)
--     all-time revenue folded in from binned restaurants   ₹7,30,621.50
--     ₹7,30,411.50 of that from ONE removed restaurant, OG'S CAFE
--
--   The route reduces `totals` over every row it is handed (app/api/owner/overview/route.ts), so
--   the estate headline counted removed restaurants and added up their takings.
--
-- WHY THE RECYCLE BIN SAYS IT SHOULD NOT:
--   Migration 128 created `restaurants.deleted_at / deleted_by / delete_reason` precisely so a
--   removed restaurant leaves the live views and lives on ONE screen — the admin's Recycle bin,
--   which reads `restaurants` directly and is untouched by this file. `lfh_admin_busiest_restaurants`
--   (mig 135) and `lfh_admin_restaurant_health` (mig 149) both carry `r.deleted_at IS NULL` for
--   exactly this reason. `lfh_owner_overview` — created in migration 088, before the bin existed,
--   and rewritten six times since (121, 126, 140, 155, 310, 315) — never gained it.
--
-- ⚠️ THIS IS NOT THE DELETED-BILL RULE, AND IT MUST NOT BE READ AS ONE.
--   docs/COMPLIANCE-GUARDRAILS.md §4 requires the owner's revenue to INCLUDE soft-deleted (binned)
--   BILLS: "Z-report / dashboards must include voids and deleted bills", and migration 309 states
--   the asymmetry — what is OWED drops a deleted bill, what was COLLECTED keeps it. That is
--   `orders.deleted_at`, a different column on a different table, and nothing here touches it. A
--   live restaurant's figures are byte-for-byte what they were. What changes is only WHICH
--   RESTAURANTS appear: a restaurant the admin removed is no longer one of them.
--   Sweep #10: do not "fix" this back. The bills rule and the restaurants rule are not the same rule.
--
-- HOW: the live body (pg_get_functiondef, 2026-09-15) with `AND r.deleted_at IS NULL` added in the
-- two places that bound the restaurant list — the `rates` CTE, so no tax rate is computed for a
-- restaurant nobody will see, and the final SELECT, which is the row actually returned. Built from
-- the LIVE definition rather than from an older migration copy, per this folder's own standing
-- lesson ("a migration recreate reverts a fix"); migration 155 says the same in its header.
--
-- COST: strictly less work than before — 127 fewer rate computations and 127 fewer rows.
-- `lib/ownerScope.ts` → `scopedRestaurantIds()` is fixed in the same change so the id list itself
-- stops carrying binned restaurants; this filter is the backstop, because the SaaS rule in
-- CLAUDE.md is that the business rule lives in the RPC, never in app-code filtering alone.
--
-- Guarded by `npm run verify:binned-restaurant-leaves`.

CREATE OR REPLACE FUNCTION public.lfh_owner_overview(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(restaurant_id uuid, slug text, name text, active boolean, accent_color text, orders_today bigint, revenue_today numeric, orders_all bigint, revenue_all numeric, open_tables bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '128MB'
AS $function$
  WITH
  -- + p_ids: don't compute a tax rate for restaurants this caller will never see.
  rates AS MATERIALIZED (
    SELECT r.id AS rid, lfh_effective_tax_rate(r.id) AS rate
    FROM restaurants r
    WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
      AND r.deleted_at IS NULL          -- (382/383) a restaurant in the recycle bin is not an estate row
  ),
  wm AS (SELECT rolled_through, ((rolled_through + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS tail_start FROM orders_daily_agg_state),
  day_start AS (
    SELECT (((now() AT TIME ZONE 'Asia/Kolkata') - interval '5 hours')::date
            + interval '5 hours') AT TIME ZONE 'Asia/Kolkata' AS ts
  ),
  hist AS (
    SELECT a.restaurant_id, SUM(a.gross_paid) gp, SUM(a.disc_paid) dp,
           -- (315) the stored net. COALESCEd for a rollup row written before the column existed,
           -- which is the only way this can differ from the line below it.
           SUM(COALESCE(a.net_paid, a.gross_paid - COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id))))) net,
           SUM(COALESCE(a.disc_gross_paid, a.disc_paid * (1 + lfh_effective_tax_rate(a.restaurant_id)))) dpg,
           SUM(a.all_orders) ao
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
      COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) dpg_all,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0) net_all,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled') ao_all,
      COALESCE(SUM(o.total)    FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
        AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)), 0) gp_today,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
        AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)), 0) dp_today,
      COALESCE(SUM(o.disc_gross) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
        AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)), 0) dpg_today,
           COALESCE(SUM(o.net_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
             AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= (SELECT ts FROM day_start)), 0) net_today,
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
    -- (315) one stored net, instead of subtracting two stored columns from each other.
    COALESCE(t.net_today, 0)::numeric,
    (COALESCE(h.ao, 0) + COALESCE(t.ao_all, 0))::bigint,
    (COALESCE(h.net, 0) + COALESCE(t.net_all, 0))::numeric,
    COALESCE(sess.open_tables, 0)::bigint
  FROM restaurants r
  JOIN rates rt ON rt.rid = r.id
  LEFT JOIN hist h ON h.restaurant_id = r.id
  LEFT JOIN tail t ON t.restaurant_id = r.id
  LEFT JOIN sess ON sess.restaurant_id = r.id
  WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
    AND r.deleted_at IS NULL            -- (383) same rule on the row that is actually returned
  ORDER BY r.name;
$function$
;

-- CREATE OR REPLACE keeps the existing GRANTs, but a fresh database running this file ALONE must
-- still lock the function down — new functions are PUBLIC-executable by default (the mig 038/267
-- lesson, and `verify:grants` will say so).
REVOKE ALL ON FUNCTION public.lfh_owner_overview(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_overview(uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
