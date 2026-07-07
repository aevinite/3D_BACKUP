-- 151_login_throttle.sql
-- Brute-force lockout for the two login surfaces that had NONE: the single shared
-- ADMIN password (/api/staff-login) and the manager PIN (/api/tablet gated actions).
--
-- WHY: staff ACCOUNTS already lock after 5 wrong tries (staff_users.failed_count /
-- locked_until, migration 055). But the admin password and the manager PIN are not
-- rows in staff_users — there was nowhere to count wrong tries, so an attacker could
-- guess unlimited times (a 4-digit PIN falls in minutes; the shared admin password
-- was fully open to a script). The login screen is the single most-targeted screen
-- in any app, so both need the same speed-bump.
--
-- HOW: one tiny key→counter table. `key` identifies WHAT is being brute-forced and
-- from WHERE, e.g. "admin:<ip>" or "pin:<restaurant_id>:<device_id>". After N wrong
-- tries the row's `locked_until` is set into the future and every attempt is refused
-- until it passes; a correct entry resets the row. See lib/loginThrottle.ts. This is
-- the LOGIN path (rare, not polled), so its read+write cost is negligible — it is
-- deliberately NOT on any hot/realtime path.
--
-- Written ONLY by the service-role server (RLS on, no policies → anon/authenticated
-- can never read or write it), exactly like staff_actions / action_idempotency.

create table if not exists public.login_throttle (
  key          text primary key,               -- what+where is being guessed, e.g. "admin:1.2.3.4"
  fail_count   integer     not null default 0,  -- consecutive wrong tries since the last success/lock
  locked_until timestamptz,                     -- if set and in the future, every attempt is refused
  updated_at   timestamptz not null default now()
);

-- Lets us prune stale rows cheaply (a lock is only useful for minutes).
create index if not exists login_throttle_updated_idx
  on public.login_throttle (updated_at);

alter table public.login_throttle enable row level security;
-- No policies on purpose: only the service-role key (which bypasses RLS) touches it.
