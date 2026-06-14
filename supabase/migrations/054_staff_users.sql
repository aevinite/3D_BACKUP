-- 053_staff_users.sql — per-user staff logins with roles (Phase 1 auth). Service-
-- role only; NEVER exposed to the guest anon key. Passwords/PINs stored as sha256
-- hex (hashed in the API via lib/staffAuth.sha256hex).
CREATE TABLE IF NOT EXISTS staff_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('manager','tablet','kitchen')),
  pin_hash      text,                          -- self-set in the user's profile; used by Phase 3 money gates
  name          text,                          -- blank until captured on first login
  phone         text,                          -- blank until captured on first login
  active        boolean NOT NULL DEFAULT true, -- admin can disable without deleting
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz
);
-- case-insensitive unique username (no citext extension needed)
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_users_username ON staff_users (lower(username));
-- RLS on, NO policy ⇒ anon/authenticated denied; the service-role API bypasses it.
ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
