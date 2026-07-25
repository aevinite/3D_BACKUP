-- 194_credit_notes.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Post-settlement corrections done the LEGAL way. Once a bill is settled its invoice
-- locks (mig 189) and it can't be edited/deleted — so a refund/correction is issued as
-- a CREDIT NOTE: a NEW, numbered, immutable document LINKED to the original bill, never
-- a change to the settled bill itself. This is what staff use instead of asking for the
-- illegal "just edit/delete it" button.
--
-- Append-only: credit notes are never edited or deleted (they're financial records). The
-- restaurant_id cascade FK means the 90-day restaurant purge cleans them up automatically
-- (no change to admin_purge_restaurant needed).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists credit_notes (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  session_id    uuid,                       -- the bill (session) this credits
  invoice_no    int,                        -- the original invoice number, for the record
  credit_no     int  not null,              -- per-restaurant sequential (seq_counters 'credit_note')
  amount        numeric not null check (amount > 0),
  reason        text not null,
  actor         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_credit_notes_session on credit_notes(session_id, created_at);
create index if not exists idx_credit_notes_rid     on credit_notes(restaurant_id, created_at desc);

-- Issue a credit note against a bill. Amount must be > 0 and not exceed the bill's net
-- total; a reason is required. Assigns a per-restaurant sequential credit_no.
create or replace function lfh_issue_credit_note(p_session uuid, p_amount numeric, p_reason text, p_actor text default null)
returns credit_notes language plpgsql security definer set search_path = public as $$
declare v_sess sessions; v_total numeric; v_row credit_notes;
begin
  select * into v_sess from sessions where id = p_session;
  if not found then raise exception 'session not found'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'credit amount must be positive'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required for a credit note'; end if;

  select coalesce(sum(total), 0) into v_total from orders
   where session_id = p_session and deleted_at is null;
  if p_amount > v_total + 0.01 then
    raise exception 'credit (₹%) cannot exceed the bill total (₹%)', round(p_amount,2), round(v_total,2)
      using errcode = 'check_violation';
  end if;

  insert into credit_notes(restaurant_id, session_id, invoice_no, credit_no, amount, reason, actor)
    values (v_sess.restaurant_id, p_session, v_sess.invoice_no,
            lfh_next_seq(coalesce(v_sess.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid), 'credit_note'),
            round(p_amount::numeric, 2), btrim(p_reason), nullif(btrim(coalesce(p_actor, '')), ''))
    returning * into v_row;
  return v_row;
end $$;

revoke all on function lfh_issue_credit_note(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function lfh_issue_credit_note(uuid, numeric, text, text) to service_role;

notify pgrst, 'reload schema';
