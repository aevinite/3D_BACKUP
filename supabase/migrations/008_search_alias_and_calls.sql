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
