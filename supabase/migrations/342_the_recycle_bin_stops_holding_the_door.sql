-- 342 · The recycle bin stops holding the door shut
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Owner, 2026-08-20: *"i wanna chnage the rule that you camn't permamnetly delete from recycle bin
-- what i wanna do is you can able to dlete from recycyle bin"*.
--
-- Since migration 128 a binned restaurant could only be permanently removed 90 days after it was
-- binned, and admin_purge_restaurant() raised `Retention lock: …` to enforce that in the database
-- itself — deliberately, so the wait could not be talked around from the app. The recycle bin is
-- the ADMIN's own console on his own platform: a restaurant he binned this morning could not be
-- cleared out until November. That wait is what he is removing.
--
-- WHAT THIS MIGRATION CHANGES: exactly one `if` — the retention lock. Nothing else about the
-- function moves.
--
-- WHAT DELIBERATELY STAYS, because none of it was the thing he objected to:
--   · The DEFAULT restaurant can never be purged.
--   · A restaurant must be IN the recycle bin first — purge is never a one-step delete.
--   · A restaurant can never be purged twice.
--   · **THE MONEY IS STILL KEPT.** Migration 309's rule is untouched: orders, order_items,
--     sessions, payments, session_payments, credit_notes, invoice_events, deletion_audit and the
--     numbering counters all survive a purge, mig 190's immutability trigger still guards them,
--     and the restaurants row itself survives (marked `purged_at`) so those bills have something
--     to hang off. A sale can never disappear (docs/COMPLIANCE-GUARDRAILS.md §3.0) and removing a
--     restaurant was never a route around that — this migration does not open one.
--   · The app keeps its own rails on top: type the restaurant's exact name to confirm, the offer
--     to download a full backup file first, and an audit row for the removal.
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
  -- ── THE RETENTION LOCK IS GONE (owner, 2026-08-20) ──────────────────────────────────────────
  -- It used to read:
  --     if now() < r.deleted_at + interval '90 days' then
  --       raise exception 'Retention lock: this restaurant cannot be purged until 90 days …';
  --     end if;
  -- Removed on his instruction. The three rules around it — never the default, never before it is
  -- binned, never twice — are still here, and they are the ones that stop an accident.
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
  -- The row STAYS, marked. It is what the kept bills hang off, and it is already out of every
  -- list in the product (deleted_at is set, which is the precondition for getting here at all).
  update restaurants set purged_at = now() where id = p_rid;
end $$;
-- New functions are PUBLIC-executable by default (the mig 038/267 lesson) — a REPLACE keeps the
-- old grants, but restating them costs nothing and is what `npm run verify:grants` reads.
revoke all on function admin_purge_restaurant(uuid) from public, anon, authenticated;
grant execute on function admin_purge_restaurant(uuid) to service_role;

NOTIFY pgrst, 'reload schema';
