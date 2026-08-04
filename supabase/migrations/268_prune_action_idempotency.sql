-- 268_prune_action_idempotency.sql
--
-- THE AT-MOST-ONCE TABLE GREW FOREVER.
--
-- Every replayable write claims a row in action_idempotency (mig 138) and nothing has ever
-- removed one. Measured on the backup database 2026-08-04: 1,881 rows, of which 1,632 (87%)
-- were older than a day and could not possibly be replayed again — the offline queues give up
-- long before that, and the staff queue's own ceiling is six rounds of a two-minute backoff.
--
-- This matters more here than it looks: the database has already run out of room once
-- (see the "database was too small for its data" work), and a table nothing prunes is exactly
-- the shape that gets there. The doc has carried this as an open TODO since the feature shipped.
--
-- WHY NOT A CRON. Free-tier Postgres may not have pg_cron, and CLAUDE.md is explicit that a blind
-- timer doing work on idle data is the wrong pattern. Instead the guard calls this OPPORTUNISTICALLY
-- (roughly one write in two hundred — see lib/idempotency.ts), so the cost is paid only by
-- restaurants that are actually busy, and an idle stack does nothing at all.
--
-- SAFETY. A day is far longer than any legitimate replay window, so pruning cannot resurrect a
-- duplicate. The delete is bounded so one call can never turn into a long lock on a busy table.

create or replace function public.lfh_prune_action_idempotency(p_older_than interval default '24 hours')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  -- Bounded: at most 500 rows per call. Being opportunistic, it is called often enough that the
  -- backlog drains quickly, and no single call can hold a lock long enough to be noticed.
  with doomed as (
    select action_id
      from public.action_idempotency
     where created_at < now() - p_older_than
     order by created_at
     limit 500
  )
  delete from public.action_idempotency a
   using doomed d
   where a.action_id = d.action_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- New functions are PUBLIC-executable by default (the gotcha migration 038 exists for). This one
-- deletes rows, so it is service-role only — no guest or staff key may ever call it.
revoke all on function public.lfh_prune_action_idempotency(interval) from public, anon, authenticated;
grant execute on function public.lfh_prune_action_idempotency(interval) to service_role;

comment on function public.lfh_prune_action_idempotency(interval) is
  'Deletes at-most-once claims older than the given age (default 24h), max 500 per call. Called opportunistically by lib/idempotency.ts — no cron needed.';
