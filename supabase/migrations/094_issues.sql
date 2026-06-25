-- 094_issues.sql — staff-raised issues / complaints, per restaurant.
--
-- A manager (or any staff member) can raise an operational issue from their panel.
-- The OWNER sees the issues for the restaurants they own and can resolve them; the
-- ADMIN sees every restaurant's issues as the platform-wide "complaints" feed.
--
-- Tenant-scoped by restaurant_id. Accessed ONLY through our service-role route
-- handlers (RLS enabled + no policy = anon/authenticated cannot touch it directly;
-- the service role bypasses RLS). Indexed by the columns we filter/sort on.

create table if not exists public.issues (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  raised_by     text,                                   -- staff display name (panels are name-based)
  raised_role   text,                                   -- manager | kitchen | tablet | owner | admin
  subject       text not null,
  body          text,
  status        text not null default 'open',           -- open | resolved
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   text,
  constraint issues_status_chk check (status in ('open','resolved'))
);

create index if not exists issues_rid_status_idx on public.issues (restaurant_id, status, created_at desc);

alter table public.issues enable row level security;
-- No policies on purpose: anon/authenticated get no access; our server routes use
-- the service role (which bypasses RLS). Revoke direct grants for good measure.
revoke all on public.issues from anon, authenticated;

notify pgrst, 'reload schema';
