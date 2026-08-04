-- 289_the_breadcrumb_table_stays_small.sql
--
-- KEEP THE BREADCRUMB TABLE'S INDEXES SMALL WITHOUT ANYONE REMEMBERING TO.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────────────────────
-- `realtime_events` is pure churn: every order, session, item, tag and call writes a breadcrumb,
-- and `lfh_rt_prune()` deletes anything older than 15 minutes. Lifetime on this database: ~1.5M
-- inserts, ~1.3M deletes, against ~450 live rows at any moment.
--
-- VACUUM reclaims the heap but NOT index space — only REINDEX does. So the heap stayed at a couple
-- of hundred kB while the indexes grew without limit. The database sweep measured them at **21 MB
-- for a 152 kB table**, on a database the owner has already had to shrink once. 14 MB of that was
-- an index with zero scans in its entire life, dropped by mig 267; the rest was bloat on the two
-- that ARE used, and it has just been reclaimed by hand (`npm run db:maintain -- --apply`):
-- 7,344 kB → 48 kB, and the whole database 91.6 MB → 80.5 MB.
--
-- ── WHY A SCHEDULE AND NOT A NOTE IN A DOC ──────────────────────────────────────────────────
-- Mig 247 already pointed at `db:maintain` as the remedy. It sat unrun long enough for 21 MB to
-- accumulate, because "a human remembers to run maintenance" is not a mechanism. The bloat WILL
-- come back — the churn that caused it is the product working normally. So it gets a job.
--
-- ── WHY THIS IS SAFE, AND WHY IT IS `REINDEX TABLE` AND NOT `CONCURRENTLY` ──────────────────
-- `REINDEX TABLE` takes a brief ACCESS EXCLUSIVE lock, which on this table is milliseconds: the
-- 15-minute pruner keeps it at a few hundred rows and 48 kB of index, so there is never much to
-- rebuild. A breadcrumb insert waiting a few ms is invisible — and a breadcrumb is a "something
-- changed, go re-read" nudge, not data, so even the worst case costs nothing but a moment's delay
-- on a refetch. `CONCURRENTLY` would avoid the lock but cannot run inside a transaction block,
-- which is how pg_cron executes a job; plain REINDEX is transaction-safe, and was verified to run
-- as a single statement before this was written.
--
-- Weekly, at 04:40 IST-ish (23:10 UTC Sunday) — deliberately away from the 04:00 log prune and the
-- 00:20/00:25 rollups so two maintenance jobs never land together on a shared vCPU.
--
-- ⚠️ DELIBERATELY NOT INCLUDED: `orders.idx_orders_analytics_covering` (6.2 MB → 2.3 MB by hand
-- today). REINDEX on `orders` locks the hottest table in the product, and unlike the breadcrumb
-- table there is real data behind it. That one stays a human decision via `db:maintain`, which
-- reports it every time it is run.

SELECT cron.schedule(
  'lfh-reindex-breadcrumbs',
  '10 23 * * 0',                                  -- weekly, Sunday 23:10 UTC
  'REINDEX TABLE public.realtime_events'
);

NOTIFY pgrst, 'reload schema';
