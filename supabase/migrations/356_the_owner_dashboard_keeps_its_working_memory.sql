-- 356_the_owner_dashboard_keeps_its_working_memory.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Migration 192 gave eleven owner-analytics functions their own `work_mem = 128MB`, with the
-- measurement written down: at ~398k orders the default 4MB made those GROUP BY / hash aggregates
-- SPILL 75–340MB to disk, the same query swung between 2.4s and 6.7s, and a cold run under real
-- load tipped past the 8s statement timeout — the red "Couldn't load" banner on the owner
-- dashboard's wide views. Migrations 190, 195 and 266 each re-asserted the setting.
--
-- SIX OF THE ELEVEN NO LONGER HAVE IT. Function-level SET clauses are part of a function's
-- definition, so a later `CREATE OR REPLACE` that does not restate them DROPS them — and
-- migrations 310, 315, 321, 327 and 337 each recreated one of these without the SET line.
-- Migration 266's own comment says the opposite out loud ("CREATE OR REPLACE preserves settings"),
-- which is how it went unnoticed: the migrations look like they set it and the database does not.
-- Found by reading pg_proc.proconfig against the folder (sweep #6 terminal 22).
--
-- The five that kept it are the proof this is not obsolete: `lfh_owner_dish_breakdown` and
-- `lfh_owner_category_breakdown` still scan raw `orders` with no rollup at all and still carry
-- 128MB. All six below scan raw `orders` too — three of them (hourly, payment_trend, records)
-- with no rollup either.
--
-- This is execution tuning ONLY. No SQL, no maths and no returned number changes. The memory is
-- transient and bounded: these are low-frequency reads (a handful of owners polling ~every 60s),
-- which is exactly the trade migration 192 reasoned about.
--
-- Each ALTER is guarded by to_regprocedure, so if a future migration changes one of these
-- signatures this file becomes a no-op for that one instead of killing a re-seed — the lesson
-- migrations 043 and 219 paid for.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

DO $work_mem_back$
DECLARE
  v_sig text;
  v_done int := 0;
  v_sigs text[] := ARRAY[
    'public.lfh_owner_overview(uuid[])',
    'public.lfh_owner_hourly(uuid, timestamptz, timestamptz)',
    'public.lfh_owner_payment_trend(uuid, timestamptz, timestamptz)',
    'public.lfh_owner_records(uuid)',
    'public.lfh_owner_restaurant_revenue(timestamptz, timestamptz, uuid[])',
    'public.lfh_owner_revenue_timeseries(uuid, timestamptz, timestamptz, text, uuid[])'
  ];
BEGIN
  FOREACH v_sig IN ARRAY v_sigs LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE NOTICE '356: % is not present with that signature — skipped, nothing else is affected', v_sig;
    ELSE
      EXECUTE format('ALTER FUNCTION %s SET work_mem = %L', v_sig, '128MB');
      v_done := v_done + 1;
    END IF;
  END LOOP;
  RAISE NOTICE '356: % of % owner-analytics functions have their working memory back', v_done, array_length(v_sigs, 1);
END $work_mem_back$;

NOTIFY pgrst, 'reload schema';
