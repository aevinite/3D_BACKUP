-- 208_admin_login_alert.sql — admin-login "3 wrong tries" alert + block plumbing. (owner 2026-07-26)
-- The admin password must NEVER auto-lock the owner out, so admin-login is NOT a blocking
-- rate-limit. Instead, after N wrong tries from a device it records a WARN-ONLY event that shows
-- in the notification bell + Problems section, where the admin can choose to Block that device.

-- Warn-only recorder: upsert an open event, no counter, no blocking. Reuses rate_limit_events
-- (the bell + Problems already read it). Same dedupe as lfh_rate_check's event branch.
create or replace function lfh_rate_alert(p_key text, p_subject text, p_label text, p_hit int)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into rate_limit_events(restaurant_id, key, subject, subject_label, hit_count, max_count, window_seconds, status, created_at, last_at)
    values ('00000000-0000-0000-0000-000000000000'::uuid, p_key, p_subject, p_label, p_hit, 0, 0, 'open', now(), now())
  on conflict (restaurant_id, key, subject) where (status = 'open')
  do update set hit_count = excluded.hit_count, last_at = now(),
                subject_label = coalesce(excluded.subject_label, rate_limit_events.subject_label);
end; $$;
revoke all on function lfh_rate_alert(text, text, text, int) from public, anon, authenticated;
grant execute on function lfh_rate_alert(text, text, text, int) to service_role;

-- admin_login is handled in code as a notify-only alert (never a block) — drop the seeded
-- blocking rule so the Rate Limits page doesn't imply it can lock the owner out.
delete from rate_limit_rules where key = 'admin_login' and restaurant_id is null;

-- A human note for a deliberate block (who/why), shown in the admin's Blocked-devices list.
alter table login_throttle add column if not exists note text;
