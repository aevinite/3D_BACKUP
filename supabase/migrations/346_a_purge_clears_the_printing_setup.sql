-- 346 · A purge clears the printing setup too
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHERE THIS BITES: Admin console → Restaurants → Recycle bin → "Remove permanently". Nothing on
-- screen changes. This is the database half of a purge, and it was leaving two tables behind.
--
-- WHY IT WAS MISSED: `npm run verify:purge` has been RED since migration 341, naming three tenant
-- tables that admin_purge_restaurant() neither deletes nor keeps on purpose. The printing feature
-- landed after the purge list was last written, and nothing failed when it was forgotten — which is
-- exactly the silent drift that guard exists to stop. Sweep T16 reported it (handoff H1) but the
-- decision was nobody's to take at the time; taking it now.
--
--   · print_stations (mig 338) — WHICH SCREEN prints this restaurant's paper. Operational setup:
--     it describes how the restaurant RAN, not what it SOLD. → DELETED here.
--   · print_agents   (mig 341) — the helper COMPUTERS allowed to fetch this restaurant's print
--     jobs, each holding a sha-256 of its own printing code. Operational, and leaving it behind
--     would leave a live printing credential pointing at a restaurant that no longer operates.
--     → DELETED here. (`print_jobs` and `printer_events` were already cleared by mig 345, so the
--     three printing tables now go together instead of one surviving its own queue.)
--
-- THE THIRD TABLE IS NOT A JUDGEMENT CALL — bill_chain (mig 332) is KEPT, and could not be deleted
-- even if someone wanted to: it carries mig 332's `trg_bill_chain_append_only` trigger, so a DELETE
-- against it RAISES and would abort the entire purge. It is the tamper-evidence for the bills a
-- purge keeps on purpose (mig 309) — throwing it away would leave the kept sales with nothing to
-- prove they were never altered, which is the opposite of what it is for. It is recorded on the
-- KEEP list in scripts/verify-purge-classified.mjs in the same commit as this file.
--
-- WHAT THIS MIGRATION DOES NOT CHANGE:
--   · THE MONEY IS STILL KEPT. Migration 309's rule is untouched — orders, order_items, sessions,
--     payments, session_payments, credit_notes, invoice_events, deletion_audit and the numbering
--     counters all survive, mig 190's immutability trigger still guards them, and the restaurants
--     row itself survives (marked `purged_at`). A sale can never disappear
--     (docs/COMPLIANCE-GUARDRAILS.md §3.0) and this migration opens no route around that.
--   · THE RETENTION LOCK STAYS GONE (owner, 2026-08-20, mig 342 — *"you can able to dlete from
--     recycyle bin"*). Deliberately not reinstated. Neither is the DEFAULT-restaurant block, the
--     must-be-binned-first rule, or the never-purge-twice rule: all three stay exactly as they are.
--
-- Additive and re-runnable: CREATE OR REPLACE on one function, two extra DELETEs, no data rewrite,
-- no new column, no new grant. Both tables cascade from restaurants(id), but the restaurants row is
-- KEPT by design, so that cascade never fires — which is why they must be named here.
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
  -- ── the printing SETUP, added by migration 346 ──────────────────────────────────────────────
  -- The queue above was already cleared; these two are what fed it. Both cascade from
  -- restaurants(id), but the restaurants row is KEPT on purpose (mig 309) so that cascade never
  -- fires — they have to be named. print_agents last: deleting it retires that computer's
  -- printing code, which must not outlive the restaurant it printed for.
  delete from print_stations      where restaurant_id = p_rid;
  delete from print_agents        where restaurant_id = p_rid;
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
  --   bill_chain      — mig 332's append-only trigger REFUSES a delete, and it is the proof the
  --                     kept bills were never altered. Classified KEEP by migration 346.
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
-- BOTH lines, not just the revoke (sweep T23, 2026-08-21) — see the same note in migration 345.
-- Migrations 128 / 190 / 309 / 321 / 342 all write the pair; 345 and this file stated only the
-- REVOKE, which on a rebuild from this file alone would leave service_role with no EXECUTE and
-- break Admin console → Restaurants → Recycle bin → "Remove permanently".
REVOKE ALL     ON FUNCTION admin_purge_restaurant(uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_purge_restaurant(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
