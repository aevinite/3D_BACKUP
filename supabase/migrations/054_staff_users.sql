-- 054_staff_users.sql — per-user staff logins with roles (Phase 1 auth). Service-
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
--
-- ⚠️ RUN-ALONE GUARD (sweep #9, T29, 2026-09-15). This index is GLOBAL on lower(username), and it
-- has been replaced twice since: migration 091 made the name unique PER RESTAURANT ("two
-- restaurants can now each have a 'manager' login without colliding"), and migration 245 narrowed
-- that to the LIVE rows only (`idx_staff_users_username_live`) so a binned login frees its name.
-- On today's database four restaurants each have a "manager", so re-creating the global index
-- raises `could not create unique index … key is duplicated` and `node scripts/run-migration.mjs
-- 054_staff_users.sql` ABORTS here. (A full re-seed was always fine: this runs before any second
-- restaurant exists, and 091/245 then replace it.)
--
-- So: create it only while the per-restaurant replacement is NOT yet present. Where 091 or 245 has
-- run, the rule is already enforced in the form the product actually wants.
DO $staff_username_unique$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN ('idx_staff_users_username_live', 'idx_staff_users_username_per_restaurant')
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_users_username ON staff_users (lower(username));
  END IF;
END $staff_username_unique$;
-- RLS on, NO policy ⇒ anon/authenticated denied; the service-role API bypasses it.
ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- …and retire the global index at the end, so the file's own end state is the one 091/245 decided
-- rather than a uniqueness rule the sequence has replaced. The same one-line ending 036/040/099 carry.
DROP INDEX IF EXISTS idx_staff_users_username;
