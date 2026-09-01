-- 367 — the computer that HAS the printer is the one that sets it up.
--
-- Owner, 2026-08-27: "that device is connected to printer so it will be easy for that device to set
-- up the printer and all that instead of the admin. Admin can still see it… but that device will set
-- up, and that device will only get option in settings like everyone has their settings where they
-- log out from."
--
-- Until now every helper was born on the ADMIN's screen: the admin typed a name, read a code off his
-- own monitor and then had to get that code onto a machine in another city. The machine itself — the
-- one actually wired to the printer, sitting in front of the person who can see whether paper came
-- out — had no way to say "I am this computer".
--
-- Two columns is the whole change. A helper row can now remember WHICH BROWSER made it (the panel's
-- own per-device id, the same `lfh_panel_device` value print_stations already keys on) and WHICH
-- PERSON was signed in at the time. Nothing is enforced by them: they are the answer to "is this
-- computer already set up?" when that same browser opens Settings → Printing again, which is what
-- turns a one-off admin chore into a screen the restaurant owns.
--
-- ADDITIVE, as every schema change here is: existing helpers keep working with both columns null,
-- and a null owner_device simply means "the admin made this one".
alter table public.print_agents add column if not exists owner_device text;
alter table public.print_agents add column if not exists owner_user  uuid;

comment on column public.print_agents.owner_device is
  'The panel device id (lfh_panel_device) of the browser that set this helper up, when a restaurant set it up itself. Null = an admin created it.';
comment on column public.print_agents.owner_user is
  'staff_users.id of the person signed in when this helper was set up. Kept for the audit trail only — it grants nothing.';

-- "Which helper is THIS computer's?" is asked on every open of Settings → Printing, always scoped to
-- one restaurant. One partial index answers it without a scan; partial because the vast majority of
-- rows will never carry a device.
create index if not exists print_agents_owner_device_idx
  on public.print_agents (restaurant_id, owner_device)
  where owner_device is not null;
