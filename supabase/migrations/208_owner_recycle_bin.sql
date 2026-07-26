-- Owner RECYCLE BIN (soft-delete) — deleting an owner now MOVES them to a 90-day
-- recycle bin instead of erasing the login on the spot. Mirrors the restaurant
-- recycle bin (migration 128) so both behave the same for the admin.
--
-- Owner lifecycle (see app/api/admin/owners/route.ts for the actions):
--   • deleted_at NULL      → live / suspended as before (unchanged behaviour).
--                            `active=false` = suspended (shows in the Owners list
--                            with the red "· off" badge). Reversible.
--   • deleted_at SET        → in the recycle bin. Dropped from the Owners list, no
--                            login (they were already suspended before binning).
--                            Their restaurant_owners links + primary pointers are
--                            kept intact so a Restore brings ownership straight back.
--   • purge (hard delete)  → only once now() >= deleted_at + 90 days; enforced in
--                            the API. This is the OLD permanent delete: hand primary
--                            off to a co-owner / clear it, drop the join rows, delete
--                            the staff_users row. Irreversible.
--
-- These columns already exist on `restaurants` (mig 128); this is the same pattern
-- on `staff_users`. Additive + nullable → every existing owner/staff row is
-- untouched (no backfill, no NOT NULL, no data change). Safe on the live DB.

ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS deleted_at    timestamptz;  -- when it went to the bin (NULL = not deleted)
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS deleted_by    text;         -- who moved it (admin actor label)
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS delete_reason text;         -- optional note shown in the bin

-- The recycle-bin listing filters WHERE deleted_at IS NOT NULL. A partial index
-- keeps that read cheap and never touches the hot "live owners / staff" path
-- (those rows aren't in this index at all).
CREATE INDEX IF NOT EXISTS idx_staff_users_deleted_at
  ON staff_users (deleted_at)
  WHERE deleted_at IS NOT NULL;
