-- 196_parcel_paid.sql
-- Parcel / takeaway quick-order support. A "Parcel" is just a manually-created
-- takeaway order in the EXISTING Platform system (aggregator_orders, source='takeaway')
-- — see migration 071. The ONE thing that table lacks is a paid concept: the owner
-- wants BOTH "pay now" (settled at the counter) and "pay on pickup" (collected later).
-- ADDITIVE ONLY — new nullable/defaulted columns; every existing platform flow is
-- unchanged by construction (they simply leave these NULL/false).
--
-- No RPC change: the manager /parcel endpoint reuses lfh_platform_insert (mig 080)
-- and then, when paid-now, does a scoped UPDATE of these columns. Keeping the shared
-- insert RPC untouched means Zomato/Swiggy intake is not affected at all.

ALTER TABLE aggregator_orders
  ADD COLUMN IF NOT EXISTS paid           BOOLEAN     NOT NULL DEFAULT false, -- collected at the counter?
  ADD COLUMN IF NOT EXISTS paid_at        TIMESTAMPTZ,                        -- when it was settled
  ADD COLUMN IF NOT EXISTS payment_method TEXT;                              -- cash / card / upi / …

NOTIFY pgrst, 'reload schema';
