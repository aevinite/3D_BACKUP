-- 407 — A REOPENED BILL KEEPS ITS INVOICE NUMBER (owner, 2026-09-25)
--
-- His words, asked which behaviour he wanted after being shown that reopening an invoiced bill
-- fails outright: *"do one thing like repoining will have same no it will show that it was
-- reopen … cuz like reopen one also item can be added can't be remove and added item only can
-- be remove im taking about item which are added after reopen"*
--
-- ═══ THE BUG THIS FIXES ═══
--
-- Reopening a bill that already carries an invoice number RAISED, every time:
--
--     lfh: invoice 98 is issued — a tax invoice number is never changed or erased
--     (void it, or issue a credit note)                                        | 23514
--
-- Two rules were pointing in opposite directions:
--   · mig 331's lfh_generate_invoice is written to RE-NUMBER a voided invoice —
--     `if v.invoice_no is not null and not v.invoice_voided then return v; end if;` falls
--     through for a voided one, and the UPDATE below it drew a fresh lfh_next_seq().
--   · mig 398's trg_invoice_identity_is_final refuses ANY change to invoice_no once it is set,
--     with no exception for a voided one — and it is right to, because a number that can move
--     is a number that can be laundered.
--
-- The trigger wins, so the reopen simply errored. Nothing wrong was ever recorded; the screen
-- offered something the database would not do. (Its tooltip even promised the opposite: "The
-- invoice number is retired and a new one is drawn when you print." That copy goes too.)
--
-- ═══ WHY "SAME NUMBER" IS THE RIGHT ANSWER AND NOT JUST THE EASY ONE ═══
--
-- The alternative was to let a voided number be replaced by a strictly higher one. That keeps
-- the series consecutive, but it spends a number per reopen and leaves the guest holding paper
-- whose number no longer names their bill. Keeping the number means the document a guest was
-- handed and the row in the books stay the same document — which is what CGST Rule 46(b) is
-- protecting when it asks for a serial that is unique for the financial year. A reopen is not
-- a new supply; it is the same supply, still being served.
--
-- `invoice_at` is NOT touched either (mig 398 refuses that too, for the same reason: an invoice
-- is dated when it was issued). That has a second use — it is the stable line the panel and the
-- route now use to decide which items may still be taken off a reopened bill. Everything on the
-- bill at `invoice_at` was on the paper and is frozen; anything added after the reopen was
-- never on it and can still be removed. See app.js `lockedAtInvoice()`.
--
-- ═══ WHAT CHANGES ═══
--
--   1. `invoice_reopen_count` — new, additive, default 0. Incremented when a voided invoice is
--      brought back. `invoice_voided = true` already says "reopened RIGHT NOW"; this says "has
--      been reopened before", which is what the bill has to show once it is live again.
--   2. lfh_generate_invoice re-uses the existing number instead of drawing a new one. Because
--      it no longer writes invoice_no or invoice_at, trg_invoice_identity_is_final (which is
--      BEFORE UPDATE **OF invoice_no, invoice_at**) does not even fire. The guard is untouched
--      and still refuses a real re-number.
--
-- The LFH01 settled lock and the LFH02 cancelled-sale refusal from 330/331 are carried through
-- unchanged — this file restates the whole body, so it must not quietly drop either.
--
-- ⚠️ A REPLACED FUNCTION IS PUBLIC-EXECUTABLE AGAIN BY DEFAULT (the mig 038/267 lesson) — the
-- REVOKE/GRANT at the bottom is not optional, and `npm run verify:grants` fails without it.

alter table sessions add column if not exists invoice_reopen_count int not null default 0;

comment on column sessions.invoice_reopen_count is
  'How many times this invoice has been brought back after a reopen (mig 407). The NUMBER never '
  'changes — this is how the bill shows it was reopened once it is live again. invoice_voided '
  'covers the state while it is open on the floor.';

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
  -- 330: nothing to invoice. Every order on this bill is cancelled or tombstoned — there is no
  -- supply, so there is no tax invoice. Checked before the counter is touched, so a refused
  -- request never burns a number. A bill that already HAS a number keeps it; this only stops a
  -- NEW one being drawn.
  if not exists (
    select 1 from orders o
     where o.session_id = p_session
       and o.deleted_at is null
       and o.status <> 'cancelled'
  ) then
    raise exception 'lfh: this bill was cancelled — a cancelled sale never takes an invoice number'
      using errcode = 'LFH02';
  end if;

  if v.invoice_no is not null then
    -- ── BRINGING A REOPENED BILL BACK (407) ────────────────────────────────────────────────
    -- Same number, same date, one more reopen on the counter. invoice_no and invoice_at are
    -- deliberately absent from this UPDATE: writing them even with identical values would fire
    -- mig 398's BEFORE UPDATE OF trigger for nothing.
    update sessions
       set invoice_voided = false, void_reason = null, void_at = null,
           invoice_reopen_count = coalesce(invoice_reopen_count, 0) + 1
     where id = p_session
     returning * into v;
  else
    update sessions
       set invoice_no = lfh_next_seq(coalesce(v.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid), 'invoice'),
           invoice_at = now(), invoice_voided = false, void_reason = null, void_at = null
     where id = p_session
     returning * into v;
  end if;

  -- The trail still records a 'generate' against the number, so a void followed by a generate
  -- reads as exactly what happened: this invoice was reopened and put back.
  insert into invoice_events(session_id, restaurant_id, invoice_no, event, reason, actor)
  values (p_session, v.restaurant_id, v.invoice_no, 'generate', p_reason, p_actor);
  return v;
end $$;

revoke all on function lfh_generate_invoice(uuid, text, text) from public, anon, authenticated;
grant execute on function lfh_generate_invoice(uuid, text, text) to service_role;
