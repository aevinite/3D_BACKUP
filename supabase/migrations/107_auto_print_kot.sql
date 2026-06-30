-- 107_auto_print_kot.sql
-- Auto-print KOT (owner 2026-06-30): the kitchen screen prints a kitchen-order-ticket the
-- moment a new/accepted order arrives — no clicking. Two-flag entitlement, matching the
-- house pattern (admin grants → owner controls):
--   • auto_print_kot_allowed — the ADMIN's entitlement (is this restaurant even allowed the
--     feature?). Default FALSE — new modules default off.
--   • auto_print_kot         — the OWNER's on/off toggle (only takes effect if allowed).
-- The kitchen prints only when BOTH are true. Default OFF everywhere so NOTHING changes /
-- prints until the restaurant sets up a printer + the owner flips it on. ADDITIVE + safe.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_print_kot_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_print_kot         boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
