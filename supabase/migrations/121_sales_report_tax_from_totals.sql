-- 121_sales_report_tax_from_totals.sql
--
-- FIX (2026-07-05): lfh_owner_sales_report reported `tax` as SUM(orders.tax), but 913
-- historical PAID orders have tax=0 stored even though their `total` DOES include the tax
-- (total > subtotal). So the report showed rows with revenue > subtotal yet ₹0 tax —
-- arithmetically impossible and it under-counted tax by ~₹14,991.
--
-- The tax actually collected is embedded in the totals: total = subtotal + tax (the app has
-- no other add-on). So derive it as SUM(total - subtotal) over the same paid, non-cancelled
-- orders. For correct new orders (tax stored) this equals SUM(tax) exactly — no change; it
-- only corrects the historical rows, and makes the report internally consistent
-- (revenue = subtotal − discount + tax). Body otherwise IDENTICAL to migration 120.

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
         COALESCE(SUM(o.subtotal)             FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         -- tax actually collected = the tax baked into the totals (total = subtotal + tax),
         -- not the sometimes-unpopulated orders.tax column (2026-07-05 fix).
         COALESCE(SUM(o.total - o.subtotal)   FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COALESCE(SUM(o.discount)             FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COALESCE(SUM(o.total - o.discount)   FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(*) FILTER (WHERE o.status = 'cancelled')::bigint,
         COALESCE(SUM(o.total - o.discount)   FILTER (WHERE o.status = 'cancelled'), 0)::numeric
  FROM orders o
  WHERE o.created_at >= p_from AND o.created_at < p_to
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
  GROUP BY 1
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION lfh_owner_sales_report(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_owner_sales_report(uuid, timestamptz, timestamptz, text) TO service_role;

NOTIFY pgrst, 'reload schema';
