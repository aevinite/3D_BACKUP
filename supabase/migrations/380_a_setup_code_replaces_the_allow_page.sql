-- 380 — the restaurant's screen hands out the code; the computer types it in. No login on that PC.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Owner, 2026-09-13: *"instead of login make something else otherwise the waiter will also do that
-- printing thing and make completely diff login not this"* and then, naming the shape himself:
-- *"you can generate code for each restaurant from printing menu and like the helper ask for that
-- code and that generated code only works for 10 min and all that."*
--
-- WHAT WAS WRONG WITH mig 368's HANDSHAKE. It was the OAuth device flow: the helper minted a code,
-- opened /pair on its own machine, and a SIGNED-IN HUMAN pressed Allow there. Three things broke:
--
--   1. It asked for a STAFF LOGIN on a shop's printer PC. The owner's objection is the right one —
--      the staff login is the waiter's login too, so the door to "I decide where this whole
--      restaurant's paper comes out" was the same door a waiter opens every shift. A permission
--      switch (print_setup) was doing the separating, and a permission switch is not a door.
--   2. A person who WAS signed in but lacked that switch was told *"Sign in on this computer
--      first"* — the server answered `{signedIn:false}` for "no permission", so a manager signed in,
--      and in, and in, for ever. A kitchen login could never pass at all.
--   3. The page's own Sign in button threw the pairing away: /login only honours ?next when it
--      exactly equals that role's home page, so the pairing tab was never returned to.
--
-- WHAT THIS IS INSTEAD, and it is the enrolment-token pattern (how a device joins a managed fleet).
-- The direction of the handshake is REVERSED:
--
--   the Printing screen (a person is ALREADY signed in there)      the computer at the printer
--   ─────────────────────────────────────────────────────────     ───────────────────────────
--   presses "Show a setup code" ──► one code, ten minutes         the helper asks for it
--                                   read it out / carry it ─────► types it once
--                                                                 POST pair/claim
--   the computer appears on the board ◄────────────────────────── gets its token, writes it to disk
--
-- THE CODE IS THE SEPARATE DOOR THE OWNER ASKED FOR. It is not a login: it signs nobody in, it
-- reads nothing, it survives ten minutes, it is spent by the first computer that uses it, and the
-- only thing it can ever do is attach ONE machine to ONE restaurant's printing. A waiter cannot
-- produce one — the Printing screen is behind the admin console or the print_setup switch, exactly
-- as before — and a waiter's own login now opens nothing here at all.
--
-- STORED HASHED, like print_agents.token_hash. For its ten minutes this code IS a credential (that
-- is the trade the owner accepted against "no login on the shop PC"), so the database never holds
-- the plaintext: it is returned once to the screen that asked for it and nowhere else. A board that
-- has lost it says so and offers a fresh one rather than showing the old one again.
--
-- print_pairings (mig 368) is DROPPED in the same breath. "A new way replaces the old one" (owner,
-- 2026-08-29) — and a table whose rows can still mint a printing token, fed by routes nothing calls,
-- is the worst possible thing to leave behind.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

create table if not exists public.print_setup_codes (
  id             uuid primary key default gen_random_uuid(),
  -- Decided by the SCREEN, before the code exists. This is the whole security boundary, and it is
  -- the same one mig 368 had: the machine never chooses which restaurant it joins.
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  -- sha-256 of the typed code, normalised upper-case with spaces and dashes stripped. Never the
  -- plaintext: see the note above.
  code_hash      text not null unique,
  -- Who handed it out, so the Activity log can say it in English and a code that appears in the
  -- wrong hands has a name against it. 'admin' = Aevidine, 'staff' = a manager/owner with
  -- print_setup.
  issued_by_kind text not null check (issued_by_kind in ('admin','staff')),
  issued_by      uuid,
  issued_device  text,
  -- Filled in by the machine that redeems it. A row keeps them so "which computer took that code"
  -- is answerable afterwards; they are the machine's own words about itself, nothing more.
  agent_id       uuid references public.print_agents(id) on delete set null,
  claimed_at     timestamptz,
  claimed_host   text,
  created_at     timestamptz not null default now(),
  -- TEN MINUTES, his number. Long enough to walk from the till to the kitchen computer, short
  -- enough that a code left on a screen is rubbish by the time anybody else reads it.
  expires_at     timestamptz not null default now() + interval '10 minutes'
);

-- Staff-only, exactly like print_agents and the table it replaces: RLS on with NO policies, so
-- nothing but the service-role routes ever reaches it.
alter table public.print_setup_codes enable row level security;

-- The three questions asked of it: "which code is this?" (the unique index above), "is a code still
-- live for this restaurant?" and "clear out the dead ones".
create index if not exists print_setup_codes_live_idx
  on public.print_setup_codes (restaurant_id, expires_at desc);
create index if not exists print_setup_codes_expires_idx
  on public.print_setup_codes (expires_at);

