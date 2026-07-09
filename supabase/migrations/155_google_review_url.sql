-- 155 — per-restaurant Google review link (owner 2026-07-09).
-- Powers the guest "Loved it? Review us on Google" nudge shown after a HIGH dish
-- rating (>= 4 stars). A low rating is kept private (no nudge) — the Sunday model.
--
-- Additive + nullable: NULL means the feature is simply OFF for that restaurant
-- (the guest prompt renders nothing), so this changes no existing behaviour. It's a
-- PUBLIC link (not sensitive like gstin/phone), so the guest getSettings may read it.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS google_review_url text;
