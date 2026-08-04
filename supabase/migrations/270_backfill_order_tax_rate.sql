-- 270_backfill_order_tax_rate.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- The one heavy half of migration 269: fill in what every EXISTING order was taxed at.
--
-- Split out of 269 so that file stays metadata-only and instantly appliable. This one is a single
-- UPDATE over every order row (~400k on the backup database) — not dangerous, it only writes one
-- derived column and touches no money, but not free either. RUN IT WHEN THE SHARED INSTANCE IS
-- QUIET, and check afterwards:
--     select count(*) from orders where tax_rate is null and tax is not null and subtotal > 0;
--   → 0
--
-- Until it runs, a historical row has a NULL rate and every reader falls back to the restaurant's
-- current setting, which is precisely today's behaviour — so there is no window where anything is
-- worse than before.
--
-- Two cases, because the banquet's stored tax was computed on the DISCOUNTED base while every
-- other sale used the gross. (From mig 269 onward a new banquet order stores gross like everything
-- else, so the plain tax/subtotal rule is correct for every row created after this point.)
-- ─────────────────────────────────────────────────────────────────────────────

-- Derived only — no money column is touched. Two cases, because the banquet's stored tax was
-- computed on the DISCOUNTED base while everything else used the gross.
WITH bq AS (SELECT DISTINCT order_id FROM banquet_bills WHERE order_id IS NOT NULL)
UPDATE orders o SET tax_rate = round(
  o.tax::numeric / NULLIF(
    CASE WHEN EXISTS (SELECT 1 FROM bq WHERE bq.order_id = o.id)
         THEN o.subtotal::numeric - COALESCE(o.discount, 0)::numeric
         ELSE o.subtotal::numeric END, 0), 6)
WHERE o.tax_rate IS NULL AND o.tax IS NOT NULL AND COALESCE(o.subtotal, 0) > 0;


NOTIFY pgrst, 'reload schema';