comment on table public.print_setup_codes is
  'Ten-minute, single-use setup codes for the print helper (mig 380). Handed out by the Printing screen, typed into the helper on the computer at the printer. Hashed; nothing here is a login.';

-- ── THE OLD HANDSHAKE'S TABLE GOES ─────────────────────────────────────────────────────────────
-- Nothing reads or writes it after this migration: /pair, /api/pair, pair/start and pair/poll are
-- all deleted in the same change. An approved-but-uncollected row still holds a one-time token, so
-- leaving the table is leaving live credentials behind a door nobody opens any more.
drop table if exists public.print_pairings;

-- ── A GUESSING MACHINE MEETS A WALL ────────────────────────────────────────────────────────────
-- A live code is 6 characters from a 31-letter alphabet (no 0/O/1/I/l — it gets read out loud), so
-- guessing one inside its ten minutes is not a realistic worry on its own. The rule is here because
-- "not realistic" is not "measured", and because the wall is also the ALARM: twenty redemption
-- attempts from one address in ten minutes is somebody trying, and the owner should hear about it.
-- Twenty, not five, because a person mistyping a code they are reading off a phone is ordinary and
-- must never be locked out of setting up their own printer.
insert into rate_limit_rules (restaurant_id, key, label, max_count, window_seconds, enabled) values
  (null, 'print_setup_code', 'Printer setup code attempts', 20, 600, true)
on conflict (key) where restaurant_id is null do nothing;

