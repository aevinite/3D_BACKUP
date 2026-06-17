-- 057_staff_users_self_set_pin.sql
-- Per-user permission: may this user set/change their OWN PIN from their profile?
-- Mirrors can_self_reset (which governs the password). Admin can grant/revoke it
-- per user; defaults TRUE. The admin can ALWAYS set/clear anyone's PIN regardless
-- of this flag. The PIN itself lives in staff_users.pin_hash (salted PBKDF2).
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS can_self_set_pin boolean NOT NULL DEFAULT true;

NOTIFY pgrst, 'reload schema';
