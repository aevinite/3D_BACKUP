-- 387 — the last three owner reports get the working memory their eleven siblings already have
-- (owner picked item 7 of sweep #9 terminal 30's report, 2026-09-15)
--
-- WHAT THIS IS ABOUT. An owner report that groups and sorts a lot of rows either does that work in
-- MEMORY or spills it to disk. `work_mem` is how much memory one such step may use, and eleven of
-- the owner's analytics functions carry `SET work_mem TO '128MB'` on themselves for exactly that
-- reason — migration 155 added it after `lfh_owner_overview` and the six-month sales report were
-- both hitting the 8-second timeout, and measured them coming back at ~0.2–0.4s warm.
--
-- Three newer ones never got it:
--
--     lfh_owner_customer_bills   13 grouping/sorting steps over sessions joined to orders
--     lfh_owner_heatmap          groups every order into a day-of-week × hour grid
--     lfh_owner_tips             sums tips across a date range
--
-- They are fine on today's data. They are the ones that will spill to disk FIRST as a restaurant's
-- history grows, and they would do it quietly — a report that takes six seconds instead of a third
-- of one looks like "the internet is slow", not like a setting nobody set.
--
-- TWO MORE OWNER FUNCTIONS HAVE NO work_mem AND ARE LEFT THAT WAY ON PURPOSE:
-- `lfh_owner_orders_fingerprint` and `lfh_owner_report_month_fingerprint`. Both are change
-- DETECTORS — they read a watermark row and return one short string that answers "has anything
-- moved since you last looked". There is nothing to sort and nothing to group, so 128MB would be
-- cargo-cult, and `verify:db-grants` names them as exempt with this reason rather than leaving the
-- next reader to wonder. (`lfh_owner_orders_fingerprint` also carries no `search_path`, which is
-- correct: it is SECURITY INVOKER and every table it names is schema-qualified.)
--
-- ⚠️ WHY THIS IS A MIGRATION AND NOT AN `ALTER FUNCTION … SET`. A function-level SET does NOT
-- survive a later `CREATE OR REPLACE` — migration 266 states the opposite in a comment and five
-- later migrations trusted it, which is how the eleven lost theirs once already. An ALTER would work
-- today and vanish the next time one of these three bodies is rewritten. Putting the SET in the
-- definition is what makes it stick, and `verify:db-grants` is the check that catches the next
-- CREATE OR REPLACE that forgets it.
--
-- The three definitions below came out of `pg_get_functiondef()` on the dev database with one SET
-- line added after the existing `SET search_path`, in the same position every sibling carries it.
-- No body was re-typed and no body was copied from an older migration.
--
-- COST: none. `work_mem` is a ceiling, not an allocation — a query that needs 2MB still uses 2MB.
-- Grants restated exactly as they are today (service_role only, all three).

-- ── lfh_owner_customer_bills ──
CREATE OR REPLACE FUNCTION public.lfh_owner_customer_bills(p_restaurant_ids uuid[], p_phone text, p_limit integer DEFAULT 20)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '128MB'
AS $function$
DECLARE
  v_phone text := lfh_phone10(p_phone);
  v_bills json;
  v_tot   numeric := 0;
  v_count int := 0;
  v_first timestamptz;
  v_last  timestamptz;
BEGIN
  IF v_phone IS NULL OR p_restaurant_ids IS NULL OR array_length(p_restaurant_ids, 1) IS NULL THEN
    RETURN json_build_object('bills', '[]'::json, 'lifetime', 0, 'bill_count', 0);
  END IF;

  WITH s AS (
    SELECT ses.id, ses.restaurant_id, ses.bill_no, ses.invoice_no, ses.table_number,
           ses.opened_at, ses.closed_at, ses.cust_name,
           COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL), 0) AS gross,
           COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL), 0) AS disc
      FROM sessions ses
      LEFT JOIN orders o ON o.session_id = ses.id
     WHERE ses.restaurant_id = ANY(p_restaurant_ids)
       AND ses.cust_phone = v_phone
       AND ses.deleted_at IS NULL
     GROUP BY ses.id
     -- A bill whose orders were ALL cancelled has nothing on it; it isn't a visit and
     -- must not appear as a ₹0 line (caught while testing on dev data).
    HAVING COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL), 0) > 0
     ORDER BY ses.opened_at DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
  )
  SELECT COALESCE(json_agg(json_build_object(
           'session_id', s.id, 'restaurant_id', s.restaurant_id, 'bill_no', s.bill_no,
           'invoice_no', s.invoice_no, 'table_number', s.table_number,
           'at', COALESCE(s.closed_at, s.opened_at), 'name', s.cust_name,
           'total', ROUND(GREATEST(0, s.gross - s.disc), 2)) ORDER BY COALESCE(s.closed_at, s.opened_at) DESC), '[]'::json)
    INTO v_bills FROM s;

  -- lifetime figures over ALL of this guest's bills (not just the page shown)
  SELECT COUNT(*)::int,
         COALESCE(SUM(GREATEST(0, t.gross - t.disc)), 0),
         MIN(t.at), MAX(t.at)
    INTO v_count, v_tot, v_first, v_last
    FROM (
      SELECT ses.id,
             COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL), 0) AS gross,
             COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL), 0) AS disc,
             COALESCE(ses.closed_at, ses.opened_at) AS at
        FROM sessions ses
        LEFT JOIN orders o ON o.session_id = ses.id
       WHERE ses.restaurant_id = ANY(p_restaurant_ids)
         AND ses.cust_phone = v_phone
         AND ses.deleted_at IS NULL
       GROUP BY ses.id
      HAVING COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL), 0) > 0
    ) t;

  RETURN json_build_object(
    'phone', v_phone, 'bills', v_bills, 'bill_count', v_count,
    'lifetime', ROUND(v_tot, 2),
    'avg_bill', CASE WHEN v_count > 0 THEN ROUND(v_tot / v_count, 2) ELSE 0 END,
    'first_bill', v_first, 'last_bill', v_last);
END $function$;

REVOKE ALL ON FUNCTION public.lfh_owner_customer_bills(p_restaurant_ids uuid[], p_phone text, p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_customer_bills(p_restaurant_ids uuid[], p_phone text, p_limit integer) TO service_role;

-- ── lfh_owner_heatmap ──
CREATE OR REPLACE FUNCTION public.lfh_owner_heatmap(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(dow integer, hr integer, orders bigint, revenue numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '128MB'
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

REVOKE ALL ON FUNCTION public.lfh_owner_heatmap(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_heatmap(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[]) TO service_role;

-- ── lfh_owner_tips ──
CREATE OR REPLACE FUNCTION public.lfh_owner_tips(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(tips numeric, tipped_orders bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '128MB'
AS $function$
  SELECT COALESCE(SUM(o.tip), 0)::numeric AS tips,
         COUNT(*)::bigint                 AS tipped_orders
    FROM orders o
   WHERE (p_ids IS NOT NULL AND o.restaurant_id = ANY (p_ids)
          OR p_ids IS NULL AND p_restaurant_id IS NOT NULL AND o.restaurant_id = p_restaurant_id)
     AND o.created_at >= p_from
     AND o.created_at <  p_to
     AND o.tip > 0
     AND o.payment_status = 'paid'
     AND o.status <> 'cancelled'
     AND o.deleted_at IS NULL;
$function$;

REVOKE ALL ON FUNCTION public.lfh_owner_tips(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_tips(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