-- ── AND THE PURGE FOLLOWS THE TABLE (the mig 346 / 354 / 369 trap, for the fourth time) ────────
-- print_setup_codes declares `restaurant_id ... ON DELETE CASCADE`, which LOOKS covered and is not:
-- migration 309 stopped deleting the `restaurants` row, so that cascade never fires and the only
-- thing clearing a tenant table is this explicit list. `npm run verify:purge` is what catches it.
--
-- DELETE, not keep, for the same reason print_agents is deleted: it describes how the restaurant
-- PRINTED, not what it SOLD. `code_hash` is UNIQUE, so a stale row would also hold a code for ever.
-- Not a money table: no bill, invoice, payment, credit note or audit row is named here, so the
-- promise in docs/COMPLIANCE-GUARDRAILS.md §3.0 is untouched.
--
-- This is a CREATE OR REPLACE of mig 369's function with exactly one line changed — `print_pairings`
-- becomes `print_setup_codes` — because the table it named no longer exists and a purge that names
-- a dropped table raises instead of purging.
CREATE OR REPLACE FUNCTION public.admin_purge_restaurant(p_rid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r restaurants%rowtype;
begin
  select * into r from restaurants where id = p_rid for update;
  if not found then raise exception 'Restaurant % not found', p_rid; end if;
  if p_rid = '00000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'The default restaurant can never be purged';
  end if;
  if r.deleted_at is null then
    raise exception 'Restaurant is not in the recycle bin — delete it first';
  end if;
  -- ── THE RETENTION LOCK IS GONE (owner, 2026-08-20, migration 342) ───────────────────────────
  -- Deliberately NOT reinstated here; his decision about the 90-day wait stands.
  if r.purged_at is not null then
    raise exception 'This restaurant has already been purged (purged_at=%) — its bills are kept on purpose', r.purged_at;
  end if;

  -- THE MONEY IS NOT TOUCHED (owner, 2026-08-11 — "keep bills forever, purge only the rest").
  -- Deliberately NOT deleted here, and the `lfh.allow_purge` escape hatch is NOT opened, so mig
  -- 190's immutability trigger still stands guard over every one of them:
  --   orders · order_items · sessions · payments · session_payments · credit_notes
  --   invoice_events · deletion_audit · daily_counters · seq_counters
  -- Everything below is operational: it describes how the restaurant RAN, not what it SOLD.
  delete from aggregator_orders where restaurant_id = p_rid;
  delete from feedback         where restaurant_id = p_rid;
  delete from reviews          where restaurant_id = p_rid;
  delete from waiter_calls     where restaurant_id = p_rid;
  delete from requests         where restaurant_id = p_rid;
  delete from session_members  where restaurant_id = p_rid;
  delete from menu_items       where restaurant_id = p_rid;
  delete from categories       where restaurant_id = p_rid;
  delete from filters          where restaurant_id = p_rid;
  delete from customers        where restaurant_id = p_rid;
  delete from blocklist        where restaurant_id = p_rid;
  delete from otp_codes        where restaurant_id = p_rid;
  delete from verification_codes where restaurant_id = p_rid;
  delete from staff_actions    where restaurant_id = p_rid;   -- the working log; the AUDIT stays
  delete from realtime_events  where restaurant_id = p_rid;
  delete from restaurant_owners   where restaurant_id = p_rid;
  delete from restaurant_payments where restaurant_id = p_rid;
  delete from restaurant_billing  where restaurant_id = p_rid;
  delete from issues              where restaurant_id = p_rid;
  update restaurants set owner_user_id = null where id = p_rid;
  delete from staff_users where restaurant_id = p_rid;
  delete from settings    where restaurant_id = p_rid;
  -- ── the operational tables that used to go with the restaurants ROW (mig 321, restored by 345) ──
  -- Named explicitly because the cascade that used to clear them stopped firing at migration 309.
  -- Child-before-parent order matters: item_id on movements/waste/count_lines is NOT a cascade.
  delete from inv_recipe_lines    where restaurant_id = p_rid;
  delete from inv_movements       where restaurant_id = p_rid;
  delete from inv_waste_entries   where restaurant_id = p_rid;
  delete from inv_count_lines     where restaurant_id = p_rid;
  delete from inv_purchase_lines  where restaurant_id = p_rid;
  delete from inv_counts          where restaurant_id = p_rid;
  delete from inv_purchases       where restaurant_id = p_rid;
  delete from inv_items           where restaurant_id = p_rid;
  delete from inv_vendors         where restaurant_id = p_rid;
  delete from expenses            where restaurant_id = p_rid;
  delete from printer_events      where restaurant_id = p_rid;
  delete from print_jobs          where restaurant_id = p_rid;
  -- ── the printing SETUP (mig 346, re-pointed by mig 380) ─────────────────────────────────────
  -- print_agents last: deleting it retires that computer's printing code, which must not outlive
  -- the restaurant it printed for. print_setup_codes is mig 380's ten-minute setup code — the
  -- table that replaced mig 368's print_pairings when the Allow page was retired. Deleted BEFORE
  -- print_agents purely for readability: `agent_id` is ON DELETE SET NULL, so either order works.
  delete from print_setup_codes   where restaurant_id = p_rid;
  delete from print_stations      where restaurant_id = p_rid;
  delete from print_agents        where restaurant_id = p_rid;
  delete from table_qr_codes      where restaurant_id = p_rid;
  -- ── the RETIRED WEB ADDRESSES, added by migration 354 ────────────────────────────────────────
  -- `restaurant_slug_history` (mig 350) keeps the addresses a restaurant used to answer on so its
  -- old printed QR codes still work. It sits beside table_qr_codes above and is the same kind of
  -- thing: how the restaurant was ADDRESSED, not what it SOLD. It also cannot usefully survive —
  -- a purge deletes settings and menu_items, and lib/tenant.ts hides any restaurant with
  -- deleted_at set, so a kept address could only resolve to a restaurant the resolver already
  -- refuses. `slug` is that table's PRIMARY KEY, so leaving the row would hold an address a new
  -- restaurant might want, for ever.
  delete from restaurant_slug_history where restaurant_id = p_rid;
  delete from table_tags          where restaurant_id = p_rid;
  delete from error_signatures    where restaurant_id = p_rid;
  delete from rate_limit_rules    where restaurant_id = p_rid;
  delete from rate_limit_counters where restaurant_id = p_rid;
  delete from rate_limit_events   where restaurant_id = p_rid;
  delete from customer_visits     where restaurant_id = p_rid;   -- guest phones: `customers` is
  delete from customer_devices    where restaurant_id = p_rid;   -- already purged, these are copies
  delete from banquet_items       where restaurant_id = p_rid;   -- banquet CONFIG (bills are kept)
  delete from orders_change_watermark where restaurant_id = p_rid;
  --
  -- DELIBERATELY KEPT, and why:
  --   khata_customers — kept `orders.khata_customer_id` references it with no ON DELETE, so deleting
  --                     it would FAIL; the pay-later book belongs with the kept bills.
  --   table_merges    — the audit trail of who joined which tables (mig 249: never deleted).
  --   bill_chain      — mig 332's append-only trigger REFUSES a delete, and it is the proof the
  --                     kept bills were never altered. Classified KEEP by migration 346.
  --   banquet_bills / session_payments / invoice_events / credit_notes / deletion_audit — money.
  --   staff_payments  — already gone: it cascades from staff_users, deleted above.

  -- The row STAYS, marked. It is what the kept bills hang off, and it is already out of every
  -- list in the product (deleted_at is set, which is the precondition for getting here at all).
  update restaurants set purged_at = now() where id = p_rid;
end $function$
;

-- ── AND IT STAYS STAFF-ONLY ────────────────────────────────────────────────────────────────────
-- A new Postgres function is PUBLIC-executable by default (the mig 038/267 lesson, guarded by
-- `verify:grants`). CREATE OR REPLACE does not RESET privileges, so this function's existing grants
-- survive mig 369 untouched — but "it happens to be fine" is not what that guard asks for, and the
-- next person replacing this function should see the two lines rather than have to know the rule.
-- It purges a restaurant; `anon` must never be able to call it.
REVOKE ALL ON FUNCTION public.admin_purge_restaurant(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_restaurant(uuid) TO service_role;
