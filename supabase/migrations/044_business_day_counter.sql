-- Business day starts at 05:00 IST (owner, 2026-06-13): a late service running
-- past midnight should keep ONE day's KOT/bill numbering, and a fresh day's
-- numbers should start only once the early-morning rollover passes. The daily
-- counter now keys on the IST business date instead of UTC CURRENT_DATE.
--
-- Keep this in lockstep with lib/businessDay.ts (the panels' "today" filter uses
-- the same 05:00-IST boundary so the lists match the counter reset).

CREATE OR REPLACE FUNCTION lfh_next_counter(p_key text)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_n int; v_day date;
BEGIN
  -- 05:00 IST rollover: shift to IST, step back 5h, take the date.
  v_day := ((now() AT TIME ZONE 'Asia/Kolkata') - interval '5 hours')::date;
  INSERT INTO daily_counters(key, day, n) VALUES (p_key, v_day, 1)
    ON CONFLICT (key, day) DO UPDATE SET n = daily_counters.n + 1
    RETURNING n INTO v_n;
  RETURN v_n;
END; $$;

NOTIFY pgrst, 'reload schema';
