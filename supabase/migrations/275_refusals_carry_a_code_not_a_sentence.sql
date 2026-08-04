-- 275 · a refusal the app must recognise gets its own CODE, not an English sentence
--
-- FOUND BY the 2026-08-04 API sweep (finding F22), and the real mechanism is worse than it looked.
--
-- Five route branches decide what to tell a person by matching the WORDS of a database exception:
--
--   app/api/editor/[...path]/route.ts   /invoice locked/i   (generate, void)
--   app/api/tablet/[...path]/route.ts   /invoice locked/i   (generate)
--   app/api/editor/[...path]/route.ts   /cannot exceed/i    (credit note)
--   app/api/admin/bills/route.ts        /cannot exceed/i    (credit note)
--
-- The raises DO already carry `using errcode = 'check_violation'` — so at first glance the codes are
-- there and unused. But the routes then do:
--
--     if (/invoice locked/i.test(error.message)) return err("…", 409);
--     throw new Error(error.message);            ← a NEW Error: `.code` is LOST here
--
-- so on the fall-through the SQLSTATE never reaches lib/dbRefusal.ts. It sees an error with no code
-- and a message that matches none of its patterns, and classifies it as an unknown failure → 500.
-- And a 500 on a write means "the server is struggling" (public/panels/outbox.js): the action is
-- QUEUED AND REPLAYED FOREVER. So reword that SQL sentence — translate it, drop the em-dash, say
-- "bill locked" instead of "invoice locked" — and a waiter tapping Invoice on a settled bill stops
-- being told "this bill is settled" and instead gets a blue "saved, sending later" bar, while the
-- app retries a request that can never succeed.
--
-- `check_violation` is also too generic to branch on: it is 23514, which any CHECK constraint in the
-- schema raises, so a route cannot use it to mean "this specific refusal" without catching others.
--
-- THE FIX, both halves:
--   1. (here) each refusal the app must RECOGNISE gets its own SQLSTATE. Custom codes live in the
--      'LFH' space — 5 chars, which is all Postgres requires — so they can never collide with a
--      real Postgres condition and never change when someone edits the wording.
--   2. (in the routes) branch on `error.code`, and rethrow in a way that PRESERVES the code so
--      lib/dbRefusal.ts can still classify it. Both codes are registered there as data refusals, so
--      even a branch nobody wrote answers 4xx — never a 500 the outbox retries behind a person.
--
-- The SENTENCES ARE UNCHANGED on purpose: they are still what a developer reads in the error log,
-- and the routes keep matching them as a FALLBACK so a database that has not run this migration yet
-- behaves exactly as before. Nothing regresses on a stale copy.
--
--   LFH01 — the invoice is locked (the bill is settled and cannot be reopened)
--   LFH02 — the credit note is bigger than the bill total
--
-- Captured with pg_get_functiondef()'s current bodies, NOT copied from migrations 189/194, so a
-- later fix to either function is not silently reverted (the documented recreate-reverts-a-fix trap).

-- ── LFH01 · lfh_generate_invoice — refuses to RE-issue a settled bill ────────────────────────────
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
  update sessions
     set invoice_no = lfh_next_seq(coalesce(v.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid), 'invoice'),
         invoice_at = now(), invoice_voided = false, void_reason = null, void_at = null
   where id = p_session
   returning * into v;
  insert into invoice_events(session_id, restaurant_id, invoice_no, event, reason, actor)
  values (p_session, v.restaurant_id, v.invoice_no, 'generate', p_reason, p_actor);
  return v;
end $$;

-- ── LFH01 · lfh_void_invoice — refuses to void once the bill is settled ──────────────────────────
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
      using errcode = 'LFH01';
  end if;
  update sessions
     set invoice_voided = true, void_reason = p_reason, void_at = now()
   where id = p_session
   returning * into v;
  insert into invoice_events(session_id, restaurant_id, invoice_no, event, reason, actor)
  values (p_session, v.restaurant_id, v.invoice_no, 'void', p_reason, p_actor);
  return v;
end $$;

-- Staff-only, same as every other lfh_ function (the mig-038 rule: a replaced function is
-- PUBLIC-executable again by default).
revoke all on function lfh_generate_invoice(uuid, text, text) from public, anon, authenticated;
revoke all on function lfh_void_invoice(uuid, text, text)     from public, anon, authenticated;
grant execute on function lfh_generate_invoice(uuid, text, text) to service_role;
grant execute on function lfh_void_invoice(uuid, text, text)     to service_role;

-- ── LFH02 · lfh_issue_credit_note — refuses a credit bigger than the bill ────────────────────────
-- Same treatment. This one matters just as much: a credit note is a MONEY document, and a refused
-- one arriving as a 500 would be queued and retried, so a person would never learn their figure was
-- too big — they would just see "saved, sending later" and the credit would never exist.
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
      using errcode = 'LFH02';
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
