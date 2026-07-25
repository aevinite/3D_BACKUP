-- 188_bill_ledger_soft_delete.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Bill-ledger foundation + the legal-safety fix: NO issued bill can EVER be
-- hard-deleted. A "bill" here = a `sessions` row (the table's tab) + its child
-- `orders` rows (which carry all the money). Until now, deleting a bill's orders
-- ran a real SQL DELETE — the money rows were gone forever, only a one-line log
-- survived. That is exactly the "make a sale secretly disappear" shape a billing
-- tool must never have (the PetPooja/CGST 132 sales-suppression risk).
--
-- From now on a "delete" is a SOFT delete: it stamps deleted_at + who + a reason
-- on the session AND its orders, and the rows STAY in the database forever. A
-- deleted bill is therefore always still visible (tombstoned) to the admin and
-- retained for tax/audit; a restore just clears the stamp. Bill numbers are
-- RETIRED on delete, never reused (a documented gap, never a hidden sale).
--
-- This migration is purely additive (nullable columns + indexes, no data change,
-- no NOT NULL, no RLS change) so it is safe to run on a live DB with the menu up.
-- The code paths that used to DELETE are converted to set these columns instead
-- (editor + tablet route handlers) in the same change set.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Soft-delete markers on the money rows. A deleted order is marked, never removed.
alter table orders
  add column if not exists deleted_at    timestamptz,
  add column if not exists deleted_by     text,
  add column if not exists deleted_by_id  uuid,
  add column if not exists delete_reason  text;

-- 2. Session-level marker too, so a whole tab can be tombstoned as ONE unit — even a
--    tap-and-leave session that minted a bill_no but has no orders still shows as a
--    deleted bill in the ledger.
alter table sessions
  add column if not exists deleted_at    timestamptz,
  add column if not exists deleted_by     text,
  add column if not exists deleted_by_id  uuid,
  add column if not exists delete_reason  text;

-- 3. Indexes for the admin bill ledger + for keeping deleted rows out of live panels
--    cheaply. Partial index on the (rare) deleted rows keeps the tombstone lookup tiny;
--    the composite covers the "live orders for this restaurant" hot path.
create index if not exists idx_orders_deleted     on orders(restaurant_id, deleted_at) where deleted_at is not null;
create index if not exists idx_sessions_deleted   on sessions(restaurant_id, deleted_at) where deleted_at is not null;

-- ── FOLLOW-UP (deliberately NOT in this migration) ───────────────────────────
-- A DB-level BEFORE DELETE trigger on `orders` that refuses to hard-delete an
-- ISSUED bill would be the ultimate "physically impossible to hide a sale"
-- backstop. It is intentionally left out here because it would also fire on
-- legitimate cascade paths (restaurant recycle-bin purge, test teardown) that
-- must be audited first. Adding it blindly could break those flows. Ship the
-- soft-delete conversion of the known code paths first (this change set), then
-- add the trigger in its own migration after a full delete-path audit.
-- ─────────────────────────────────────────────────────────────────────────────
