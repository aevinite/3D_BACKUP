-- 198_parcel_default_manager_on.sql — parcel is ON for MANAGERS, OFF for TABLET, by default
-- (owner 2026-07-26). Parcel/takeaway is a common counter task most restaurants want, so —
-- unlike a locked premium module — it ships on for the manager everywhere (admin can still
-- switch it OFF per restaurant), while the waiter tablet stays off until explicitly granted
-- (takeaway is usually handled at the counter, not by floor waiters).

-- 1) Module available by default; backfill every existing restaurant ON.
ALTER TABLE settings ALTER COLUMN parcel_allowed SET DEFAULT true;
UPDATE settings SET parcel_allowed = true;

-- 2) Tablet capability stays OFF by default; reset every restaurant to off (incl. the
--    French House demo that was flipped on during build) so "off for tablet" holds.
UPDATE settings SET tablet_parcel = 'off';

-- 3) Managers granted parcel by default — backfill the grant on every restaurant so the
--    server (managerCan reads an ABSENT key as false) and the UI agree (display = truth,
--    the banquet-default lesson). New restaurants get it from NR_MP_DEFAULT / MP_DEFAULT.
UPDATE restaurants
   SET manager_permissions = COALESCE(manager_permissions, '{}'::jsonb) || '{"parcel": true}'::jsonb;

NOTIFY pgrst, 'reload schema';
