-- 247_vacuum_the_hot_tables_sooner.sql
-- (renumbered from 246 the same day: another session's 246_orders_change_watermark.sql landed while
--  this was being written. verify:ui caught the clash on the edit, which is what it is for.)
--
-- WHY. This instance is small — shared_buffers **224 MB**, effective_cache_size 384 MB (a ~1 GB
-- machine) — and the database had grown to **367 MB**. So the working set did not fit in memory:
-- every large scan read from disk AND evicted the floor's hot pages, which is the mechanism by which
-- heavy analytics made unrelated panel reads slow enough to cross the 8-second statement wall.
--
-- Part of that was dead rows nobody was reclaiming. Postgres autovacuums a table only after
-- `autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor × rows` dead rows. At the defaults
-- (50 and 0.2) a 400 000-row table must accumulate about **80 000 dead rows** first — so `orders`
-- sat for **11 days** with 13 266 dead rows that every sequential scan still had to walk past, and
-- its planner statistics went stale with it.
--
-- That default is sensible for a table you rarely scan whole. It is wrong for the three tables here
-- that are read constantly or churn constantly:
--   · orders          — scanned by every report; the biggest table in the database
--   · staff_actions   — every panel action and error row, written all day
--   · realtime_events — a queue: rows are inserted and pruned continuously, so it is *always* dirty
--
-- Vacuuming them sooner costs a little background I/O and keeps both space and statistics current.
-- These are per-table settings, so nothing else on the database is affected.
--
-- WHAT THIS DOES NOT FIX, said plainly so nobody assumes otherwise:
--   · **Index bloat.** VACUUM frees space *inside* index pages but never shrinks the index file, so
--     a churn table's indexes only ever grow. `realtime_events` had a **19.4 MB index for 306 rows**.
--     Only REINDEX reclaims that — `npm run db:maintain -- --apply` does it CONCURRENTLY (one pass
--     took the database from 367 MB to 321 MB). It is a command, not a cron, on purpose.
--   · **The size of the machine.** 224 MB of cache for a 321 MB database is still too little. That
--     one costs money and is the owner's call; see docs/FLOOR-TIMEOUT-WATCH.md.
--
-- Two things were TRIED HERE AND REJECTED BY MEASUREMENT, recorded so they are not retried:
--   · dropping `idx_orders_restaurant_created` and `idx_orders_restaurant` (21 MB, and each is a
--     column-prefix of a bigger index, so they look redundant). The heatmap went from 1.6–9.4 s to
--     **20–39 s**. They are load-bearing. Both were restored.
--   · adding an effective-date index carrying the heatmap's columns, to get an index-only scan
--     (+26 MB). The heatmap got **worse**: 2.5–10.3 s → 13.5–18.9 s. Dropped again.

ALTER TABLE public.orders SET (
  autovacuum_vacuum_scale_factor  = 0.02,   -- ~8 000 dead rows on this table instead of ~80 000
  autovacuum_analyze_scale_factor = 0.02,   -- keep planner statistics current too
  autovacuum_vacuum_threshold     = 1000
);

ALTER TABLE public.staff_actions SET (
  autovacuum_vacuum_scale_factor  = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);

-- A queue table: small, and dirty essentially all the time. Vacuum it eagerly.
ALTER TABLE public.realtime_events SET (
  autovacuum_vacuum_scale_factor  = 0.01,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_vacuum_threshold     = 100
);
