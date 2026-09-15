-- 384_the_last_of_the_retired_stub.sql
--
-- Drops `verification_codes` — the TABLE half of the migration-037 verification stub — and takes
-- the one line that still named it out of `admin_purge_restaurant`.
--
-- WHY NOW, WHEN MIGRATION 360 DELIBERATELY LEFT IT. 360 removed the stub's last FUNCTION and wrote
-- down, carefully, why it stopped there:
--
--     "`verification_codes` DELIBERATELY STAYS, and this is not laziness … But
--      `admin_purge_restaurant` contains `delete from verification_codes where restaurant_id =
--      p_rid;` so dropping the table means hand-editing the body of the function that permanently
--      deletes a restaurant. Re-typing a destructive function to remove an empty table that costs
--      nothing is a worse trade than leaving the table alone. It goes when the purge is next
--      touched for its own reasons."
--
-- That reasoning is right, and the risk it names is the real one: a typo inside the purge deletes
-- the wrong thing, or quietly stops deleting the right thing, and nobody finds out until a
-- restaurant is removed for good. The owner asked for this on 2026-09-15, so the question is not
-- whether to do it but how to do it without paying that price.
--
-- NOBODY RE-TYPED ANYTHING. The body below was GENERATED from the live definition
-- (`pg_get_functiondef`, the newest definition in the sequence — migration 380's), with the single
-- `delete from verification_codes …` line filtered out, under an assertion that refused to write the
-- file unless EXACTLY ONE line had been removed. Every other line, comment and blank is byte-for-byte
-- what migration 380 left. So this is not a re-typing of a destructive function; it is the deletion
-- of one line from it, and `npm run verify:db-parity` compares the result back against the database.
--
-- WHAT IS ACTUALLY GOING. `verification_codes` holds one-time codes for a phone/email verification
-- system that was never switched on. It is EMPTY (0 rows, checked), RLS-locked with no policy, and
-- read by nothing: both of its functions are gone (`lfh_check_verification` by 267 and again by 297,
-- `lfh_request_verification` by 360), and this purge line was its last reference anywhere in the
-- product. It has carried a RETIRED comment since migration 267.
--
-- THE MONEY IS NOT INVOLVED. This table has never held a sale, a bill or a payment; the compliance
-- rule that a sale can be cancelled but never disappear is untouched by it.
--
-- ORDER MATTERS: the function stops naming the table BEFORE the table goes, so there is no instant
-- at which the purge refers to something absent.

create or replace function public.admin_purge_restaurant(p_rid uuid)
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

-- The grants are preserved by CREATE OR REPLACE, and re-stated here so this file's end state is
-- readable on its own (service_role only — the admin console's server is the only caller).
revoke all on function public.admin_purge_restaurant(uuid) from public, anon, authenticated;
grant execute on function public.admin_purge_restaurant(uuid) to service_role;

-- …and now the table itself. Idempotent, and safe where it is already gone.
drop table if exists public.verification_codes;

notify pgrst, 'reload schema';
