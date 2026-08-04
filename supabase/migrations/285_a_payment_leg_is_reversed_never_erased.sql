-- 285_a_payment_leg_is_reversed_never_erased.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- UNDOING A SPLIT PAYMENT DID TWO DIFFERENT THINGS DEPENDING ON WHICH DEVICE DID IT.
--
-- A split settle records one row per leg in `session_payments` (mig 176) — "₹200 UPI + ₹200 cash"
-- — which is the money trail for how the cash actually came in. When that settle is undone:
--
--   · the WAITER tablet ran a hard DELETE over a time window, so the legs vanished. The audit row
--     written alongside records `was_method` but NOT the amounts, so there was no trace left of
--     what had been collected or in what parts.
--   · the MANAGER panel left them completely alone, so the trail went on claiming ₹400 was
--     collected against a bill now marked unpaid.
--
-- So the same action gave two different answers to "how did table 6 pay last night?", and one of
-- them was a permanent erase of a money record — the one thing docs/COMPLIANCE-GUARDRAILS.md is
-- built around ("append-only… deletes are soft: stamp, keep the row, show a tombstone").
-- `session_payments` was the one money table with no soft-delete columns at all.
--
-- FIXED: a leg is REVERSED, never removed. Both panels stamp the same three columns through one
-- shared helper (lib/paySplit.ts → reverseSplitLegs), so the trail reads the same whoever undid it
-- and the amounts survive for anyone asking later.
--
-- Additive: three nullable columns and one partial index. Existing rows are untouched and count as
-- live (reversed_at IS NULL), which is what they are.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE session_payments
  ADD COLUMN IF NOT EXISTS reversed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by     text,
  ADD COLUMN IF NOT EXISTS reversed_reason text;

COMMENT ON COLUMN session_payments.reversed_at IS
  'NULL = this leg still stands. Set when the settle it belonged to was undone — the row is KEPT so the money trail still shows what was collected and in what parts (it used to be hard-deleted by the waiter panel and ignored by the manager''s). Anything totalling collected money must filter on reversed_at IS NULL.';

-- The live legs of one bill — the shape every reader wants.
CREATE INDEX IF NOT EXISTS idx_session_payments_live
  ON session_payments(session_id) WHERE reversed_at IS NULL;

NOTIFY pgrst, 'reload schema';
