-- 412_a_purge_clears_the_loyalty_points.sql — a permanent removal no longer leaves a restaurant's
-- loyalty points behind (sweep #10 T39 item 6).
--
-- WHERE: Admin console → Restaurants → Recycle bin → "Remove permanently". Backend only — nothing on
-- screen changes; what changes is what is left in the database afterwards.
--
-- WHAT WAS WRONG. Loyalty points (migrations 401 and 403, 2026-09-19) added two tables that carry a
-- restaurant_id: `loyalty_config` (the earn/spend rules) and `loyalty_ledger` (every earn, spend and
-- correction, keyed on the guest's phone number). admin_purge_restaurant() names every table it
-- clears by hand — the tenant foreign keys deliberately have no cascade (mig 078), and the
-- ON DELETE CASCADE on these two never fires because the restaurants ROW is kept (mig 309). So a
-- purged restaurant kept its guests' phone numbers and point balances for ever, while the same
-- function already deletes `customers`, `customer_visits` and `customer_devices` for exactly that
-- reason. `verify:purge` (scripts/verify-purge-classified.mjs) exists to catch a new tenant table
-- nobody classified, and it has been red on these two since they landed.
--
-- THE DECISION, and where it comes from: the owner's rule for a permanent removal is "keep bills
-- forever, purge only the rest" (2026-08-11, mig 309). Points are not a sale. A redemption's effect
-- on money is the discount stored on the kept bill (sessions), which this does not touch.
--
-- This is a CREATE OR REPLACE of the NEWEST definition, migration 384's (which had already removed
-- `verification_codes` and dropped that table), with exactly two delete lines added. Safe to re-run:
-- it only redefines a function. No data is rewritten when it runs.
--
-- ⚠ THE FIRST DRAFT OF THIS FILE WAS BUILT ON MIGRATION 380, NOT 384 (sweep #10 T39, 2026-10-08).
-- 384 writes `create or replace function` in lower case and a case-sensitive search for the newest
-- definition skipped it — so that draft put `delete from verification_codes` back into the purge,
-- a table 384 drops, and "Remove permanently" failed with `relation "verification_codes" does not
-- exist` for the ~40 minutes it was live on the dev database. verify:recycle-bin caught it.
-- verify:purge now also fails if the purge names a table the database does not have.

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
  -- ── LOYALTY POINTS (mig 401/403), added by migration 412 ─────────────────────────────────────
  -- The ledger is keyed on a guest's PHONE, like customer_visits above, and `customers` (whose
  -- `points` column is only a cache of it) is already purged. A redemption's money effect is the
  -- discount written on the kept bill itself, so nothing financial is lost. Ledger first: it is
  -- the child of the rules in meaning, though neither has a foreign key on the other.
  delete from loyalty_ledger      where restaurant_id = p_rid;
  delete from loyalty_config      where restaurant_id = p_rid;
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

-- Still staff-only: CREATE OR REPLACE keeps existing grants, but the next reader should see them.
REVOKE ALL ON FUNCTION public.admin_purge_restaurant(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_restaurant(uuid) TO service_role;
