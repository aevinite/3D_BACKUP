-- 138_action_idempotency.sql
-- Offline sync safety net (the "queue money actions offline" feature, 2026-07-06).
--
-- WHY: when a staff panel is offline it stores the actions the user takes and
-- replays them when the connection returns. A replay can arrive MORE THAN ONCE
-- (the original request may have actually reached the server before the socket
-- dropped, or the client retries after a mid-flight failure). Without protection
-- that would settle a bill twice or place a duplicate order.
--
-- HOW: every replayable write from a panel carries a client-generated
-- `action_id` (a UUID) in the `X-LFH-Action-Id` header. The server claims that id
-- in this table BEFORE running the write; a second request with the same id is
-- recognised as a duplicate and short-circuited (see lib/idempotency.ts). So each
-- action runs AT MOST ONCE, no matter how many times it's replayed.
--
-- This table is written ONLY by the service-role server (RLS on, no policies →
-- anon/authenticated can never read or write it).

create table if not exists public.action_idempotency (
  action_id     text primary key,              -- client-generated UUID for one user action
  panel         text,                           -- "tablet" | "kitchen" | "editor" (for debugging)
  restaurant_id uuid,                            -- scope, for debugging / cleanup (nullable)
  done          boolean not null default false,  -- false = claimed/in-flight, true = completed OK
  created_at    timestamptz not null default now()
);

-- Cleanup helper: prune rows older than this so the table stays tiny. A claim is
-- only useful for as long as a client might still be replaying it (minutes), so a
-- day is very generous. (Run opportunistically; not a hot path.)
create index if not exists action_idempotency_created_idx
  on public.action_idempotency (created_at);

alter table public.action_idempotency enable row level security;
-- No policies on purpose: only the service-role key (which bypasses RLS) touches it.
