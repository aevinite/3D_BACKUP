-- 074_tablet_billing_settings.sql
-- Per-action controls for what the WAITER (tablet) may do with a bill. Each is a
-- tri-state: 'off' (hidden — default; the waiter has no billing access), 'on'
-- (allowed directly), or 'pin' (allowed but needs a manager PIN). Set in the
-- manager's General settings. Discount, Mark-paid and Invoice are independent.
-- (owner, 2026-06-21 — "initially both/all toggles off, waiter doesn't have access")

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS tablet_discount  TEXT NOT NULL DEFAULT 'off' CHECK (tablet_discount  IN ('off','on','pin')),
  ADD COLUMN IF NOT EXISTS tablet_mark_paid TEXT NOT NULL DEFAULT 'off' CHECK (tablet_mark_paid IN ('off','on','pin')),
  ADD COLUMN IF NOT EXISTS tablet_invoice   TEXT NOT NULL DEFAULT 'off' CHECK (tablet_invoice   IN ('off','on','pin'));

NOTIFY pgrst, 'reload schema';
