-- 398 — an issued invoice is FINAL, and the fifteen that were left uncorrected get their credit note
-- (owner, 2026-09-18: "do 9 dlete them and make sure it never happen again")
--
-- ═══ WHAT HE ASKED FOR, AND WHAT THIS FILE DOES INSTEAD OF THE FIRST HALF ═══
--
-- He asked for fifteen bills to be DELETED. They are not deleted, and the reason is his own rule —
-- docs/COMPLIANCE-GUARDRAILS.md §3.0, which he set on 2026-08-16:
--
--     "A sale can be cancelled. A sale can never disappear."
--     (4) "No one at the restaurant — the owner included — has a button that removes a bill."
--
-- and R27 in docs/REJECTED-IDEAS.md, in his words: *"I don't want to give permission to the
-- restaurant owner to delete the bill because he will fake the bill and delete the bill … so what
-- can we do that the restaurant doesn't cheat, and at the same time we can keep the track?"*
--
-- THE PRODUCT HE BUILT ALREADY REFUSES IT, which is the strongest answer available. Driven against
-- the dev database before writing a line of this file, one of the fifteen at a time:
--
--     DELETE FROM sessions WHERE id = <one of them>   → 23514 "lfh: an issued bill cannot be
--     DELETE FROM orders  WHERE session_id = <it>     →        hard-deleted — soft-delete it
--                                                              (deleted_at) instead"   (mig 190)
--     SELECT lfh_void_invoice(<it>, 'reason')         → LFH01 "invoice locked — the bill is settled
--                                                              and cannot be reopened (USE A CREDIT
--                                                              NOTE)"                  (mig 189/278)
--
-- All fifteen are `status = 'closed'` — settled — so even the void door is shut, and the function
-- itself names the correct instrument. §3.0(2) says the same: "After the tax period the correction
-- is a credit note, never an edit."
--
-- So the fifteen are CORRECTED, not removed. That is what he actually wanted from item 9 — they were
-- on a list of bills whose paperwork said a sale happened with nothing saying it was undone. After
-- this file that list is empty, ₹6,949.95 is credited back on the record, and not one row is gone.
--
-- ⚠️ AND THIS IS A BACKUP-STACK FILE. The same instruction against AV LIVE would need his explicit
-- per-change yes naming that stack, and would still not delete anything.
--
-- ═══ THE SECOND HALF — "MAKE SURE IT NEVER HAPPEN AGAIN" — AND WHAT IT EXPOSED ═══
--
-- The fifteen were possible because §3.0(2)'s three promises are not equally enforced:
--
--     "A tax invoice, once issued, is never deleted, never edited, never renumbered."
--
-- DELETED is enforced — `lfh_block_issued_delete` (mig 190) is a DELETE trigger and it works.
-- EDITED and RENUMBERED are not enforced at all. Driven, each in its own transaction, against a
-- settled invoiced bill:
--
--     UPDATE sessions SET invoice_no = NULL   WHERE id = <it>          → ok        ← erases a tax number
--     UPDATE sessions SET invoice_no = 99999  WHERE id = <it>          → ok        ← renumbers it
--     UPDATE sessions SET invoice_at = NULL   WHERE id = <it>          → ok        ← erases its date
--     UPDATE orders   SET total = 0           WHERE session_id = <it>  → ok        ← rewrites the money
--
-- Migration 332's signed chain makes such an edit PROVABLE after the fact. Nothing made it
-- IMPOSSIBLE. This file closes that, which is the durable half of what he asked for: the bad state
-- stops being reachable rather than merely detectable.
--
-- ═══ WHAT IS REFUSED, AND WHAT IS DELIBERATELY STILL ALLOWED ═══
--
-- Every sanctioned path was read first, so the refusal lands only where nothing legitimate goes:
--
--   · `lfh_generate_invoice` sets invoice_no NULL → value. ALLOWED — that is issuing.
--   · `lfh_void_invoice` and `lfh_reopen_table` set invoice_voided / void_reason / void_at and
--     NEVER touch invoice_no or invoice_at (read both). ALLOWED, untouched.
--   · Nothing else in the schema writes invoice_no after it is set — checked across every function.
--     So "once set, never changed" breaks no caller that exists.
--   · SETTLEMENT is not an edit: payment_status, paid_at, payment_method, payment_note, tip,
--     khata_at and khata_customer_id stay freely writable on an invoiced bill. A bill being paid,
--     split, or put on khata after its invoice is issued is the normal life of a sale.
--   · SOFT-DELETE stays open (deleted_at / delete_reason), because that is the route mig 190's own
--     message points at and the admin console's support work needs it.
--   · A VOIDED invoice unlocks the money again, which is exactly what reopening a bill is for. The
--     refusal only applies while the invoice is LIVE.
--
-- ═══ ONE-TIME, AND KEYED ═══
--
-- The credit notes are wrapped in migration 307's ledger guard: a re-seed re-runs every migration
-- with no ledger of its own, and issuing fifteen tax documents twice would be far worse than the
-- untidiness it is fixing. The triggers are idempotent on their own (CREATE OR REPLACE + DROP
-- TRIGGER IF EXISTS) and sit OUTSIDE the ledger, so a fresh database still gets the rule.
--
-- Guarded by `npm run verify:invoice-is-final`.

