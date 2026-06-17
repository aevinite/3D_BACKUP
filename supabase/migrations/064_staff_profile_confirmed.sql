-- 064_staff_profile_confirmed.sql — one-time "profile setup done" flag.
--
-- The first-login profile card used to show whenever name OR phone was blank
-- (needsProfile = !name || !phone), so it RE-NAGGED on every login until both
-- were filled — and never showed at all when the admin pre-filled both. We now
-- want it to appear EXACTLY ONCE per account (a confirm step), then never again.
ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS profile_confirmed boolean NOT NULL DEFAULT false;

-- Existing staff who already have BOTH name and phone have effectively completed
-- setup — mark them confirmed so nobody currently working gets re-prompted.
UPDATE staff_users
  SET profile_confirmed = true
  WHERE name IS NOT NULL AND phone IS NOT NULL AND profile_confirmed = false;

NOTIFY pgrst, 'reload schema';
