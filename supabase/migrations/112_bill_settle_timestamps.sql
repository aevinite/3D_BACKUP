-- 112_bill_settle_timestamps.sql
--
-- Owner (2026-07-02): once a bill is fully paid (or a table is freed, or an order
-- cancelled) it "leaves the floor" into Today's bills. Staff can undo that by
-- mistake ("Restore to floor" / revert-paid / un-cancel) — but that undo should
-- only be possible for a short grace period, not forever. This adds the three
-- timestamps needed to enforce a 30-minute window per transition:
--   paid_at       — set the moment payment_status flips to 'paid', cleared on revert
--   archived_at   — set the moment a table is freed (archived=true), cleared on restore
--   cancelled_at  — set the moment an order is cancelled, cleared if revived
--
-- ADDITIVE + nullable, no backfill: existing rows read as NULL, which the app
-- treats as "outside the window" (fails closed — old historical bills were never
-- meant to be restorable anyway, so this is the safe default, not a regression).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at      timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS archived_at  timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

NOTIFY pgrst, 'reload schema';
