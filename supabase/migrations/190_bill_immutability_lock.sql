-- 190_bill_immutability_lock.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- DATABASE-LEVEL bill immutability: an ISSUED bill can never be HARD-deleted — by
-- anyone, INCLUDING admin / the service role / a stray script. This is the "the tool
-- is physically incapable of hiding a sale" backstop (owner, 2026-07-25): the app's
-- normal paths already soft-delete (mig 188), but a BEFORE-DELETE trigger makes the
-- rule true at the data layer too, so even god-mode can't erase a real sale.
--
-- "Issued" = a bill that ever became a real sale: an ORDER that was paid or served, or
-- whose SESSION got a bill_no; a SESSION that got a bill_no or invoice_no. Un-issued
-- scratch (an abandoned tap that was never numbered/paid/served) may still be removed.
--
-- The ONE legitimate permanent erase — the 90-day restaurant purge (admin_purge_restaurant,
-- backed up first) — flips a transaction-local flag `lfh.allow_purge='on'` that the trigger
-- honours. Nothing else sets it, so nothing else can erase an issued bill.
--
-- Additive + safe: a trigger + a recreated purge fn (verbatim + the flag) + two narrow,
-- service-role-only test-cleanup helpers so dev verification/seed scripts keep working.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. The guard. Fires BEFORE DELETE on orders + sessions.
create or replace function lfh_block_issued_delete() returns trigger
  language plpgsql as $$
declare issued boolean := false;
begin
  -- Explicit, transaction-local escape hatch — set ONLY by the audited purge path.
  if coalesce(current_setting('lfh.allow_purge', true), '') = 'on' then
    return old;
  end if;

  if tg_table_name = 'orders' then
    issued := (old.payment_status = 'paid')
           or (old.status = 'served')
           or exists (select 1 from sessions s where s.id = old.session_id and s.bill_no is not null);
  elsif tg_table_name = 'sessions' then
    issued := (old.bill_no is not null) or (old.invoice_no is not null);
  end if;

  if issued then
    raise exception 'lfh: an issued bill cannot be hard-deleted — soft-delete it (deleted_at) instead (% %)', tg_table_name, old.id
      using errcode = 'check_violation',
            hint = 'Corrections use void / soft-delete; permanent erase only via the 90-day restaurant purge.';
  end if;
  return old;
end $$;
revoke all on function lfh_block_issued_delete() from public, anon, authenticated;

drop trigger if exists trg_block_issued_delete on orders;
create trigger trg_block_issued_delete before delete on orders
  for each row execute function lfh_block_issued_delete();

drop trigger if exists trg_block_issued_delete on sessions;
create trigger trg_block_issued_delete before delete on sessions
  for each row execute function lfh_block_issued_delete();

-- 2. Recreate admin_purge_restaurant VERBATIM (mig 128) + the flag, so the ONE
--    legitimate permanent erase still works. The flag is transaction-local (is_local),
--    so it only covers THIS function's own DELETEs and evaporates when it returns.
create or replace function admin_purge_restaurant(p_rid uuid)
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
  if now() < r.deleted_at + interval '90 days' then
    raise exception 'Retention lock: this restaurant cannot be purged until 90 days after deletion (deleted_at=%)', r.deleted_at;
  end if;

  -- Authorised, retention-passed, backed-up erase → allow the issued-bill deletes below.
  perform set_config('lfh.allow_purge', 'on', true);

  delete from order_items       where restaurant_id = p_rid;
  delete from payments          where restaurant_id = p_rid;
  delete from aggregator_orders where restaurant_id = p_rid;
  delete from feedback          where restaurant_id = p_rid;
  delete from reviews           where restaurant_id = p_rid;
  delete from waiter_calls      where restaurant_id = p_rid;
  delete from requests          where restaurant_id = p_rid;
  delete from session_members   where restaurant_id = p_rid;
  delete from orders            where restaurant_id = p_rid;
  delete from sessions          where restaurant_id = p_rid;
  delete from menu_items        where restaurant_id = p_rid;
  delete from categories        where restaurant_id = p_rid;
  delete from filters           where restaurant_id = p_rid;
  delete from customers          where restaurant_id = p_rid;
  delete from blocklist          where restaurant_id = p_rid;
  delete from otp_codes          where restaurant_id = p_rid;
  delete from verification_codes where restaurant_id = p_rid;
  delete from staff_actions      where restaurant_id = p_rid;
  delete from realtime_events    where restaurant_id = p_rid;
  delete from daily_counters     where restaurant_id = p_rid;
  delete from seq_counters       where restaurant_id = p_rid;
  delete from invoice_events     where restaurant_id = p_rid;  -- mig 189 table (added to the purge)
  delete from restaurant_owners   where restaurant_id = p_rid;
  delete from restaurant_payments where restaurant_id = p_rid;
  delete from restaurant_billing  where restaurant_id = p_rid;
  delete from issues              where restaurant_id = p_rid;
  update restaurants set owner_user_id = null where id = p_rid;
  delete from staff_users where restaurant_id = p_rid;
  delete from settings    where restaurant_id = p_rid;
  delete from restaurants where id = p_rid;
end $$;
revoke all on function admin_purge_restaurant(uuid) from public, anon, authenticated;
grant execute on function admin_purge_restaurant(uuid) to service_role;

-- 3. Narrow, service-role-only TEST-cleanup doors (dev verification/seed scripts create
--    served/paid rows on a fixed test table; without these the trigger would block their
--    teardown). Scoped to a table or a demo-tag — NOT a generic "delete any bill by id".
create or replace function lfh_test_clear_table(p_rid uuid, p_table text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('lfh.allow_purge', 'on', true);
  delete from order_items where order_id in (select id from orders where restaurant_id = p_rid and table_number = p_table);
  delete from orders   where restaurant_id = p_rid and table_number = p_table;
  delete from sessions where restaurant_id = p_rid and table_number = p_table;
end $$;
revoke all on function lfh_test_clear_table(uuid, text) from public, anon, authenticated;
grant execute on function lfh_test_clear_table(uuid, text) to service_role;

create or replace function lfh_test_clear_demo(p_tag text, p_session_tag text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('lfh.allow_purge', 'on', true);
  delete from order_items where order_id in (select id from orders where discount_note = p_tag);
  delete from orders   where discount_note = p_tag;
  delete from sessions where void_reason = p_session_tag;
end $$;
revoke all on function lfh_test_clear_demo(text, text) from public, anon, authenticated;
grant execute on function lfh_test_clear_demo(text, text) to service_role;

notify pgrst, 'reload schema';
