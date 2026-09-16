-- 389 — a cancelled order stops counting as money the waiter brought in
-- (sweep #9, terminal 30, ROUND 2 — the consequence half of phase P149402)
--
-- `lfh_staff_performance` decides which orders count toward a staff member's figures with
--
--     AND deleted_at IS NULL AND cancelled_at IS NULL
--
-- It asks "was this cancelled?" by looking at a TIMESTAMP rather than at the status. Any order whose
-- cancellation never recorded a time therefore counts — and it counts in full: `orders_punched`,
-- `value_punched`, `tables_served`, `guests_served` and `discount_given` are all in the same CTE.
-- A ticket a waiter emptied to zero reads on the owner's staff screen as trade that waiter brought in.
--
-- MEASURED on the dev stack 2026-09-15: **872 cancelled orders are being counted this way.**
--
-- Migration 388 (the same round) stops new ones appearing by stamping `cancelled_at` in the two
-- functions that were not. This file fixes the 872 that already exist — and every future one that
-- slips through by any other route — because the honest test is the STATUS. An order is cancelled
-- whether or not anybody wrote down when.
--
-- WHY NOT BACKFILL THE MISSING TIMES INSTEAD. Because there is no honest time to write. Of the
-- 1,424 unstamped cancellations, 334 carry an `archived_at` and 552 a `deleted_at`; the rest carry
-- nothing, and `now()` would be a lie about when a sale was cancelled — on a table the compliance
-- rules treat as a permanent record. A missing timestamp is better left missing and read correctly
-- than invented. `cancelled_at IS NULL` is KEPT alongside the new clause, so nothing that was
-- excluded before becomes included now: this only ever removes rows from the count.
--
-- The definition below came out of `pg_get_functiondef()` with that one clause added; nothing else
-- in the body was touched and the grants are restated exactly as they stand.
--
-- COST: none — one more predicate on a query that already filters two.
-- Guarded by `npm run verify:cancel-stamped`.

CREATE OR REPLACE FUNCTION public.lfh_staff_performance(p_restaurant uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(staff_id uuid, days_active integer, hours_active numeric, actions integer, orders_punched integer, value_punched numeric, tables_served integer, guests_served integer, discount_given numeric, ratings integer, avg_rating numeric, paid numeric, first_seen timestamp with time zone, last_seen timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH act AS (
    SELECT actor_id AS sid,
           (created_at AT TIME ZONE 'Asia/Kolkata')::date AS d,
           created_at
      FROM staff_actions
     WHERE restaurant_id = p_restaurant AND actor_id IS NOT NULL
       AND created_at >= p_from AND created_at < p_to
  ), per_day AS (
    SELECT sid, d, MAX(created_at) - MIN(created_at) AS span, COUNT(*) AS n
      FROM act GROUP BY sid, d
  ), act_agg AS (
    SELECT sid,
           COUNT(*)::int                                                   AS days_active,
           ROUND(SUM(EXTRACT(EPOCH FROM span)) / 3600.0, 2)                AS hours_active,
           SUM(n)::int                                                     AS actions
      FROM per_day GROUP BY sid
  ), seen AS (
    SELECT sid, MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
      FROM act GROUP BY sid
  ), ord AS (
    SELECT placed_by_id AS sid,
           COUNT(*)::int                                                   AS orders_punched,
           COALESCE(SUM(total), 0)                                         AS value_punched,
           COUNT(DISTINCT table_number)::int                               AS tables_served,
           COUNT(DISTINCT session_id)::int                                 AS guests_served,
           COALESCE(SUM(discount), 0)                                      AS discount_given
      FROM orders
     WHERE restaurant_id = p_restaurant AND placed_by_id IS NOT NULL
       AND created_at >= p_from AND created_at < p_to
       AND deleted_at IS NULL AND cancelled_at IS NULL AND status <> 'cancelled'
     GROUP BY placed_by_id
  ), rate AS (
    SELECT o.placed_by_id AS sid, COUNT(*)::int AS ratings, ROUND(AVG(f.rating)::numeric, 2) AS avg_rating
      FROM feedback f
      JOIN orders o ON o.id = f.order_id
     WHERE o.restaurant_id = p_restaurant AND o.placed_by_id IS NOT NULL
       AND f.created_at >= p_from AND f.created_at < p_to
     GROUP BY o.placed_by_id
  ), pay AS (
    SELECT staff_id AS sid, COALESCE(SUM(amount) FILTER (WHERE kind <> 'deduction'), 0) AS paid
      FROM staff_payments
     WHERE restaurant_id = p_restaurant AND voided_at IS NULL
       AND paid_on >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
       AND paid_on <= (p_to   AT TIME ZONE 'Asia/Kolkata')::date
     GROUP BY staff_id
  )
  SELECT s.id,
         COALESCE(a.days_active, 0), COALESCE(a.hours_active, 0), COALESCE(a.actions, 0),
         COALESCE(o.orders_punched, 0), COALESCE(o.value_punched, 0),
         COALESCE(o.tables_served, 0), COALESCE(o.guests_served, 0),
         COALESCE(o.discount_given, 0),
         COALESCE(r.ratings, 0), r.avg_rating,
         COALESCE(p.paid, 0),
         sn.first_seen, sn.last_seen
    FROM staff_users s
    LEFT JOIN act_agg a ON a.sid = s.id
    LEFT JOIN seen    sn ON sn.sid = s.id
    LEFT JOIN ord     o ON o.sid = s.id
    LEFT JOIN rate    r ON r.sid = s.id
    LEFT JOIN pay     p ON p.sid = s.id
   WHERE s.restaurant_id = p_restaurant AND s.deleted_at IS NULL;
$function$;

REVOKE ALL ON FUNCTION public.lfh_staff_performance(p_restaurant uuid, p_from timestamp with time zone, p_to timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_staff_performance(p_restaurant uuid, p_from timestamp with time zone, p_to timestamp with time zone) TO service_role;

NOTIFY pgrst, 'reload schema';
