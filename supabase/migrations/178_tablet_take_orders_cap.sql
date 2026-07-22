-- 178_tablet_take_orders_cap.sql — the manager→tablet rung for order-taking.
--
-- take_orders joins the app as a manager POWER (owner_entitlements power_take_orders +
-- manager_permissions.take_orders) AND a tablet CAP — the same two-rail shape as
-- discount / mark_paid / invoice (see docs/ACCESS-LADDER.md). This adds the tablet-cap
-- tri-state column (off|on|pin) the manager sets in Settings → Access and the admin in
-- Access → Tablet, with per-waiter overrides via staff_users.permissions.
--
-- DEFAULTS to 'on' (and backfills every existing row) because taking orders is the
-- tablet's EXISTING core function — the non-breaking rule for a new rung on a
-- pre-existing feature (docs/ACCESS-LADDER.md): the new rung defaults to current
-- behaviour, so no live tablet stops taking orders.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS tablet_take_orders TEXT NOT NULL DEFAULT 'on';

UPDATE settings SET tablet_take_orders = 'on'
  WHERE tablet_take_orders IS NULL OR tablet_take_orders NOT IN ('off', 'on', 'pin');

NOTIFY pgrst, 'reload schema';
