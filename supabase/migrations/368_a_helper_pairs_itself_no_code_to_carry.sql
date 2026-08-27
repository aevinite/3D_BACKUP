-- 368 — the helper pairs ITSELF. One file for every restaurant, and nothing secret inside it.
--
-- Owner, 2026-08-27: *"There wouldn't be one key for all restaurants… or maybe a pairing code or
-- whatever"* and then, on the shape of it: *"zero typing one, yeah"*.
--
-- WHAT WAS WRONG. A helper's code was minted on a SCREEN and then had to travel to a machine: the
-- admin (or the manager) read a 37-character secret off a monitor and typed it into a file. That
-- made the helper file DIFFERENT for every restaurant — it could not be hosted, reused, or emailed —
-- and it put a long-lived secret in a plain text file on a shop counter.
--
-- WHY NOT ONE KEY FOR EVERYONE (his first idea, and he withdrew it himself). One key on every
-- client's PC means one leak prints at — and reads the bills of — every restaurant on the platform,
-- and no shop could ever be cut off on its own. Refused.
--
-- WHAT THIS IS INSTEAD, and it is the pattern a smart TV uses to pair with Netflix (the OAuth
-- "device flow"). The machine, not a person, starts the conversation:
--
--   1. the helper — which holds NO secret — says "here I am: this fingerprint, this hostname,
--      these printers". It gets back a pairing row: a short public CODE and a private SECRET that
--      only it holds.
--   2. it opens the browser on ITS OWN machine at /pair?c=<code>. That the page opens on that
--      machine is the whole proof: nobody across the internet can be the machine at the printer.
--   3. a person already signed in there — the admin, or a manager with print_setup — sees the
--      hostname and the printer list it reported and presses ALLOW. Only then is a print_agents row
--      created and a token minted.
--   4. the helper, still polling with its private secret, collects the token exactly ONCE and
--      writes it to its own machine. The pairing row is spent.
--
-- Nobody types anything. The code is never a credential: on its own it can only be APPROVED by a
-- logged-in human, and the token it produces can only be collected by the process that started it.
--
-- EVERY ROW IS SHORT-LIVED. A pairing that nobody approves is rubbish in ten minutes, and one that
-- is approved is spent the moment its token is collected. prune below is called on each new start,
-- so the table stays small without a cron.
create table if not exists public.print_pairings (
  id             uuid primary key default gen_random_uuid(),
  -- What the /pair page is found by. Short enough to read out on the phone if the browser ever
  -- fails to open, long enough that it cannot be guessed inside its ten-minute life.
  code           text not null unique,
  -- Held ONLY by the helper process that started this pairing. It is what stops anyone who merely
  -- sees the code (over a shoulder, in a browser history) from collecting the token.
  secret_hash    text not null,
  -- What the machine said about itself, shown on the Allow page so a person approves a machine they
  -- recognise rather than a code they cannot check.
  fingerprint    text,
  hostname       text,
  printers       jsonb not null default '[]'::jsonb,
  os             text,
  -- Filled in by the APPROVAL, never by the helper: the helper does not get to choose which
  -- restaurant it joins. That is the entire security boundary of this design.
  restaurant_id  uuid references public.restaurants(id) on delete cascade,
  agent_id       uuid references public.print_agents(id) on delete set null,
  approved_at    timestamptz,
  approved_by    uuid,
  -- The minted token, held for the ONE poll that collects it, then blanked. Never readable twice.
  token_once     text,
  collected_at   timestamptz,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '10 minutes'
);

-- Staff-only, like print_agents: RLS on with NO policies, so nothing reaches this table except the
-- service-role routes. A pairing row holds a hostname and a printer list — not secret, but not the
-- anon key's business either.
alter table public.print_pairings enable row level security;

-- The two questions asked of it: "which pairing is this code?" (unique index above) and "clear out
-- the dead ones".
create index if not exists print_pairings_expires_idx on public.print_pairings (expires_at);

comment on table public.print_pairings is
  'Short-lived handshakes for the print helper (mig 368). The helper starts one, a signed-in human approves it, the helper collects its token once. Nothing here lives longer than 10 minutes unapproved.';
