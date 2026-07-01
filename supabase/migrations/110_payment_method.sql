-- 110_payment_method.sql
--
-- Owner (2026-07-01): when staff mark a bill paid, ask HOW it was paid (UPI / Cash /
-- Card / Other-with-a-note) and record it, so it later shows as a breakdown in both
-- the restaurant's own Dashboard and the admin/owner cross-restaurant dashboard.
-- Applies to every restaurant, no per-tenant toggle (owner, 2026-07-01 — "everything,
-- every feature, our data will be for every restaurant only for now").
--
-- ADDITIVE + safe: nullable columns, no backfill needed (existing paid orders simply
-- read as "Not recorded" in the breakdown — see lfh_owner_payment_breakdown below).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_note text;

-- Payment-method breakdown (revenue + order count per method) over a window.
-- p_restaurant_id NULL = across every restaurant (admin's platform-wide card);
-- a real id = one restaurant (manager Dashboard + owner/admin drill-down). Mirrors
-- lfh_owner_dish_breakdown's shape exactly (migration 089) so the API/UI can reuse
-- the same pattern. Only PAID, non-cancelled orders count — an order with no method
-- recorded (paid before this shipped, or via the per-order correction toggle, which
-- deliberately skips the picker) buckets under 'Not recorded' rather than vanishing.
CREATE OR REPLACE FUNCTION lfh_owner_payment_breakdown(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (method text, revenue numeric, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(o.payment_method, ''), 'Not recorded') AS method,
         COALESCE(SUM(o.total - o.discount), 0)::numeric AS revenue,
         COUNT(*)::bigint AS orders
  FROM orders o
  WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
    AND o.created_at >= p_from AND o.created_at < p_to
    AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

REVOKE EXECUTE ON FUNCTION lfh_owner_payment_breakdown(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_owner_payment_breakdown(uuid, timestamptz, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';
