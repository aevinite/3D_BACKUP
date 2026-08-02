-- 254_where_the_money_came_from.sql — EARNINGS, SPLIT BY SOURCE
-- ═════════════════════════════════════════════════════════════════════════════
-- Owner ask (2026-08-02): the daily sheet gets two sub-reports under it — Expenses, and
-- Earning, and "earning will have all the different parts, like earned from parcel,
-- earned from order, earned from tips, or if any of that is given".
--
-- Dine-in already has an answer (lfh_owner_sales_report). This adds the parts that live
-- OUTSIDE the `orders` table, so the split can add up to the money-in total on top of the
-- sheet instead of quietly disagreeing with it:
--
--   parcel / zomato / swiggy / website  → aggregator_orders (mig 209), one row per ticket
--   tips                                → orders.tip (mig 154)
--   banquet                             → banquet_bills (mig 237)
--
-- ── THE DOUBLE-COUNT RULE (the whole reason this is a function and not a SUM) ──
-- An aggregator ticket MAY be linked to a real `orders` row (`order_id`), and a banquet
-- bill usually is. When it is linked, its money is ALREADY inside the dine-in figures the
-- sales report produces, so counting it here as well would inflate the day. Both branches
-- therefore take `order_id IS NULL` ONLY. On the backup database today all four parcel
-- tickets are standalone, so the rule is invisible — which is exactly why it has to be
-- written down rather than discovered later by a wrong total.
--
-- ── WHICH TICKETS COUNT AS MONEY ─────────────────────────────────────────────
-- Not 'cancelled', not 'rejected', and not 'new' — a still-"new" delivery ticket has not
-- been accepted by the restaurant yet. This is the SAME basis the manager dashboard's
-- channel split already uses (app/api/editor/[...path]/route.ts, "platform revenue counts
-- a delivery order only once it's ACCEPTED+", owner 2026-07-05), so the owner's report and
-- the manager's dashboard cannot disagree about the same day.
--
-- ── TAX ON A PLATFORM TICKET ─────────────────────────────────────────────────
-- aggregator_orders stores ONE `total` and no tax column, so the GST inside it is derived
-- at the restaurant's own effective rate: gst = total − total/(1+rate). It is a derivation,
-- not a stored figure, and the screen says so. Never present it as filing data — the
-- Tax/GST report stays the single source for that.
--
-- Tips are returned as their own row and are deliberately NOT sales: they are money that
-- arrived, but in an Indian restaurant they are normally the staff's, so folding them into
-- the owner's profit would overstate it. The reader shows them beside the total, not in it.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION lfh_owner_other_earnings(
  p_restaurant uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE (source text, orders bigint, amount numeric, gst numeric, is_sales boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH rate AS (
    SELECT COALESCE(lfh_effective_tax_rate(p_restaurant), 0.05) AS r
  ),
  -- Parcel, Zomato, Swiggy, the restaurant's own website — anything on the platform board
  -- that is NOT already represented by an `orders` row.
  plat AS (
    SELECT a.source::text AS src, COUNT(*)::bigint AS n, SUM(COALESCE(a.total, 0)) AS amt
      FROM aggregator_orders a
     WHERE a.restaurant_id = p_restaurant
       AND a.order_id IS NULL
       AND a.status NOT IN ('cancelled', 'rejected', 'new')
       AND a.created_at >= p_from AND a.created_at < p_to
     GROUP BY a.source
  ),
  -- Banquet bills that stand on their own (a bill raised over an existing order is already
  -- counted in the dine-in figures).
  banq AS (
    SELECT 'banquet'::text AS src, COUNT(*)::bigint AS n,
           SUM(COALESCE(b.total, 0)) AS amt, SUM(COALESCE(b.tax, 0)) AS tx
      FROM banquet_bills b
     WHERE b.restaurant_id = p_restaurant
       AND b.order_id IS NULL
       AND b.voided_at IS NULL
       AND b.issued_at >= p_from AND b.issued_at < p_to
    HAVING COUNT(*) > 0
  ),
  -- Tips ride on a dine-in order, so they use that order's own paid/effective-date rule.
  tips AS (
    SELECT 'tips'::text AS src, COUNT(*)::bigint AS n, SUM(o.tip) AS amt
      FROM orders o
     WHERE o.restaurant_id = p_restaurant
       AND COALESCE(o.tip, 0) > 0
       AND o.status <> 'cancelled'
       AND o.payment_status = 'paid'
       AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END)
             >= p_from
       AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END)
             <  p_to
    HAVING SUM(o.tip) > 0
  )
  SELECT p.src, p.n, round(p.amt, 2),
         -- derived, because a platform ticket carries no tax column of its own
         round(p.amt - (p.amt / (1 + rate.r)), 2), true
    FROM plat p, rate
  UNION ALL
  SELECT b.src, b.n, round(b.amt, 2), round(b.tx, 2), true FROM banq b
  UNION ALL
  -- Tips: money in, but not a sale and not taxed here.
  SELECT t.src, t.n, round(t.amt, 2), 0::numeric, false FROM tips t
  ORDER BY 3 DESC;
$$;

REVOKE EXECUTE ON FUNCTION lfh_owner_other_earnings(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_owner_other_earnings(uuid, timestamptz, timestamptz) TO service_role;

-- The window filter above has no index to stand on for a busy platform board.
CREATE INDEX IF NOT EXISTS idx_aggregator_orders_rest_created
  ON aggregator_orders (restaurant_id, created_at DESC)
  WHERE order_id IS NULL;

NOTIFY pgrst, 'reload schema';
