-- 120_owner_reports.sql
--
-- Owner-panel Reports engine (redesign 2026-07-04). ONE bucketed money summary the
-- /owner/reports page slices into every report type (sales / tax / discounts /
-- cancellations). Money follows the mig-113 rule exactly — revenue counts an order
-- only when it is NOT cancelled AND payment_status = 'paid', net of discount — so a
-- report can never disagree with the Bills tab or the dashboards.
--
-- `tax` here is SUM(orders.tax) over those same paid orders: the actual tax charged
-- (lfh_price_order stores it per order via lfh_effective_tax_rate, mig 119). The
-- CGST/SGST/component split is presentation: the API divides the summed tax in the
-- proportions of settings.tax_components (lib/tax.ts), it is NOT re-computed here.
--
-- Buckets pass straight to date_trunc: 'hour' | 'day' | 'week' | 'month' (the
-- 12-month report uses 'month'). IST bucketing matches lfh_owner_revenue_timeseries.

CREATE OR REPLACE FUNCTION lfh_owner_sales_report(
  p_restaurant_id uuid,          -- NULL = all restaurants summed together
  p_from timestamptz,
  p_to   timestamptz,
  p_bucket text                  -- 'hour' | 'day' | 'week' | 'month'
)
RETURNS TABLE (
  bucket           timestamptz,
  orders           bigint,       -- non-cancelled orders placed in the bucket
  paid_orders      bigint,       -- of those, settled (the money rows)
  subtotal         numeric,      -- paid, pre-tax pre-discount
  tax              numeric,      -- paid, as charged
  discount         numeric,      -- paid, given away
  revenue          numeric,      -- paid, total - discount (the everywhere-rule)
  cancelled_orders bigint,       -- lost business: voided orders…
  cancelled_value  numeric       -- …and what they were worth (total - discount)
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT date_trunc(COALESCE(NULLIF(p_bucket, ''), 'day'),
                    o.created_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid')::bigint,
         COALESCE(SUM(o.subtotal)           FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COALESCE(SUM(o.tax)                FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COALESCE(SUM(o.discount)           FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COALESCE(SUM(o.total - o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(*) FILTER (WHERE o.status = 'cancelled')::bigint,
         COALESCE(SUM(o.total - o.discount) FILTER (WHERE o.status = 'cancelled'), 0)::numeric
  FROM orders o
  WHERE o.created_at >= p_from AND o.created_at < p_to
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
  GROUP BY 1
  ORDER BY 1;
$$;

-- Staff-only surface: the /api/owner/reports route calls this with the service role
-- AFTER ownerScope has vetted the caller. Public/anon must never execute it (038 rule).
REVOKE ALL ON FUNCTION lfh_owner_sales_report(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_owner_sales_report(uuid, timestamptz, timestamptz, text) TO service_role;
