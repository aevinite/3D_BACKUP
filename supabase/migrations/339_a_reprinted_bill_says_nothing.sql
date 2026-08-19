-- 339 — A REPRINTED BILL SAYS NOTHING (owner, 2026-08-19)
--
-- COMMENT ONLY. No column is added, dropped or changed, and no row is touched. This exists so the
-- database says what the column is actually for, because migration 333's comment now describes a
-- feature that no longer exists and the comment is what the next person reads.
--
-- WHAT CHANGED. 333 (2026-08-17) added `sessions.bill_printed_at` so a second copy of a BILL could
-- be branded "Reprint · Duplicate" on the paper, the way a kitchen ticket has been branded since
-- 2026-08-04. On 2026-08-19 the owner removed that idea outright:
--
--   "in the printing bill I don't even want the reprinted bill shown in the bill, as well as I
--    don't want reprinted bill shown anywhere like on audit also, because it's not any kind of
--    problem which needs to be audited … reprinting should also not ask any question … after once
--    print the button will just show reprint instead of print, works same"
--
-- A guest asking for their bill again is service, not an incident. The KITCHEN TICKET keeps its
-- banner — his own ask, re-confirmed the same day ("bill only keep kot banner") — because a cook
-- who mistakes a duplicate for a fresh order cooks the food twice, which is a real fault.
--
-- WHY THE COLUMN STAYS. It still answers one question, and it still cannot be answered by the
-- device: has this bill been on paper? That is what makes the button read "Reprint" instead of
-- "Print" on EVERY panel — the manager prints at the till, and the waiter's tablet a minute later
-- must not still say "Print". Same reasoning as 333 and as aggregator_orders.printed_at (mig 256).
-- It is stamped once, never moved, and writes nothing to the Activity log or the Audit.
--
-- Reopening a bill is a different act and is untouched: the reason is still required, the void is
-- still audited, the new invoice number is still logged, and the before → after row is still
-- written ("reopen will be noted in the audit also" — owner, same message).
--
-- Guarded in code by scripts/verify-bill-reprint-is-silent.mjs (npm run verify:bill-reprint), and
-- recorded as R37/R38/R39 in docs/REJECTED-IDEAS.md.
COMMENT ON COLUMN public.sessions.bill_printed_at IS
  'When this bill was first printed on paper. NULL = never printed. Stamped once and never overwritten. '
  'Its ONLY job is the wording of the print button — "Print" before, "Reprint" after — on every panel, '
  'which is why it lives on the bill and not on the device that printed. '
  'The printed bill itself says NOTHING about being a second copy, and a reprint is recorded NOWHERE: '
  'owner, 2026-08-19, R37/R38 in docs/REJECTED-IDEAS.md. Do not add a band, a watermark or an audit row. '
  'Reopening a bill is a different act and IS recorded, as it always was.';
