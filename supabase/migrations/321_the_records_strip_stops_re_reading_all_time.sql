-- 321_the_records_strip_stops_re_reading_all_time.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- WHERE: Owner panel → Dashboard → the records strip — the brag cards "Best day", "Biggest bill",
-- "Fastest hour", "Star dish", "Regulars".
-- WHAT HE WOULD SEE: nothing wrong, just a wait. Measured on this database: 1,054 ms for Aangan,
-- 3.9 s across the 16 restaurants, and it grows with every bill ever taken.
--
-- WHY IT WAS EXPENSIVE. To say "your best day ever was ₹669,606 on 19 July" the function walked
-- EVERY paid bill the restaurant has ever taken, every time the dashboard was opened or its range
-- changed. (A 2026-07-07 audit already stopped it re-running on the 60-second refresh; this is the
-- remaining cost, and the one that grows.)
--
-- THE FIX IS THE PATTERN ALREADY IN THE BUILDING: the money readers keep history in a pre-summed
-- table and read only the last two days live (migs 190/201/315). The records now do the same —
-- `owner_records_agg` holds the three ALL-TIME bests per restaurant up to a date, and the RPC
-- combines that one row with only the days AFTER it.
--
-- WHY THAT IS EXACT, NOT NEARLY-EXACT — the three cases that could have gone wrong:
--   · BEST DAY. Days never straddle the boundary (history is ≤ through, the tail is > through), so
--     the answer is simply the better of the two legs.
--   · BIGGEST BILL. A session CAN straddle it (opened Monday, settled Wednesday). The snapshot would
--     hold only that session's early half — but the live leg recomputes the WHOLE session for any
--     session with an order in the tail, and the two legs are combined with MAX, so the full sum
--     always wins over the partial one. Exact, without needing to exclude anything.
--   · FASTEST HOUR. An hour lives inside one day, so again: the better of the two legs.
--   · STAR DISH and REGULARS are 30-day rolling windows and stay live — they were never the cost.
--
-- PROVED, NOT ASSUMED: the old function's answer was captured for all 16 restaurants before this
-- migration and compared field-by-field afterwards.
--
-- The refresh runs nightly, right after the daily money rollup (00:25 IST-equivalent slot, i.e. just
-- behind refresh-owner-daily-agg at 00:20), and it is a full recompute — so it is idempotent, and a
-- missing snapshot row simply means "no history yet", which reads correctly as everything being in
-- the live tail.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.owner_records_agg (
  restaurant_id    uuid PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
  through          date        NOT NULL,   -- history is summarised up to AND INCLUDING this day
  best_day         date,
  best_day_rev     numeric,
  big_bill_table   text,
  big_bill_rev     numeric,
  busy_hour        timestamp,   -- NO time zone: date_trunc('hour', … AT TIME ZONE 'Asia/Kolkata')
                                --  has none, and the dashboard already renders that shape (a timestamptz
                                --  here silently shifted the hour by the offset — caught in review)
  busy_hour_orders integer,
  refreshed_at     timestamptz NOT NULL DEFAULT now()
);
-- Staff/owner data behind a service-role route, like every other rollup: RLS on, no policy.
ALTER TABLE public.owner_records_agg ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_records_agg FROM anon, authenticated;

COMMENT ON TABLE public.owner_records_agg IS
  'The Owner dashboard''s all-time records, pre-summed per restaurant up to `through` (mig 321). Read together with the days AFTER `through` so the strip never walks the whole bill history again. Rebuilt nightly by lfh_refresh_owner_records(); a missing row means "no history yet" and is safe.';

-- ── the refresh: one full recompute of the history side ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_refresh_owner_records()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  -- Same two-live-days shape as the daily money rollup, so both legs of this dashboard agree about
  -- where history ends.
  v_through date := (now() AT TIME ZONE 'Asia/Kolkata')::date - 2;
