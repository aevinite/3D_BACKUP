-- 365 — REOPEN PUTS THE TABLE BACK, NOT THE BILL (owner, 2026-08-26)
--
-- His words, asked directly what "↩ Reopen" should do once a bill has been marked paid:
--
--   "You should reopen table not the bill, and what would happen if the table has already taken
--    the order — it shouldn't be able to reopen. If the table is free, then only it should be able
--    to reopen, and after reopen you can add the order to that particular bill, you can't delete
--    that particular. That's what the thing is."
--
-- WHAT IT USED TO DO. `lfh_void_invoice` (mig 189, restated by 278) refused outright the moment the
-- session was closed:
--
--     if v.status = 'closed' then raise ... 'the bill is settled and cannot be reopened' (LFH01)
--
-- So a party that had paid, left, and then came back for one more coffee had no route at all: the
-- table was free, their bill was finished, and the only thing the app offered was a credit note —
-- which is a refund document, not a way to sell them a coffee.
--
-- WHAT IT DOES NOW. A closed bill may be reopened onto ITS OWN TABLE, and only while that table has
-- nobody else on it. Reopening:
--   · retires the invoice number (marks it voided, with the reason, into invoice_events — mig 189's
--     append-only trail is untouched, and the number is never reused: CGST Rule 46(b));
--   · puts the session back to 'open', so the table is live on the floor again;
--   · leaves every existing order exactly as it is — still paid, still priced, still on the bill.
--
-- WHY "ONLY ONTO A FREE TABLE" IS THE WHOLE SAFETY OF THIS. Two parties on one table number is how
-- one party's food lands on another party's bill. The database already refuses it —
-- `idx_one_open_session_per_table` (mig 082) is UNIQUE on (restaurant_id, table_number) WHERE
-- status = 'open' — so the wrong outcome is impossible either way. What this function adds is a
-- SENTENCE instead of a raw constraint violation, checked before anything is written.
--
-- ADD-ONLY AFTERWARDS, and it needs no new rule here. Every order that was on the bill is
-- payment_status = 'paid', and the editor route has always refused to cancel a paid order. So the
-- reopened bill can take new KOTs and cannot lose the old ones — which is exactly what he asked
-- for. A bill reopened while still UNPAID is the older flow and is unchanged: there the lock does
-- release, because correcting a bill before it is paid is the documented, legal route.
--
-- WHAT THIS DOES NOT DO — deliberately, and do not "finish" it:
--   · it does not un-pay anything. Money collected stays collected.
--   · it does not delete, edit or renumber the retired invoice. The next print draws a NEW number
--     (lfh_generate_invoice), and the old one stays on record marked voided.
--   · it does not reopen a bill whose orders were all cancelled — there is no sale to reopen, and
--     mig 331 would refuse the reprint anyway.
--
-- ⚠️ A REPLACED FUNCTION IS PUBLIC-EXECUTABLE AGAIN BY DEFAULT (the mig 038/267 lesson) — the
-- REVOKE/GRANT at the bottom is not optional, and `npm run verify:grants` fails without it.

create or replace function lfh_reopen_table(p_session uuid, p_reason text default null, p_actor text default null)
returns sessions language plpgsql security definer set search_path = public as $$
declare
  v sessions;
  v_busy uuid;
  v_live int;
begin
  select * into v from sessions where id = p_session;
  if not found then raise exception 'session not found'; end if;

  -- Already live? Nothing to reopen. Idempotent on purpose: a replayed offline write, a double tap
  -- or a second manager pressing the same button must not be an error.
  if v.status = 'open' then return v; end if;

  -- Is there anything to come back to? A bill whose every order was cancelled is not a sale, and
  -- reopening it would put an empty party back on the floor.
  select count(*) into v_live from orders o
   where o.session_id = p_session and o.deleted_at is null and o.status <> 'cancelled';
  if v_live = 0 then
    raise exception 'lfh: every order on this bill was cancelled — there is nothing to reopen'
      using errcode = 'LFH04';
  end if;

  -- THE TABLE MUST BE FREE. Checked here so the person gets a sentence naming the table rather than
  -- a unique-index violation; the index is still the thing that makes it impossible.
  select s2.id into v_busy from sessions s2
   where s2.restaurant_id = v.restaurant_id
     and s2.table_number is not distinct from v.table_number
     and s2.status = 'open'
     and s2.id <> p_session
   limit 1;
  if v_busy is not null then
    raise exception 'lfh: another party is sitting at that table — it has to be free before this bill can be reopened'
      using errcode = 'LFH03';
  end if;

  -- Retire a LIVE invoice number, with its reason, into the append-only trail. A bill that never
  -- drew a number, or whose number is already voided, simply skips this — nothing to retire.
  if v.invoice_no is not null and not v.invoice_voided then
    update sessions
       set invoice_voided = true, void_reason = p_reason, void_at = now()
     where id = p_session
     returning * into v;
    insert into invoice_events(session_id, restaurant_id, invoice_no, event, reason, actor)
    values (p_session, v.restaurant_id, v.invoice_no, 'void', p_reason, p_actor);
  end if;

  -- …and put the table back on the floor. closed_at is cleared so the floor and the day book agree
  -- about which sessions are live; deleted_at is deliberately NOT touched (a binned bill is the
  -- admin's own business and is not reopened from here).
  update sessions
     set status = 'open', closed_at = null
   where id = p_session
   returning * into v;

  return v;
end $$;

-- Staff-only, same as every other lfh_ function (the mig-038 rule: a replaced function is
-- public-executable again by default, so this is restated every time the body changes).
revoke all on function lfh_reopen_table(uuid, text, text) from public, anon, authenticated;
grant execute on function lfh_reopen_table(uuid, text, text) to service_role;
