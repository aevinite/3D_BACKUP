-- 073_invoice_pipeline.sql
-- Invoice-first billing pipeline: GENERATE a permanent invoice number for a
-- session's bill (locks it), and VOID it (to reopen for edits). Server-authoritative
-- — the bill total is always computed from the DB order rows (items are already
-- priced server-side by lfh_price_order, migration 029; discounts clamped server-side).
-- The frontend never sets prices. (owner, 2026-06-21)
--
-- sessions.invoice_no already exists (migration 037). We add the lock/void metadata.
-- "Invoiced/locked" = invoice_no IS NOT NULL AND NOT invoice_voided.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS invoice_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_voided BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS void_reason    TEXT,
  ADD COLUMN IF NOT EXISTS void_at        TIMESTAMPTZ;

-- Generate (or re-generate after a void) the invoice number for a session. The
-- number comes from the forever-sequential 'invoice' counter (never resets); the
-- display prefix/FY is applied in the app. No-ops if a LIVE (non-voided) invoice
-- already exists, so it can't be double-numbered.
CREATE OR REPLACE FUNCTION lfh_generate_invoice(p_session uuid)
RETURNS sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v sessions;
BEGIN
  SELECT * INTO v FROM sessions WHERE id = p_session;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found'; END IF;
  IF v.invoice_no IS NULL OR v.invoice_voided THEN
    UPDATE sessions
       SET invoice_no = lfh_next_seq('invoice'), invoice_at = NOW(),
           invoice_voided = false, void_reason = NULL, void_at = NULL
     WHERE id = p_session
     RETURNING * INTO v;
  END IF;
  RETURN v;
END $$;

-- Void the current invoice → unlocks the bill for edits. The number stays on the
-- record (never reused); a later lfh_generate_invoice assigns a fresh number.
CREATE OR REPLACE FUNCTION lfh_void_invoice(p_session uuid, p_reason text DEFAULT NULL)
RETURNS sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v sessions;
BEGIN
  UPDATE sessions
     SET invoice_voided = true, void_reason = p_reason, void_at = NOW()
   WHERE id = p_session
   RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found'; END IF;
  RETURN v;
END $$;

-- staff-only (migration-038 gotcha: new functions are PUBLIC-executable by default)
REVOKE ALL ON FUNCTION lfh_generate_invoice(uuid)      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_generate_invoice(uuid)      TO service_role;
REVOKE ALL ON FUNCTION lfh_void_invoice(uuid, text)    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_void_invoice(uuid, text)    TO service_role;

NOTIFY pgrst, 'reload schema';
