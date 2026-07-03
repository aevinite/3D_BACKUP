-- Configurable multi-tax (owner, 2026-07-03): each restaurant sets ONE total tax rate,
-- split into named components (CGST/SGST/… — any number) that print on the customer bill.
-- The components' rates SUM to the total; the total is what shows in the manager/pay views.
--
-- Stored as a JSONB array on settings: [{ "label": "CGST", "rate": 2.5 }, { "label": "SGST",
-- "rate": 2.5 }]  (rate is a PERCENT, e.g. 2.5 = 2.5%). DEFAULT '[]' → empty means "not
-- configured": the app keeps its existing behaviour (tax_rate || 5%, printed as a 50/50
-- CGST+SGST split), so this migration changes NOTHING for any restaurant until its owner
-- actually adds components. Purely additive, backward-compatible.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tax_components jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN settings.tax_components IS
  'Optional named tax breakdown [{label,rate%},…] shown on the printed bill; their sum is the total tax rate. Empty = fall back to tax_rate (or 5%) printed as a 50/50 CGST+SGST split.';
