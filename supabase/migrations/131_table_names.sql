-- 131_table_names.sql
--
-- Per-table display NAMES (owner request, 2026-07-06: "change the names of table…
-- make last table banquet"). Sibling of table_seats (mig 111) — a JSONB on
-- `settings` keyed by table number → a short label ("Banquet", "Terrace 1"…).
-- DISPLAY-ONLY: a table's identity everywhere (sessions, orders, bills, KOTs,
-- QR links) is still its NUMBER; the name only changes what staff panels show
-- on tiles and detail headers. No entry → the plain "T<n>" / "Table <n>" as
-- before, so this is fully additive with zero backfill.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS table_names JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
