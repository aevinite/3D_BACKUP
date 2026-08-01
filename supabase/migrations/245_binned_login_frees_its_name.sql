-- 245_binned_login_frees_its_name.sql
-- ─────────────────────────────────────────────────────────────────────────
-- A LOGIN IN THE RECYCLE BIN NO LONGER OWNS ITS NAME (owner, 2026-08-01).
--
-- "Make sure the recycle bin works as deleted only — you can use that name."
--
-- Today the unique index from migration 091 counts EVERY row, including the
-- soft-deleted ones (mig 208 gave staff_users a recycle bin). So an owner named
-- "rishi" who sits in the bin still blocks a NEW owner called "rishi" — the bin
-- behaves like a lock instead of like a delete. This makes the index PARTIAL, so
-- only LIVE rows reserve a name; a binned row keeps its name for the restore, but
-- stops standing in anyone's way.
--
-- Consequence handled in the app (app/api/admin/owners + lib/userAuth):
--   • a binned name is free to take (create / rename), and
--   • RESTORING a binned owner whose name was taken in the meantime is a CLASH:
--     the admin is asked which one gets renamed, first-save-wins style — the
--     restore never silently fails and never quietly renames anyone.
--   • every username lookup now filters `deleted_at IS NULL`, so a binned row can
--     never be matched (login included) even though its name may now be shared.
--
-- Safety: index-only, fully reversible, no data touched. Building the partial index
-- FIRST and dropping the old one after means the uniqueness rule is never absent.
-- If two LIVE rows in one restaurant already shared a name the CREATE would fail —
-- that can't happen, since the old (stricter) index has been enforcing it all along.
-- ─────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_users_username_live
  ON staff_users (restaurant_id, lower(username))
  WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS idx_staff_users_username_per_restaurant;

-- Restores look up "is this name free?" by (restaurant_id, lower(username)) over
-- binned rows too; the partial index above can't serve that, so keep a plain one.
CREATE INDEX IF NOT EXISTS idx_staff_users_username_any
  ON staff_users (restaurant_id, lower(username));

NOTIFY pgrst, 'reload schema';
