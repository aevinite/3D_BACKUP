-- 075_billing_info_settings.sql
-- Restaurant identity for the printed tax invoice (name / address / phone). GSTIN,
-- invoice_prefix and tax_rate already exist (migration 037). Lets the owner fill the
-- real details in General settings so the B&W receipt is data-driven. (owner, 2026-06-21)

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS restaurant_name    TEXT,
  ADD COLUMN IF NOT EXISTS restaurant_address TEXT,
  ADD COLUMN IF NOT EXISTS restaurant_phone   TEXT;

NOTIFY pgrst, 'reload schema';
