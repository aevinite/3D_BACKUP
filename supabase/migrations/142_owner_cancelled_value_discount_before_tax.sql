-- Cancelled "lost value" was measured on a DIFFERENT money rule than every other
-- figure (audit, 2026-07-06). lfh_owner_sales_report.cancelled_value used
-- `total - discount`, while all paid revenue in the same report (and everywhere
-- else since mig 126) uses discount-BEFORE-tax `total - discount*(1+rate)`. So a
-- cancelled order that had a discount was OVERSTATED by `discount × tax_rate` in
-- the "Lost to cancellations" tile / cancellations report vs how the identical bill
-- is valued when paid. This aligns cancelled_value with the discount-before-tax rule.
--
-- ONLY line changed vs mig 126 §6 is the final cancelled_value SUM; everything else
-- (revenue, tax net-of-discount, subtotal, discount, counts) is copied verbatim so
-- this recreate can't drift any other number.
CREATE OR REPLACE FUNCTION lfh_owner_sales_report(
  p_restaurant_id uuid,
  p_from timestamptz,
  p_to   timestamptz,
  p_bucket text
)
RETURNS TABLE (
  bucket           timestamptz,
  orders           bigint,
  paid_orders      bigint,
  subtotal         numeric,
  tax              numeric,
  discount         numeric,
  revenue          numeric,
  cancelled_orders bigint,
  cancelled_value  numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT date_trunc(COALESCE(NULLIF(p_bucket, ''), 'day'),
                    o.created_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled')::bigint,
         COUNT(*) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid')::bigint,
         COALESCE(SUM(o.subtotal) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COALESCE(SUM(o.total - o.subtotal - o.discount * lfh_effective_tax_rate(o.restaurant_id)) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id))) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(*) FILTER (WHERE o.status = 'cancelled')::bigint,
         COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id))) FILTER (WHERE o.status = 'cancelled'), 0)::numeric
  FROM orders o
  WHERE o.created_at >= p_from AND o.created_at < p_to
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
  GROUP BY 1
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION lfh_owner_sales_report(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_owner_sales_report(uuid, timestamptz, timestamptz, text) TO service_role;

NOTIFY pgrst, 'reload schema';