-- ── 1 · AN INVOICE'S IDENTITY IS FINAL ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_invoice_identity_is_final()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Issuing is the one change allowed: NULL → a number, which lfh_generate_invoice does.
  IF OLD.invoice_no IS NULL THEN RETURN NEW; END IF;

  IF NEW.invoice_no IS DISTINCT FROM OLD.invoice_no THEN
    RAISE EXCEPTION 'lfh: invoice % is issued — a tax invoice number is never changed or erased (void it, or issue a credit note)', OLD.invoice_no
      USING errcode = 'check_violation',
            hint = 'docs/COMPLIANCE-GUARDRAILS.md 3.0(2). Corrections: lfh_void_invoice while the bill is open, lfh_issue_credit_note once it is settled.';
  END IF;

  IF OLD.invoice_at IS NOT NULL AND NEW.invoice_at IS DISTINCT FROM OLD.invoice_at THEN
    RAISE EXCEPTION 'lfh: invoice % is issued — the date it was issued on is never changed', OLD.invoice_no
      USING errcode = 'check_violation',
            hint = 'docs/COMPLIANCE-GUARDRAILS.md 3.0(2).';
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_invoice_identity_is_final ON public.sessions;
CREATE TRIGGER trg_invoice_identity_is_final
BEFORE UPDATE OF invoice_no, invoice_at ON public.sessions
FOR EACH ROW
EXECUTE FUNCTION lfh_invoice_identity_is_final();

REVOKE ALL ON FUNCTION public.lfh_invoice_identity_is_final() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_invoice_identity_is_final() TO service_role;

-- ── 2 · THE MONEY ON AN INVOICED SALE IS FINAL WHILE THE INVOICE IS LIVE ─────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_invoiced_money_is_final()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_inv int; v_voided boolean;
BEGIN
  -- Only the columns that define what was SOLD. Settlement is not an edit, and is not listed here.
  IF NEW.total        IS NOT DISTINCT FROM OLD.total
 AND NEW.subtotal     IS NOT DISTINCT FROM OLD.subtotal
 AND NEW.tax          IS NOT DISTINCT FROM OLD.tax
 AND NEW.discount     IS NOT DISTINCT FROM OLD.discount
 AND NEW.taxable_base IS NOT DISTINCT FROM OLD.taxable_base
 AND NEW.nontax_amount IS NOT DISTINCT FROM OLD.nontax_amount
 AND NEW.mrp_amount   IS NOT DISTINCT FROM OLD.mrp_amount THEN
    RETURN NEW;
  END IF;

  IF NEW.session_id IS NULL THEN RETURN NEW; END IF;
  SELECT s.invoice_no, s.invoice_voided INTO v_inv, v_voided
    FROM sessions s WHERE s.id = NEW.session_id;

  -- No invoice yet, or it has been voided (the bill was reopened): editing is the normal flow.
  IF v_inv IS NULL OR COALESCE(v_voided, false) THEN RETURN NEW; END IF;

  RAISE EXCEPTION 'lfh: invoice % is issued — the money on it is never rewritten (reopen the bill to void the invoice, or issue a credit note)', v_inv
    USING errcode = 'check_violation',
          hint = 'docs/COMPLIANCE-GUARDRAILS.md 3.0(2). Settlement columns (payment_status, paid_at, tip, khata) are deliberately NOT covered by this.';
END $function$;

DROP TRIGGER IF EXISTS trg_invoiced_money_is_final ON public.orders;
CREATE TRIGGER trg_invoiced_money_is_final
BEFORE UPDATE OF total, subtotal, tax, discount, taxable_base, nontax_amount, mrp_amount ON public.orders
FOR EACH ROW
EXECUTE FUNCTION lfh_invoiced_money_is_final();

REVOKE ALL ON FUNCTION public.lfh_invoiced_money_is_final() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_invoiced_money_is_final() TO service_role;

-- ── 3 · THE FIFTEEN GET THEIR CREDIT NOTE (one-time) ─────────────────────────────────────────────
DO $correct_the_fifteen$
DECLARE r record; n int := 0; v_amount numeric;
BEGIN
  IF lfh_already_applied('398_credit_uncorrected_cancelled_invoices') THEN RETURN; END IF;

  FOR r IN
    SELECT s.id, s.invoice_no,
           (SELECT COALESCE(SUM(o.total), 0) FROM orders o
             WHERE o.session_id = s.id AND o.deleted_at IS NULL) AS bill_total
      FROM sessions s
     WHERE s.invoice_no IS NOT NULL
       AND s.deleted_at IS NULL
       AND NOT s.invoice_voided
       AND s.void_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.session_id = s.id
                         AND o.deleted_at IS NULL AND o.status <> 'cancelled')
       AND NOT EXISTS (SELECT 1 FROM credit_notes c WHERE c.session_id = s.id)
     ORDER BY s.invoice_at
  LOOP
    -- A bill whose orders were all zeroed as well as cancelled has nothing to credit; it is already
    -- ₹0 in every figure, so there is no correction to make and inventing a ₹0 credit note would be
    -- a tax document that says nothing.
    v_amount := round(r.bill_total, 2);
    CONTINUE WHEN v_amount <= 0;
    PERFORM lfh_issue_credit_note(
      r.id, v_amount,
      'Every order on this bill was cancelled after the invoice was issued, and no correction had been recorded. Credited in full (migration 398).',
      'Aevidine');
    n := n + 1;
  END LOOP;

  INSERT INTO lfh_applied_once (key, note) VALUES
    ('398_credit_uncorrected_cancelled_invoices',
     'Issued a full credit note against every invoiced bill whose every order was cancelled and which carried no void mark and no credit note. Fifteen on the dev stack, ₹6,949.95. A re-run would issue a SECOND credit note against each — fifteen duplicate tax documents.')
  ON CONFLICT (key) DO NOTHING;

  RAISE NOTICE 'migration 398: issued % credit note(s)', n;
END $correct_the_fifteen$;

NOTIFY pgrst, 'reload schema';
