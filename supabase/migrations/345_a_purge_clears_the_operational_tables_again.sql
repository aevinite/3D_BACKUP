-- 345 · A purge clears the operational tables again
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Migration 342 removed the recycle bin's 90-day retention lock, exactly as the owner asked. Its
-- own header states the scope:
--
--     "WHAT THIS MIGRATION CHANGES: exactly one `if` — the retention lock.
--      Nothing else about the function moves."
--
-- Something else moved. 342 was written from migration 309's body rather than 321's, so it silently
-- dropped the whole block that migration 321 had added — TWENTY-TWO tables that a permanent removal
-- had been clearing since 2026-08-16. `verify:fix-survives` is the guard that exists for precisely
-- this shape ("a rewritten database function has not dropped a fix it already had") and it went red
-- on the merge; nothing else would have noticed, because a purge that leaves rows behind still
-- reports success.
--
-- WHY THOSE TABLES HAVE TO BE NAMED (migration 321's finding, restated so this cannot happen a
-- third time). Migration 190's purge ended with `delete from restaurants`, so every table declaring
-- `restaurant_id … REFERENCES restaurants(id) ON DELETE CASCADE` was cleared for free and none of
-- them was ever written down. Migration 309 stopped deleting that row — the kept bills hang off it —
-- so THE CASCADE NEVER FIRES ANY MORE. From that moment the only thing clearing these tables was
-- the explicit list, and 342 dropped the list.
--
-- WHAT WAS BEING LEFT BEHIND after a permanent delete, until this migration:
--   · the whole inventory book — vendors, items, purchases, counts, movements, waste, recipe lines
--   · expenses, banquet configuration, table QR codes and table tags
--   · printer history and the print-job queue
--   · every rate-limit rule, counter and event
--   · error signatures and the orders change watermark
--   · customer_visits and customer_devices — GUEST CONTACT DATA. `customers` was deleted, so the
--     admin's screens showed the guests gone while their visit history and device rows stayed.
--     That is the one on this list that is about a person rather than about tidiness.
--
-- WHAT THIS MIGRATION DOES NOT CHANGE. The retention lock stays gone (that was the owner's
-- decision, and it is not revisited here). The three rules that stop an accident — never the
-- default restaurant, never before it is binned, never twice — are untouched. And THE MONEY IS
-- STILL KEPT: orders, order_items, sessions, payments, session_payments, credit_notes,
-- invoice_events, deletion_audit and the numbering counters all survive, `lfh.allow_purge` is never
-- opened, mig 190's immutability trigger still stands guard, and the restaurants row still survives
-- marked with `purged_at`. A sale can never disappear (docs/COMPLIANCE-GUARDRAILS.md §3.0) and this
-- migration does not open a route around that.
--
-- Additive and re-runnable: CREATE OR REPLACE on one function, no data rewrite, no new column.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_purge_restaurant(p_rid uuid)
returns void language plpgsql security definer set search_path = public as $$
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
  -- Deliberately NOT reinstated here. This migration is only putting back the delete list that
  -- 342 dropped by accident; his decision about the 90-day wait stands.
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
  -- ── the operational tables that used to go with the restaurants ROW (mig 321, restored here) ──
  -- These are the 22 that migration 342 dropped. They are named explicitly because the cascade that
  -- used to clear them stopped firing at migration 309 — see this file's header.
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
  delete from table_qr_codes      where restaurant_id = p_rid;
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
  --   banquet_bills / session_payments / invoice_events / credit_notes / deletion_audit — money.
  --   staff_payments  — already gone: it cascades from staff_users, deleted above.

  -- The row STAYS, marked. It is what the kept bills hang off, and it is already out of every
  -- list in the product (deleted_at is set, which is the precondition for getting here at all).
  update restaurants set purged_at = now() where id = p_rid;
end $$;

-- A new function is PUBLIC-executable by default (the mig 038/267 lesson), and CREATE OR REPLACE
-- keeps the existing grants — but state them anyway so a future recreate from this file alone
-- cannot quietly hand the purge to anon. `verify:grants` guards this.
--
-- BOTH lines, not just the revoke (sweep T23, 2026-08-21). Migrations 128, 190, 309, 321 and 342 all
-- write the REVOKE and the GRANT as a pair; this file and 346 stated only the first half. On every
-- existing database that changes nothing — CREATE OR REPLACE keeps what 342 granted — but the
-- comment above promises the file can stand alone, and half a pair cannot. Rebuilt from this file
-- on a database that did not already have the function, the REVOKE would land on a brand-new
-- object and service_role would be left with no EXECUTE at all: Admin console → Restaurants →
-- Recycle bin → "Remove permanently" would answer "permission denied for function
-- admin_purge_restaurant", which is the exact case `verify:grants`' "no route can be locked out of
-- its own RPC" check exists for.
REVOKE ALL     ON FUNCTION admin_purge_restaurant(uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_purge_restaurant(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
