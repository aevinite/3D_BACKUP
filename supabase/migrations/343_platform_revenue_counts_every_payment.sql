-- 343 · Platform revenue counts EVERY payment, not the newest ten thousand
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- T20 sweep item 13, owner-approved 2026-08-20.
--
-- /api/admin/revenue built "collected all time", "collected this year" and the 12-month chart by
-- reading `restaurant_payments` into the app and adding it up in JavaScript:
--
--     .select("restaurant_id, amount, paid_on").order("paid_on", { ascending: false }).limit(10000)
--
-- Past ten thousand payment rows that stops being the whole ledger, and because the order is
-- newest-first the rows it drops are the OLDEST ones — so "collected all time" quietly shrinks and
-- keeps shrinking. Nothing on the screen would have said so. This is the platform's own income, the
-- number that answers "is this business working", and it is the worst kind of wrong: silently.
--
-- It is also plain waste. Ten thousand rows crossed the wire every time the Revenue page opened, to
-- produce fourteen numbers. This computes those fourteen numbers in Postgres and sends one row,
-- which is the rule this project already applies to the Z-report and to the Pay Later headline
-- (`lfh_khata_outstanding_summary`) for exactly the same reason.
--
-- NOT restaurant food revenue — `restaurant_payments` is what restaurants pay US for their
-- subscription. The admin console shows no tenant's takings and this does not change that.
--
-- Additive: one new read-only function, no schema change, no data rewrite.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- The index the aggregate wants. `paid_on` is what both the year boundary and the monthly buckets
-- filter and group by, and there was no index on it — the old code never needed one because it
-- sorted a capped page. Partial on NOT NULL: a payment with no date contributes to all-time only.
CREATE INDEX IF NOT EXISTS restaurant_payments_paid_on_ix
  ON restaurant_payments (paid_on)
  WHERE paid_on IS NOT NULL;

DROP FUNCTION IF EXISTS lfh_admin_platform_collected(date, date);
CREATE OR REPLACE FUNCTION lfh_admin_platform_collected(
  p_year_start   date,   -- the IST calendar-year boundary the page's heading uses
  p_months_from  date    -- first day of the earliest month the 12-month chart shows
)
RETURNS TABLE (
  all_time   numeric,    -- every payment ever recorded, no cap
  this_year  numeric,    -- payments on or after p_year_start
  months     jsonb,      -- { "2026-08": 41000, "2026-07": 39500, … } for the chart's window
  row_count  bigint      -- how many payment rows this was computed over (an honesty figure)
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(round(sum(p.amount)::numeric, 2), 0)                                        AS all_time,
    COALESCE(round(sum(p.amount) FILTER (WHERE p.paid_on >= p_year_start)::numeric, 2), 0) AS this_year,
    COALESCE(
      (SELECT jsonb_object_agg(m.bucket, m.total)
         FROM (SELECT to_char(p2.paid_on, 'YYYY-MM')            AS bucket,
                      round(sum(p2.amount)::numeric, 2)         AS total
                 FROM restaurant_payments p2
                WHERE p2.paid_on IS NOT NULL
                  AND p2.paid_on >= p_months_from
                GROUP BY 1) m),
      '{}'::jsonb)                                                                        AS months,
    count(*)                                                                              AS row_count
  FROM restaurant_payments p;
$$;

-- NEW POSTGRES FUNCTIONS ARE PUBLIC-EXECUTABLE BY DEFAULT (the mig 038/267 lesson, guarded by
-- `npm run verify:grants`). This one reads the platform's own income across every tenant, so it is
-- service_role only — the admin console reaches it through a server route that checks the sign-in.
revoke all on function lfh_admin_platform_collected(date, date) from public, anon, authenticated;
grant execute on function lfh_admin_platform_collected(date, date) to service_role;

NOTIFY pgrst, 'reload schema';