BEGIN
  DELETE FROM public.owner_records_agg;
  INSERT INTO public.owner_records_agg
    (restaurant_id, through, best_day, best_day_rev, big_bill_table, big_bill_rev, busy_hour, busy_hour_orders)
  WITH paid AS (
    SELECT o.restaurant_id, o.id, o.session_id, o.table_number, o.net_amount AS rev,
           (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AS at
      FROM public.orders o
     WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
  ),
  hist AS (SELECT * FROM paid WHERE (at AT TIME ZONE 'Asia/Kolkata')::date <= v_through),
  days AS (
    SELECT restaurant_id, (at AT TIME ZONE 'Asia/Kolkata')::date AS d, SUM(rev) v
      FROM hist GROUP BY 1, 2),
  best_day AS (
    SELECT DISTINCT ON (restaurant_id) restaurant_id, d, v
      -- On a tie the MOST RECENT day wins. The old function had no tie-break, so it returned
      -- whichever row the planner produced; two restaurants here showed a different (equally valid)
      -- answer between runs. Most-recent is the useful reading of "your best ever".
      FROM days ORDER BY restaurant_id, v DESC, d DESC),
  bills AS (
    SELECT restaurant_id, COALESCE(session_id::text, 'solo:' || id::text) k,
           MAX(table_number) tbl, SUM(rev) v
      FROM hist GROUP BY 1, 2),
  big_bill AS (
    SELECT DISTINCT ON (restaurant_id) restaurant_id, tbl, v
      FROM bills ORDER BY restaurant_id, v DESC, k DESC),
  hours AS (
    SELECT restaurant_id, date_trunc('hour', at AT TIME ZONE 'Asia/Kolkata') h, COUNT(*) n
      FROM hist GROUP BY 1, 2),
  busy AS (
    SELECT DISTINCT ON (restaurant_id) restaurant_id, h, n
      FROM hours ORDER BY restaurant_id, n DESC, h DESC)
  SELECT r.id, v_through,
         bd.d, ROUND(bd.v, 2), bb.tbl, ROUND(bb.v, 2), bh.h, bh.n
    FROM public.restaurants r
    LEFT JOIN best_day bd ON bd.restaurant_id = r.id
    LEFT JOIN big_bill bb ON bb.restaurant_id = r.id
    LEFT JOIN busy     bh ON bh.restaurant_id = r.id;
END $function$;
REVOKE ALL ON FUNCTION public.lfh_refresh_owner_records() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.lfh_refresh_owner_records() TO service_role;

-- ── the reader: one snapshot row + only the days after it ─────────────────────────────────────
-- Same signature, same JSON shape, same field names — the dashboard is untouched.
CREATE OR REPLACE FUNCTION public.lfh_owner_records(p_restaurant_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH snap AS (
    SELECT * FROM owner_records_agg WHERE restaurant_id = p_restaurant_id
  ),
  -- Everything the snapshot does not cover. With no snapshot row this is the whole history, which is
  -- exactly right for a restaurant whose first refresh has not run yet.
  tail AS (
    SELECT o.id, o.session_id, o.table_number, o.net_amount AS rev,
           (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) AS at
      FROM orders o
     WHERE o.restaurant_id = p_restaurant_id
       AND o.status <> 'cancelled' AND o.payment_status = 'paid'
       AND ((SELECT through FROM snap) IS NULL
            OR (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END
                AT TIME ZONE 'Asia/Kolkata')::date > (SELECT through FROM snap))
  ),
  -- A session with ANY order in the tail is recomputed IN FULL here, so a bill that straddles the
  -- boundary beats the snapshot's partial copy of itself under the MAX below.
  tail_bills AS (
    SELECT COALESCE(o.session_id::text, 'solo:' || o.id::text) k,
           MAX(o.table_number) tbl, SUM(o.net_amount) v
      FROM orders o
     WHERE o.restaurant_id = p_restaurant_id
       AND o.status <> 'cancelled' AND o.payment_status = 'paid'
       AND (o.session_id IN (SELECT session_id FROM tail WHERE session_id IS NOT NULL)
            OR o.id IN (SELECT id FROM tail WHERE session_id IS NULL))
     GROUP BY 1
  ),
  tail_day  AS (SELECT (at AT TIME ZONE 'Asia/Kolkata')::date d, SUM(rev) v FROM tail GROUP BY 1 ORDER BY 2 DESC, 1 DESC LIMIT 1),
  tail_hour AS (SELECT date_trunc('hour', at AT TIME ZONE 'Asia/Kolkata') h, COUNT(*) n FROM tail GROUP BY 1 ORDER BY 2 DESC, 1 DESC LIMIT 1),
  tail_bill AS (SELECT tbl, v FROM tail_bills ORDER BY v DESC, tbl DESC LIMIT 1),
  -- Unchanged: both are 30-day rolling windows, which were never the cost.
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
       GROUP BY 1 HAVING COUNT(DISTINCT m.session_id) >= 2) rc
  ),
  -- The better of the two legs, per record. ROUND to 2 like the old function did.
  win AS (
    SELECT
      CASE WHEN COALESCE((SELECT v FROM tail_day), -1) >= COALESCE((SELECT best_day_rev FROM snap), -1)
           THEN (SELECT d FROM tail_day) ELSE (SELECT best_day FROM snap) END                     AS bd_date,
      GREATEST(COALESCE((SELECT v FROM tail_day), 0), COALESCE((SELECT best_day_rev FROM snap), 0)) AS bd_rev,
      CASE WHEN COALESCE((SELECT v FROM tail_bill), -1) >= COALESCE((SELECT big_bill_rev FROM snap), -1)
           THEN (SELECT tbl FROM tail_bill) ELSE (SELECT big_bill_table FROM snap) END            AS bb_tbl,
      GREATEST(COALESCE((SELECT v FROM tail_bill), 0), COALESCE((SELECT big_bill_rev FROM snap), 0)) AS bb_rev,
      CASE WHEN COALESCE((SELECT n FROM tail_hour), -1) >= COALESCE((SELECT busy_hour_orders FROM snap), -1)
           THEN (SELECT h FROM tail_hour) ELSE (SELECT busy_hour FROM snap) END                   AS bh_at,
      GREATEST(COALESCE((SELECT n FROM tail_hour), 0), COALESCE((SELECT busy_hour_orders FROM snap), 0)) AS bh_n
  )
  SELECT jsonb_build_object(
    -- A restaurant with no paid bill at all keeps the old shape: the card is absent, not zero.
    'bestDay',  (SELECT CASE WHEN bd_date IS NULL THEN NULL
                             ELSE jsonb_build_object('date', bd_date, 'revenue', ROUND(bd_rev, 2)) END FROM win),
    'bigBill',  (SELECT CASE WHEN bb_rev = 0 AND bb_tbl IS NULL THEN NULL
                             ELSE jsonb_build_object('table', bb_tbl, 'revenue', ROUND(bb_rev, 2)) END FROM win),
    'fastHour', (SELECT CASE WHEN bh_at IS NULL THEN NULL
                             ELSE jsonb_build_object('at', bh_at, 'orders', bh_n) END FROM win),
    'starDish', (SELECT jsonb_build_object('title', title, 'qty', qty) FROM star_dish),
    'regulars', (SELECT n FROM regulars)
  );
$function$;
REVOKE ALL ON FUNCTION public.lfh_owner_records(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.lfh_owner_records(uuid) TO service_role;

-- Fill it now so the very next dashboard open is already cheap.
SELECT public.lfh_refresh_owner_records();

-- ── nightly, just behind the money rollup ────────────────────────────────────────────────────
-- At TOP LEVEL, not wrapped in EXCEPTION: migs 053/060 hid a cron failure that way and created
-- nothing for months (found by the T8 sweep, fixed in mig 267). pg_cron exists since mig 191.
SELECT cron.unschedule('refresh-owner-records')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-owner-records');
SELECT cron.schedule('refresh-owner-records', '25 0 * * *', 'SELECT public.lfh_refresh_owner_records();');

NOTIFY pgrst, 'reload schema';
