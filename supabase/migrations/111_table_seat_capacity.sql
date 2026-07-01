-- 111_table_seat_capacity.sql
--
-- "Table setting" — per-table seating capacity (owner request, 2026-07-01: "how much
-- person can sit on it"). Deliberately the SMALLEST possible change: a single JSONB
-- column on `settings`, keyed by table number ("1", "2", …) → seat count. It does NOT
-- touch table_count or any session/ordering logic — a table's identity is still just
-- its number; this column is purely a DISPLAY property (shown next to the chair icon
-- on the manager floor + the tablet). A table with no entry (or seats <= 0) falls back
-- to the default of 4 in the app code, so this is fully additive/backward-compatible —
-- every existing restaurant keeps working exactly as before with zero migration/backfill
-- needed.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS table_seats JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
