-- 286_a_void_must_say_why.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- VOIDING AN INVOICE REQUIRES A REASON — AT THE DATABASE, NOT ONLY IN ONE ROUTE.
--
-- docs/COMPLIANCE-GUARDRAILS.md is explicit: "Void requires a reason; a re-issue records its
-- reason." mig 189's own header repeats it. But `lfh_void_invoice(p_session, p_reason DEFAULT NULL,
-- p_actor DEFAULT NULL)` accepted a NULL reason and wrote the event with `nullif(btrim(...), '')` —
-- i.e. it deliberately normalised an empty reason to NULL and stored it.
--
-- The rule was enforced in exactly one place: the manager's void-invoice route (a 400 on an empty
-- reason). Everything else could void without one — the admin Repair Kit path, a script, a hand-run
-- fix, or any panel written later. That is the same shape as every other fault this codebase keeps
-- finding: a rule that lives in a caller instead of in the thing it governs.
--
-- Reopening a settled bill is the single most audit-sensitive money action in the product (the
-- invoice number retires, the bill unlocks for edits). "Who reopened this and why" must always have
-- an answer, so the answer is now required where the action happens.
--
-- Body otherwise IDENTICAL to mig 189: the same idempotent no-op when there is nothing live to
-- void, the same settled-lock, the same append-only invoice_events row. Only the reason check and
-- the typed error code are new.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION lfh_void_invoice(p_session uuid, p_reason text default null, p_actor text default null)
returns sessions language plpgsql security definer set search_path = public as $$
declare v sessions;
begin
  select * into v from sessions where id = p_session;
  if not found then raise exception 'session not found'; end if;
  -- nothing live to void → return unchanged, record nothing (unchanged from mig 189)
  if v.invoice_no is null or v.invoice_voided then return v; end if;
  -- settled lock: the bill is finalised, the invoice cannot be reopened (unchanged from mig 189)
  if v.status = 'closed' then
    raise exception 'lfh: invoice locked — the bill is settled and cannot be reopened (use a credit note)'
      using errcode = 'check_violation';
  end if;
  -- A REASON IS REQUIRED. Checked here so no caller can skip it — the manager route already
  -- refused an empty one, but the Repair Kit, a script or a future panel could not be relied on to.
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'lfh: reopening a bill needs a reason — say why this invoice is being voided'
      using errcode = 'check_violation';
  end if;
  update sessions
     set invoice_voided = true, void_reason = btrim(p_reason), void_at = now()
   where id = p_session
   returning * into v;
  insert into invoice_events(session_id, restaurant_id, invoice_no, event, reason, actor)
    values (p_session, v.restaurant_id, v.invoice_no, 'void',
            btrim(p_reason), nullif(btrim(coalesce(p_actor, '')), ''));
  return v;
end $$;

REVOKE ALL ON FUNCTION lfh_void_invoice(uuid, text, text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_void_invoice(uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
