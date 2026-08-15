-- 331 — A CANCELLED SALE NEVER TAKES AN INVOICE NUMBER (owner, 2026-08-16)
--
-- His words, after being shown that a voided ₹0 bill still offered "🖨 Print bill":
-- "I don't want to give permission to the restaurant owner to delete the bill because he will
--  fake the bill and delete the bill … so what can we do that the restaurant doesn't cheat, and
--  at the same time we can keep the track?"
--
-- THE TWO SITUATIONS, WHICH NEED OPPOSITE ANSWERS (docs/COMPLIANCE-GUARDRAILS.md §3):
--
--   A. cancelled BEFORE any invoice — no supply happened, so no tax invoice may exist. Today
--      lfh_generate_invoice happily drew the next number from seq_counters and stamped it on a
--      bill whose every order was cancelled: the series gained a number attached to ₹0, and the
--      paper that printed was the "CANCELLED — NO CHARGE" sheet carrying a live invoice number.
--      That is what this migration refuses.
--
--   B. an invoice was issued and the sale is undone afterwards — the number STAYS, retired and
--      marked cancelled (mig 073, and the "— voided" line billdoc.js prints). CGST Rule 46(b)
--      wants a serial that is consecutive and unique for the financial year, and a cancelled
--      invoice retained with its own number so the gap in the sequence is explainable; reusing it
--      would put two documents under one number. Unchanged here, deliberately.
--
-- WHY IN THE RPC AND NOT ONLY IN THE ROUTE: three doors reach this function — the manager panel,
-- the waiter tablet and the admin console. A guard in one route is a guard one caller obeys.
--
-- The body below is migration 278's, restated in full with ONE addition (the cancelled check), so
-- this cannot revert the LFH01 settled-lock that came with it. Errcode LFH02 is new and is mapped
-- to a plain sentence by every caller; 278's LFH01 keeps its meaning.
--
-- ⚠️ A REPLACED FUNCTION IS PUBLIC-EXECUTABLE AGAIN BY DEFAULT (the mig 038/267 lesson) — the
-- REVOKE/GRANT at the bottom is not optional, and `npm run verify:grants` fails without it.

create or replace function lfh_generate_invoice(p_session uuid, p_reason text default null, p_actor text default null)
returns sessions language plpgsql security definer set search_path = public as $$
declare v sessions;
begin
  select * into v from sessions where id = p_session;
  if not found then raise exception 'session not found'; end if;
  -- idempotent: a LIVE (non-voided) invoice is never re-numbered
  if v.invoice_no is not null and not v.invoice_voided then return v; end if;
  -- settled lock: a RE-issue (a number already exists) is refused once the bill is closed
  if v.status = 'closed' and v.invoice_no is not null then
    raise exception 'lfh: invoice locked — the bill is settled and cannot be reopened (use a credit note)'
      using errcode = 'LFH01';
  end if;
  -- NEW (330): nothing to invoice. Every order on this bill is cancelled or tombstoned — there is
  -- no supply, so there is no tax invoice. Checked before the counter is touched, so a refused
  -- request never burns a number. A bill that already HAS a number keeps it (case B above); this
  -- only stops a NEW one being drawn.
  if not exists (
    select 1 from orders o
     where o.session_id = p_session
       and o.deleted_at is null
       and o.status <> 'cancelled'
  ) then
    raise exception 'lfh: this bill was cancelled — a cancelled sale never takes an invoice number'
      using errcode = 'LFH02';
  end if;
  update sessions
     set invoice_no = lfh_next_seq(coalesce(v.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid), 'invoice'),
         invoice_at = now(), invoice_voided = false, void_reason = null, void_at = null
   where id = p_session
   returning * into v;
  insert into invoice_events(session_id, restaurant_id, invoice_no, event, reason, actor)
  values (p_session, v.restaurant_id, v.invoice_no, 'generate', p_reason, p_actor);
  return v;
end $$;

-- Staff-only, same as every other lfh_ function (the mig-038 rule: a replaced function is
-- PUBLIC-executable again by default).
revoke all on function lfh_generate_invoice(uuid, text, text) from public, anon, authenticated;
grant execute on function lfh_generate_invoice(uuid, text, text) to service_role;
