-- 205_rate_limits.sql — admin-configurable rate limiting, enforced in the DB.
-- (owner, 2026-07-26) One linked system: the app AND direct browser RPC calls both pass
-- through lfh_rate_check(), so a limit can't be dodged. Limits are editable per key from the
-- admin panel; when a limit is reached it records an EVENT that surfaces in the Problems
-- section with Fix / Change-limit / Allow actions. The admin's own login ('admin_login') ships
-- DISABLED so the owner is never locked out of the god-panel.
--
-- Scope sentinel: a NULL restaurant is stored as the all-zero uuid in counters/events so the
-- primary keys / unique indexes stay simple.

-- ── config: one row per (restaurant, key); restaurant_id NULL = global default ──────────────
create table if not exists rate_limit_rules (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,   -- NULL = global default
  key           text not null,
  label         text not null,
  max_count     int  not null default 10,
  window_seconds int not null default 60,
  enabled       boolean not null default true,
  updated_at    timestamptz not null default now(),
  updated_by    text
);
create unique index if not exists uq_rate_rule_global on rate_limit_rules(key) where restaurant_id is null;
create unique index if not exists uq_rate_rule_scoped on rate_limit_rules(restaurant_id, key) where restaurant_id is not null;

-- ── fixed-window counters (one live window per subject) ─────────────────────────────────────
create table if not exists rate_limit_counters (
  restaurant_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
  key           text not null,
  subject       text not null,
  window_start  timestamptz not null default now(),
  count         int not null default 0,
  primary key (restaurant_id, key, subject)
);

-- ── events: a limit was REACHED; drives the Problems section ─────────────────────────────────
create table if not exists rate_limit_events (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
  key           text not null,
  subject       text not null,
  subject_label text,
  hit_count     int not null,
  max_count     int not null,
  window_seconds int not null,
  status        text not null default 'open',      -- open | allowed | resolved
  created_at    timestamptz not null default now(),
  last_at       timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   text
);
-- one OPEN event per subject; re-hits update it instead of spawning rows
create unique index if not exists uq_rate_event_open on rate_limit_events(restaurant_id, key, subject) where status = 'open';
create index if not exists idx_rate_events_open on rate_limit_events(restaurant_id, status, last_at desc);

-- server-only (service role bypasses RLS); never the public key
alter table rate_limit_rules    enable row level security;
alter table rate_limit_counters enable row level security;
alter table rate_limit_events   enable row level security;
revoke all on rate_limit_rules, rate_limit_counters, rate_limit_events from anon, authenticated;

-- ── enforcement: returns TRUE = allowed, FALSE = blocked ─────────────────────────────────────
create or replace function lfh_rate_check(p_rid uuid, p_key text, p_subject text, p_label text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rule  rate_limit_rules;
  v_key0  uuid := coalesce(p_rid, '00000000-0000-0000-0000-000000000000'::uuid);
  v_cnt   int;
begin
  if p_subject is null or p_subject = '' then return true; end if;
  -- effective rule: a restaurant-specific row wins over the global default
  select * into v_rule from rate_limit_rules
    where key = p_key and (restaurant_id = p_rid or restaurant_id is null)
    order by (restaurant_id is not null) desc
    limit 1;
  if not found or not v_rule.enabled or v_rule.max_count <= 0 then return true; end if;

  insert into rate_limit_counters(restaurant_id, key, subject, window_start, count)
    values (v_key0, p_key, p_subject, now(), 1)
    on conflict (restaurant_id, key, subject) do update
      set count = case when rate_limit_counters.window_start < now() - make_interval(secs => v_rule.window_seconds)
                       then 1 else rate_limit_counters.count + 1 end,
          window_start = case when rate_limit_counters.window_start < now() - make_interval(secs => v_rule.window_seconds)
                       then now() else rate_limit_counters.window_start end
    returning count into v_cnt;

  if v_cnt > v_rule.max_count then
    insert into rate_limit_events(restaurant_id, key, subject, subject_label, hit_count, max_count, window_seconds, status, created_at, last_at)
      values (v_key0, p_key, p_subject, p_label, v_cnt, v_rule.max_count, v_rule.window_seconds, 'open', now(), now())
      on conflict (restaurant_id, key, subject) where (status = 'open')
      do update set hit_count = excluded.hit_count, last_at = now(),
                    subject_label = coalesce(excluded.subject_label, rate_limit_events.subject_label);
    return false;
  end if;
  return true;
end; $$;

-- ── "Allow": reset that subject's counter now (unblock them), mark the event handled ─────────
create or replace function lfh_rate_allow(p_event_id uuid, p_actor text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_e rate_limit_events;
begin
  select * into v_e from rate_limit_events where id = p_event_id;
  if not found then return false; end if;
  delete from rate_limit_counters where restaurant_id = v_e.restaurant_id and key = v_e.key and subject = v_e.subject;
  update rate_limit_events set status = 'allowed', resolved_at = now(), resolved_by = p_actor where id = p_event_id;
  return true;
end; $$;

-- staff-only functions: lock down execute (CLAUDE.md rule — new funcs are public by default)
revoke all on function lfh_rate_check(uuid, text, text, text)  from public, anon, authenticated;
revoke all on function lfh_rate_allow(uuid, text)              from public, anon, authenticated;
grant execute on function lfh_rate_check(uuid, text, text, text) to service_role;
grant execute on function lfh_rate_allow(uuid, text)            to service_role;

-- ── seed global defaults (idempotent) ───────────────────────────────────────────────────────
insert into rate_limit_rules (restaurant_id, key, label, max_count, window_seconds, enabled) values
  (null, 'guest_order',  'Guest orders (per table)',       8, 60,  true),
  (null, 'staff_login',  'Staff / owner login attempts',   5, 300, true),
  (null, 'manager_pin',  'Manager PIN attempts',           5, 300, true),
  (null, 'waiter_call',  'Waiter calls (per table)',       6, 60,  true),
  (null, 'join_session', 'Join-table attempts',            6, 120, true),
  (null, 'otp_request',  'OTP code requests',              4, 300, true),
  (null, 'admin_login',  'Your admin login (off — so you are never locked out)', 0, 300, false)
on conflict (key) where restaurant_id is null do nothing;
