-- 274 · the "change my password" box gets the same wall every other password box has
--
-- FOUND BY the 2026-08-04 API sweep (finding F12). Two endpoints check a password:
--
--   app/api/panel-profile/route.ts   POST { currentPassword, newPassword }  — any staff member
--   app/api/owner/settings/route.ts  POST { current, next }                 — an owner
--
-- Both re-authenticate correctly (verifySecret against the stored hash) and both refuse a wrong
-- one with 403. Neither counted the attempts. So the one place in the product where somebody is
-- ALREADY past the login — an unlocked tablet left on a counter, a shared browser profile — had no
-- limit at all: a person could sit there typing guesses at "current password" indefinitely, and
-- nothing walled them and nothing reached the admin's Problems list.
--
-- Every other credential check already has this: staff_login 5 per 5 min (mig 205), manager_pin
-- 5 per 5 min, and the admin gate's own IP lockout (mig 151). This adds the missing rule so the
-- behaviour is uniform, using the SAME machinery (lfh_rate_check via lib/rateLimit.rateAllowed) —
-- no new table, no new code path.
--
-- 5 tries per 5 minutes, keyed per ACCOUNT (`<user id>`), matching staff_login's shape. Deliberately
-- NOT keyed per device: the point is to stop guessing at one person's password, and a guesser can
-- clear a cookie but cannot change whose account they are attacking.
--
-- ENABLED, and it can raise an alert — unlike admin_login, which is deliberately warn-only so the
-- owner is never locked out of his own console. Being walled here costs a person five minutes and
-- their password still works, so a real attempt is worth knowing about.
--
-- Idempotent: the same `on conflict` guard mig 205 uses, so re-running is a no-op.

insert into rate_limit_rules (restaurant_id, key, label, max_count, window_seconds, enabled) values
  (null, 'password_change', 'Change-password attempts (per account)', 5, 300, true)
on conflict (key) where restaurant_id is null do nothing;
