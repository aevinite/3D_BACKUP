-- 1) Hidden per-dish search terms (synonyms) so a guest finds a dish even when
--    they type a word that isn't in its display name (e.g. "caesar" -> a salad).
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS search_alias TEXT NOT NULL DEFAULT '';

-- 2) Waiter calls: a guest taps "Call a Waiter", which the restaurant sees live
--    in the editor. Public may INSERT (like orders); the owner reads/updates via
--    the service role.
CREATE TABLE IF NOT EXISTS waiter_calls (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number TEXT,
  note         TEXT,
  resolved     BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE waiter_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_insert_calls" ON waiter_calls;
CREATE POLICY "public_insert_calls" ON waiter_calls FOR INSERT WITH CHECK (true);

-- ⚠️ RUN-ALONE GUARD (added by the 2026-08-21 migrations-001-118 sweep, T21).
-- `public_insert_calls` above is RETIRED. Migration 050 removed it and put waiter calls behind
-- `lfh_call_waiter` / `lfh_call_waiter_table`, which rate-limit and refuse a call on a table that
-- is not open. With the always-true INSERT policy back, the public menu key can write
-- `waiter_calls` rows directly — unlimited, unattributed, and on any table number — so the floor
-- fills with call badges nobody can clear from the guest side.
--
-- A FULL re-seed ends correctly (050 sorts after this file and drops it again). The hole is the
-- PARTIAL run that CLAUDE.md recommends. This file now ends in the state migration 050 decided,
-- the same way migration 099 was made to. Idempotent.
DROP POLICY IF EXISTS "public_insert_calls" ON waiter_calls;
