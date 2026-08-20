-- 348_the_platform_count_ignores_a_binned_restaurant.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- THE LIST UNDER THE NUMBER DID NOT ADD UP TO THE NUMBER (T18 sweep handoff H2, approved by the
-- owner 2026-08-20: "it should count recycle one … recycle one is not in execution, only like
-- deleted, just info is there" — a binned restaurant is a record, not a working restaurant, so
-- the platform's operational counts must not include it).
--
-- ⚠ MIGRATION NUMBER: 346 and 347 were skipped on purpose — TWO other sessions each had an
--   uncommitted 346 on disk at the time this was written (`346_usage_and_cost_answers_for_any_window`
--   and `346_a_purge_clears_the_printing_setup`), and `verify:db-parity` fails on a duplicated
--   number. This file is plain CREATE OR REPLACE + one new function, so it is correct at any number.
--
-- WHERE THE OWNER SEES IT: admin console → Platform analytics → the "ORDERS · LAST 30 DAYS" tile,
-- measured against the Busiest restaurants table right below it · and admin console → Dashboard →
-- the "Orders today" card, which links to that same page.
--
-- MEASURED ON THE DEV DATABASE BEFORE WRITING THIS (2026-08-20):
--   · 17 restaurants, 9 live, 8 in the recycle bin.
--   · Orders in the last 30 days: 6,260 counted, 6,116 belonging to a live restaurant.
--   · So 144 orders belong to binned restaurants and could not be reconciled with anything on
--     the page. Today and this week happened to agree, which is what kept it quiet.
--
-- WHY THE HALF-FIX WAS THERE ALREADY. `lfh_admin_busiest_restaurants` got its `deleted_at` guard
-- in migration 135, for exactly this reason ("a binned restaurant still surfaced with its
-- pre-deletion orders"), and app/api/admin/analytics/route.ts filters tables, staff and the
-- occupancy denominator through a live-restaurant set. The three cross-restaurant ORDER reads were
-- simply never given the same guard: the total, the trend chart and the by-source breakdown.
--
-- ALL THREE ARE FIXED TOGETHER ON PURPOSE. Fixing only the total would have left the trend chart
-- and the source breakdown adding up to a different number than the tile above them — the same
-- fault wearing new clothes.
--
-- NOT ONE ROW IS TOUCHED OR HIDDEN. A binned restaurant's orders stay exactly where they are and
-- come straight back with it if it is restored (the recycle bin is reversible, mig 128). This
-- changes only which rows the PLATFORM'S OPERATIONAL counters look at. The billing guardrail is
-- untouched: no sale is erased, no bill is edited, and the restaurant's own owner-panel figures —
-- which are scoped per restaurant — read exactly what they read before.
--
-- COST. Cheaper, not dearer: `idx_orders_created_covering (created_at) INCLUDE (restaurant_id,
-- status, payment_status)` already exists, so the count stays an index-only scan and the live-id
-- set is one hashed subquery on a 17-row table, evaluated once. `SELECT id FROM restaurants WHERE
-- deleted_at IS NULL` is used rather than a join so that covering index keeps being usable.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- ── 1. THE COUNT — one definition, shared by the tile and the Dashboard card ─────────────────
-- Written as its own function rather than an `.in("restaurant_id", [...])` on the route, for three
-- reasons: the two callers cannot drift; the live-id test happens next to the data instead of
-- travelling to the server and back as a URL; and it is the SAME shape as
-- lfh_admin_busiest_restaurants above it, so the tile and the list under it agree by construction
-- rather than by two people remembering the same rule.
CREATE OR REPLACE FUNCTION public.lfh_admin_orders_count(
  p_from timestamptz,
  p_to   timestamptz
) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT COUNT(*)::bigint
  FROM orders o
  WHERE o.created_at >= p_from AND o.created_at < p_to
    AND o.status <> 'cancelled'
    -- The same population lfh_admin_busiest_restaurants sums. An order whose restaurant_id is
    -- NULL is excluded here too, because that RPC's inner join excludes it — the tile must equal
    -- the list, including in the corner cases (there are 0 such rows today).
    AND o.restaurant_id IN (SELECT r.id FROM restaurants r WHERE r.deleted_at IS NULL);
$function$;

-- A NEW POSTGRES FUNCTION IS PUBLIC-EXECUTABLE BY DEFAULT (the mig 038/267 lesson, guarded by
-- `npm run verify:grants`). This one reads every restaurant's order volume, so it is service_role
-- only — the same grant the three admin RPCs beside it carry.
REVOKE EXECUTE ON FUNCTION public.lfh_admin_orders_count(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.lfh_admin_orders_count(timestamptz, timestamptz) TO service_role;

COMMENT ON FUNCTION public.lfh_admin_orders_count(timestamptz, timestamptz) IS
  'Platform-wide order count for a window, excluding restaurants in the recycle bin — the same population lfh_admin_busiest_restaurants lists, so the admin''s ORDERS tile equals the sum of the table under it (mig 348). Non-cancelled orders only.';

-- ── 2. THE TREND CHART — same window, same population ───────────────────────────────────────
-- Both bodies were pulled LIVE from the database with pg_get_functiondef and had ONLY the
-- restaurant test added, so nothing else in them can drift or be reverted to an older copy (the
-- "a later CREATE OR REPLACE from a stale copy silently reverts a fix" rule). CREATE OR REPLACE
-- keeps every existing grant, so no REVOKE/GRANT is repeated for these two.
--
-- The 3-arg overload is the pre-mig-129 heritage shape. It is replaced as well: leaving one of two
-- same-named functions with the old population is precisely how a "fixed" number comes back.
CREATE OR REPLACE FUNCTION public.lfh_admin_orders_timeseries(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(bucket date, orders bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (date_trunc('day', o.created_at AT TIME ZONE 'Asia/Kolkata'))::date AS bucket,
         COUNT(*)::bigint AS orders
  FROM orders o
  WHERE o.created_at >= p_from AND o.created_at < p_to
    AND o.status <> 'cancelled'
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
    -- (348) a binned restaurant is not on the platform's chart. When p_restaurant_id is given the
    -- caller has already named one restaurant, and this leaves that case alone unless it is binned.
    AND o.restaurant_id IN (SELECT r.id FROM restaurants r WHERE r.deleted_at IS NULL)
  GROUP BY 1
  ORDER BY 1;
$function$;

CREATE OR REPLACE FUNCTION public.lfh_admin_orders_timeseries(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_bucket text)
 RETURNS TABLE(bucket timestamp with time zone, orders bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT date_trunc(
           CASE WHEN p_bucket = 'hour' THEN 'hour' ELSE 'day' END,
           o.created_at AT TIME ZONE 'Asia/Kolkata'
         ) AT TIME ZONE 'Asia/Kolkata' AS bucket,
         COUNT(*)::bigint AS orders
  FROM orders o
  WHERE o.created_at >= p_from AND o.created_at < p_to
    AND o.status <> 'cancelled'
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
    -- (348) same guard as the 3-arg overload above.
    AND o.restaurant_id IN (SELECT r.id FROM restaurants r WHERE r.deleted_at IS NULL)
  GROUP BY 1
  ORDER BY 1;
$function$;

-- ── 3. THE SOURCE BREAKDOWN — both legs ─────────────────────────────────────────────────────
-- The dine-in leg counted every restaurant's orders; the aggregator leg counted every binned
-- restaurant's delivery orders too. Both are guarded, or "Dine-in + Swiggy + Zomato" would still
-- not add up to the tile.
CREATE OR REPLACE FUNCTION public.lfh_admin_orders_by_source(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(source text, orders bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 'dine_in'::text AS source, COUNT(*)::bigint AS orders
  FROM orders o WHERE o.created_at >= p_from AND o.created_at < p_to
    AND o.status <> 'cancelled'
    AND o.restaurant_id IN (SELECT r.id FROM restaurants r WHERE r.deleted_at IS NULL)  -- (348)
  UNION ALL
  SELECT a.source, COUNT(*)::bigint
  FROM aggregator_orders a WHERE a.created_at >= p_from AND a.created_at < p_to
    AND a.restaurant_id IN (SELECT r.id FROM restaurants r WHERE r.deleted_at IS NULL)  -- (348)
  GROUP BY a.source;
$function$;
