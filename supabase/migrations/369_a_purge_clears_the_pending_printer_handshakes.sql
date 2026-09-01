-- 369 · A purge clears the pending printer handshakes too
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ MIGRATION NUMBER: 369, the next free number after main's 368. CREATE OR REPLACE on ONE function
--   plus one extra DELETE — no schema change, no data rewrite — so this file is correct at any
--   number it ends up with if another branch lands a 369 first.
--
-- WHERE IT LIVES: Admin console → Restaurants → Recycle bin → "Remove permanently". Nothing on
-- screen changes. This is the database half of a purge, and it was leaving one table behind.
--
-- WHY IT WAS MISSED — the same shape as migration 346 and again as 354. `npm run verify:purge` went
-- RED the moment `print_pairings` merged (mig 368, the zero-typing print-helper handshake):
--
--     ✗ print_pairings carries a restaurant_id but the purge neither clears it nor keeps it on
--       purpose — add it to admin_purge_restaurant(), or to KEEP/UNDECIDED in this file with the
--       reason
--
-- That guard exists because migration 190's purge ended with `delete from restaurants`, so every
-- table declaring `REFERENCES restaurants(id) ON DELETE CASCADE` was cleared for free and none was
-- ever written down. Migration 309 stopped deleting that row — the kept bills hang off it — so the
-- cascade never fires any more. `print_pairings` declares exactly that cascade, so it looks covered
-- and is not. Third time; the guard is what caught it each time.
--
-- ── THE DECISION, AND WHY IT IS DELETE ─────────────────────────────────────────────────────────
-- The rule the function states about itself: *"Everything below is operational: it describes how
-- the restaurant RAN, not what it SOLD."* A printer handshake is that, and its siblings
-- `print_stations` / `print_agents` have been on the delete list since migration 346 for the same
-- reason. It also must not survive: an allowed-but-uncollected pairing still holds a one-time token
-- that would mint a printing code for a restaurant that no longer exists, and `code` is UNIQUE, so
-- a stale row holds a pairing code for ever.
--
-- NOT a money table. The compliance promise in docs/COMPLIANCE-GUARDRAILS.md §3.0 — a sale can
-- never disappear — is untouched: no bill, invoice, payment or audit row is named here.
--
-- Re-runnable: CREATE OR REPLACE only.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

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
  -- ── the printing SETUP (mig 346) ─────────────────────────────────────────────────────────────
  -- print_agents last: deleting it retires that computer's printing code, which must not outlive
  -- the restaurant it printed for.
  -- ── THE PENDING PRINTER HANDSHAKES, added by migration 369 ──────────────────────────────────
  -- `print_pairings` (mig 368) is the short-lived handshake a print helper starts before a human
  -- allows it: a code, a private secret, and — once allowed — a one-time token. It declares
  -- `restaurant_id ... ON DELETE CASCADE`, which is exactly the trap migrations 346 and 354 both
  -- walked into: migration 309 stopped deleting the `restaurants` row, so that cascade NEVER fires
  -- any more and the only thing clearing a tenant table is this explicit list.
  --
  -- It is deleted, not kept, for the same reason `print_agents` below it is: it describes how the
  -- restaurant PRINTED, not what it SOLD. An allowed-but-uncollected pairing still holds a token
  -- that would mint a printing code for a restaurant that no longer exists, and `code` is UNIQUE,
  -- so a stale row also holds a pairing code for ever. Deleted BEFORE print_agents purely for
  -- readability — `agent_id` is ON DELETE SET NULL, so either order works.
  delete from print_pairings      where restaurant_id = p_rid;
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
