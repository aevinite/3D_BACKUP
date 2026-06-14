-- 056_staff_users_self_reset.sql
-- Per-user permission: may this user change their OWN password from their
-- profile? Admin can grant/revoke it per user. Defaults TRUE (a normal user
-- expects to manage their own password); admin can take it away for tighter
-- control. The admin can ALWAYS reset anyone's password regardless of this flag.
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS can_self_reset boolean NOT NULL DEFAULT true;

NOTIFY pgrst, 'reload schema';
