-- 147_idempotency_result.sql
-- Guest-menu audit 2026-07-07. Two related fixes hinge on remembering the RESULT
-- of an at-most-once action (see lib/idempotency.ts, mig 138):
--   1) The ONLINE guest order now carries an action_id too (not just the offline
--      replay), so a lost reply on a flaky connection + a retry places the order
--      ONCE instead of twice. The retry must get the ORIGINAL order_id back.
--   2) An OFFLINE order that committed but whose reply was lost used to be dropped
--      silently (the guest thought it failed). Echoing the stored order_id on the
--      duplicate lets the tracker still show it.
-- So: store the successful JSON result alongside the claim; a duplicate echoes it.
alter table public.action_idempotency
  add column if not exists result jsonb;
