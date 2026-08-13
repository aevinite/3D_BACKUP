-- 055_staff_users_hardening.sql
-- Production-grade hardening for the staff_users login (Phase 1 auth).
--
-- Adds three columns that turn the basic login into a real, attack-resistant one:
--   token_version — bumped to invalidate ALL of a user's existing cookies at once
--                   ("log out everywhere"); auto-bumped on password change / revoke.
--   failed_count  — consecutive wrong-password tries (brute-force counter).
--   locked_until  — if set and in the future, login is refused (temporary lockout).
--
-- Passwords/PINs themselves move to a salted, slow PBKDF2 hash in app code
-- (lib/userAuth); the *_hash columns already exist (migration 054) and just hold
-- the new "pbkdf2$iters$salt$hash" string instead of a bare SHA-256 — no column
-- change needed for that. No data migration: there are no users yet (admin seeds).

ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS failed_count  integer NOT NULL DEFAULT 0;
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS locked_until  timestamptz;

NOTIFY pgrst, 'reload schema';
