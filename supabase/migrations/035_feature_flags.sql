-- Per-restaurant FEATURE FLAGS (the seed of the future SaaS model, owner 2026-06-12):
-- one JSONB bag of switches on the settings row. The apps read it merged over
-- code-side defaults, so an ABSENT key means "default behavior" and existing
-- restaurants notice nothing until someone flips a switch.
--
-- Guest-facing keys (default ON, editable in the editor's Features tab):
--   ratings, reviews, model3d, allergies, favorites, waiter_calls, search,
--   languages, currency, scrollspy
-- Backend-only keys (default OFF, NO UI anywhere — owner: "totally backend"):
--   verification, payments, aggregators, gst_invoice

ALTER TABLE settings ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
