-- 189_invoice_events_and_settled_lock.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Invoice history + the two owner rules (2026-07-25):
--   1. A BILL can never be reopened. Only the INVOICE can be voided/re-issued,
--      and ONLY while the table is NOT settled (session still open). Once the bill
--      is closed/settled the invoice locks — corrections go via a credit note.
--   2. Every generate/void is recorded forever (who, when, which number, WHY) so
--      the admin can show "invoice generated N times, with reasons" and re-issues
--      are provably deliberate (tamper-evident — the sales-suppression shield).
--
-- Additive + safe: a new append-only table, and the two invoice RPCs recreated
-- (dropped first so the added params don't create an ambiguous overload; grants
-- re-applied). The generate body preserves the LIVE per-restaurant sequence (080).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Append-only invoice history.
create table if not exists invoice_events (
  id            bigint generated always as identity primary key,
  session_id    uuid not null,
  restaurant_id uuid,
  invoice_no    int,
  event         text not null check (event in ('generate','void')),
  reason        text,
  actor         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_invoice_events_session on invoice_events(session_id, created_at);
create index if not exists idx_invoice_events_rid on invoice_events(restaurant_id, created_at desc);

-- 2. GENERATE — accepts an optional reason (captured on a RE-issue) + actor, records a
--    'generate' event, and REFUSES to re-issue once the bill is settled (session closed).
--    A first-ever invoice on an open OR closed table is allowed; a RE-issue is open-only.
drop function if exists lfh_generate_invoice(uuid);
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
      using errcode = 'check_violation';
  end if;
  update sessions
     set invoice_no = lfh_next_seq(coalesce(v.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid), 'invoice'),
         invoice_at = now(), invoice_voided = false, void_reason = null, void_at = null
   where id = p_session
   returning * into v;
  insert into invoice_events(session_id, restaurant_id, invoice_no, event, reason, actor)
    values (p_session, v.restaurant_id, v.invoice_no, 'generate',
            nullif(btrim(coalesce(p_reason, '')), ''), nullif(btrim(coalesce(p_actor, '')), ''));
  return v;
end $$;

-- 3. VOID — records a 'void' event with its reason + actor, and REFUSES once the bill
--    is settled (session closed). No-ops when there is no live invoice to void.
drop function if exists lfh_void_invoice(uuid, text);
create or replace function lfh_void_invoice(p_session uuid, p_reason text default null, p_actor text default null)
returns sessions language plpgsql security definer set search_path = public as $$
declare v sessions;
begin
  select * into v from sessions where id = p_session;
  if not found then raise exception 'session not found'; end if;
  -- nothing live to void → return unchanged, record nothing
  if v.invoice_no is null or v.invoice_voided then return v; end if;
  -- settled lock: the bill is finalised, the invoice cannot be reopened
  if v.status = 'closed' then
    raise exception 'lfh: invoice locked — the bill is settled and cannot be reopened (use a credit note)'
      using errcode = 'check_violation';
  end if;
  update sessions
     set invoice_voided = true, void_reason = p_reason, void_at = now()
   where id = p_session
   returning * into v;
  insert into invoice_events(session_id, restaurant_id, invoice_no, event, reason, actor)
    values (p_session, v.restaurant_id, v.invoice_no, 'void',
            nullif(btrim(coalesce(p_reason, '')), ''), nullif(btrim(coalesce(p_actor, '')), ''));
  return v;
end $$;

-- 4. Staff-only (new functions are PUBLIC-executable by default — mig-038 gotcha).
revoke all on function lfh_generate_invoice(uuid, text, text) from public, anon, authenticated;
grant  execute on function lfh_generate_invoice(uuid, text, text) to service_role;
revoke all on function lfh_void_invoice(uuid, text, text)    from public, anon, authenticated;
grant  execute on function lfh_void_invoice(uuid, text, text)    to service_role;

notify pgrst, 'reload schema';
