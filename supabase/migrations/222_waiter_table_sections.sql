-- 222_waiter_table_sections.sql — give each waiter their own SECTION of the floor.
--
-- Until now every tablet login saw the WHOLE floor: the floor isn't even a list of
-- rows, it's the numbers 1 … settings.table_count (generate_series inside
-- lfh_table_view_summary, mig 166). In a 40-table restaurant every waiter could open
-- and bill all 40 tables. This adds "sections": a tablet login is given a set of table
-- numbers and works only those.
--
-- Owner's decisions (2026-07-29):
--   • a waiter with NO tables assigned sees an EMPTY floor (not the whole floor),
--   • tables that aren't his are HIDDEN, not greyed,
--   • assignments are STICKY (no daily reset),
--   • the MANAGER gets the power ON by default; the owner can revoke it.
--
-- Because "unassigned = blank", turning this on for a restaurant that hasn't assigned
-- anything would black out every tablet. That is exactly why the module rung below
-- defaults to OFF (the standard new-module default anyway): nothing changes anywhere
-- until an admin deliberately switches it on for one restaurant, and the editing card
-- warns about tables nobody serves before that can bite.

-- ── A. Storage: one array on the staff row ───────────────────────────────────
-- '{}' = no tables. '{1,2,3}' = those three. Two waiters may both list table 3, so
-- sharing a table needs no extra modelling.
--
-- WHY an array column and not a table_assignments join table: userFromCookie
-- (lib/userAuth.ts) already does select("*") on staff_users on EVERY request, so the
-- assignment rides along free — zero extra queries, zero extra egress, exactly like
-- the per-user `permissions` map (mig 115). A join table would add a read to the
-- hottest path in the app. "Who serves table 3?" is answered from the staff roster the
-- editing screen already loads (a handful of rows).
--
-- Stale numbers are harmless: if table_count later shrinks, the app intersects the
-- array with 1 … table_count when it renders, so an out-of-range entry simply never
-- shows. Nothing needs cleaning up.
ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS assigned_tables integer[] NOT NULL DEFAULT '{}'::integer[];

COMMENT ON COLUMN staff_users.assigned_tables IS
  'Waiter sections (mig 222): the table numbers this tablet login may see and act on. '
  'Empty {} = none (their floor is empty) — but ONLY while the table_assign module is '
  'effective for the restaurant; with the module off the array is ignored entirely and '
  'every waiter sees the whole floor as before. Managers/owners/admins are never '
  'restricted by it.';

-- ── B. The module ladder (admin → owner) ─────────────────────────────────────
-- Canonical 4-rung shape, docs/ACCESS-LADDER.md. Brand-new module ⇒ allowed OFF,
-- owner_control OFF, enabled ON (so a later transfer changes nothing by itself).
-- Effective = allowed AND (NOT owner_control OR enabled)  [moduleLadder()]
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS table_assign_allowed       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS table_assign_owner_control BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS table_assign_enabled       BOOLEAN NOT NULL DEFAULT true;

-- ── C. The owner → manager grant ─────────────────────────────────────────────
-- Owner's call: managers run the floor, so they get this power out of the box (the
-- owner can still take it away with one switch). managerCan() reads an ABSENT key as
-- FALSE, so the grant has to be written explicitly for every existing restaurant —
-- an absent key here would silently mean "no manager may assign tables".
-- Safe regardless: the module above is OFF, so this grants nothing visible yet.
UPDATE restaurants
   SET manager_permissions = COALESCE(manager_permissions, '{}'::jsonb)
                             || '{"table_assign": true}'::jsonb
 WHERE COALESCE(manager_permissions, '{}'::jsonb) ? 'table_assign' = false;

-- ── D. Live update: a changed section reaches the open tablet ────────────────
-- The staff row is re-read on every request, so the waiter's very NEXT tap is already
-- correct. This breadcrumb is what makes an IDLE tablet repaint on its own instead of
-- waiting for the 60s backstop.
--
-- staff_users falls through lfh_rt_emit's generic ELSE branch (mig 166): topic 'ops',
-- entity = the staff id, table_number NULL. A NULL table_number is deliberate and
-- correct here — a section change can move MANY tables at once, so the panel must do a
-- full reload rather than a per-table refetch. No change to lfh_rt_emit is needed.
--
-- Scoped to UPDATE OF assigned_tables so the ordinary staff writes that happen
-- constantly (last_seen_at heartbeats on every request, failed_count, token_version)
-- do NOT wake every panel. That column list is the whole watch-list for this trigger:
-- if a panel ever renders another staff column live, add it here.
DROP TRIGGER IF EXISTS rt_emit_staff_tables ON staff_users;
CREATE TRIGGER rt_emit_staff_tables
  AFTER UPDATE OF assigned_tables ON staff_users
  FOR EACH ROW
  WHEN (OLD.assigned_tables IS DISTINCT FROM NEW.assigned_tables)
  EXECUTE FUNCTION lfh_rt_emit();

NOTIFY pgrst, 'reload schema';
