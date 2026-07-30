-- 227_inventory_reports.sql — INVENTORY IN THE OWNER'S REPORTS (Stage 3)
-- ═════════════════════════════════════════════════════════════════════════════
-- Owner ask (2026-07-30): when the inventory module is ON, the Reports section gets
-- inventory sub-reports; the main Day-summary sheet carries the inventory money lines
-- in the same format; the price of everything bought, what dishes consumed, what's
-- left on the shelf — and NONE of it appears when the module is off. Explicitly:
-- "without any kind of calculation error".
--
-- ── THE THREE MONEY NUMBERS (never add them together) ────────────────────────
--   purchases_amt  CASH paid to suppliers in the window (day-book "money out").
--   consumed_val   COST of ingredients that went into dishes sold (COGS-ish). NOT cash.
--   stock_value    ASSET still on the shelf, valued at weighted-average cost, as of NOW.
-- Each RPC below returns them as separate columns and the UI labels them separately,
-- because summing any two of these is the classic inventory-reporting error.
--
-- ── THE COVERAGE RULE (this is what prevents a lying percentage) ─────────────
-- Recipes may cover ALL dishes or only SOME (the owner's words). A food-cost % of
-- "ingredient cost ÷ ALL revenue" is therefore wrong whenever coverage is partial —
-- it flatters the number without bound (a single mapped dish out of fifty reads as a
-- ~98% margin). So `lfh_inv_coverage` returns covered_revenue (revenue of dishes that
-- HAVE a recipe) beside total_revenue, and every percentage in the UI divides by
-- covered_revenue and states the coverage. Same revenue rule as
-- lfh_owner_dish_breakdown (payment_status='paid', status<>'cancelled', created_at
-- window) so these numbers RECONCILE with the Sales and Items reports rather than
-- disagreeing with them.
--
-- ── HISTORICAL vs CURRENT COST (two legitimate answers, kept apart) ─────────
--   Movement-based values (consumed/wasted/adjusted) use each movement's OWN unit_cost
--     → the exact cost as it was when the stock moved. Used for period reporting.
--   Recipe-based plate cost uses the ingredient's CURRENT avg_cost
--     → "what this dish costs to make today". Used for margin/pricing decisions.
--   R365 documents the same split; conflating them is why plate costs "drift".
--
-- Contents: A. window summary · B. per-ingredient movement report · C. purchases by
-- vendor · D. bucketed cost series (the deferred 2nd line on the sales chart) ·
-- E. per-dish ingredient cost & margin · F. recipe coverage.
-- LIVE-SAFE: read-only functions only. No table or column changes.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── A. one-row window summary (the Day-summary block + report hero band) ─────
CREATE OR REPLACE FUNCTION lfh_inv_report_summary(
  p_restaurant uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE (
  stock_value      numeric,   -- asset on the shelf right NOW (not window-bound)
  stock_items      integer,
  low_count        integer,
  negative_count   integer,
  purchases_amt    numeric,   -- CASH out to suppliers in the window
  purchases_count  integer,
  consumed_val     numeric,   -- COST of ingredients used by orders (positive = used)
  wasted_val       numeric,   -- COST written off as waste (positive = lost)
  waste_count      integer,
  expenses_amt     numeric,   -- the expense book (breakage/repair/utilities…)
  adjust_val       numeric,   -- count corrections: negative = shelf had LESS than the books
  production_val   numeric    -- value converted by prep batches (net ≈ 0 by design)
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    -- Remaining stock: only positive balances count as an asset; a negative balance is
    -- a data-entry gap (an un-entered purchase), never a negative asset.
    COALESCE((SELECT SUM(qty_base * avg_cost) FROM inv_items
               WHERE restaurant_id = p_restaurant AND active
                 AND track_level <> 'EXPENSE' AND qty_base > 0), 0),
    (SELECT COUNT(*)::int FROM inv_items WHERE restaurant_id = p_restaurant AND active),
    (SELECT COUNT(*)::int FROM inv_items WHERE restaurant_id = p_restaurant AND active
              AND par_qty IS NOT NULL AND qty_base < par_qty),
    (SELECT COUNT(*)::int FROM inv_items WHERE restaurant_id = p_restaurant AND active AND qty_base < 0),
    -- DOCUMENT dates, not created_at: a bill entered today for yesterday's delivery
    -- belongs to yesterday, and that is what the Inventory page already shows. Using
    -- created_at here made Reports disagree with that page for any back-dated entry.
    COALESCE((SELECT SUM(total) FROM inv_purchases
               WHERE restaurant_id = p_restaurant AND voided_at IS NULL
                 AND bill_date >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
                 AND bill_date <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date), 0),
    (SELECT COUNT(*)::int FROM inv_purchases
              WHERE restaurant_id = p_restaurant AND voided_at IS NULL
                AND bill_date >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
                AND bill_date <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date),
    -- Movement-sourced costs, signed so the UI never has to guess: outflows are stored
    -- negative, so -SUM() yields a positive "this much was used / lost".
    COALESCE((SELECT -SUM(qty_base * unit_cost) FROM inv_movements
               WHERE restaurant_id = p_restaurant AND kind IN ('consumption','consumption_reversal')
                 AND created_at >= p_from AND created_at < p_to), 0),
    COALESCE((SELECT -SUM(qty_base * unit_cost) FROM inv_movements
               WHERE restaurant_id = p_restaurant AND kind IN ('waste','waste_void')
                 AND created_at >= p_from AND created_at < p_to), 0),
    (SELECT COUNT(*)::int FROM inv_waste_entries
              WHERE restaurant_id = p_restaurant AND voided_at IS NULL
                AND waste_date >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
                AND waste_date <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date),
    COALESCE((SELECT SUM(amount) FROM expenses
               WHERE restaurant_id = p_restaurant AND voided_at IS NULL
                 AND expense_date >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
                 AND expense_date <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date), 0),
    COALESCE((SELECT SUM(qty_base * unit_cost) FROM inv_movements
               WHERE restaurant_id = p_restaurant AND kind = 'count_adjust'
                 AND created_at >= p_from AND created_at < p_to), 0),
    COALESCE((SELECT SUM(qty_base * unit_cost) FROM inv_movements
               WHERE restaurant_id = p_restaurant AND kind = 'production'
                 AND created_at >= p_from AND created_at < p_to), 0);
$$;

-- ── B. per-ingredient movement report (+ what's left) ────────────────────────
-- One row per ingredient that either moved in the window or still holds stock, so the
-- "remaining inventory" view and the "where did it go" view are the same table.
CREATE OR REPLACE FUNCTION lfh_inv_report_items(
  p_restaurant uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE (
  item_id uuid, name text, category text,
  base_uom text, purchase_uom text, purchase_factor numeric,
  on_hand_base numeric, on_hand_val numeric, par_qty numeric,
  bought_base numeric, bought_val numeric,
  used_base numeric, used_val numeric,
  wasted_base numeric, wasted_val numeric,
  adjust_base numeric, adjust_val numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mv AS (
    SELECT item_id,
      SUM(CASE WHEN kind IN ('purchase','purchase_void','opening') THEN qty_base ELSE 0 END) AS b_base,
      SUM(CASE WHEN kind IN ('purchase','purchase_void','opening') THEN qty_base * unit_cost ELSE 0 END) AS b_val,
      -SUM(CASE WHEN kind IN ('consumption','consumption_reversal') THEN qty_base ELSE 0 END) AS u_base,
      -SUM(CASE WHEN kind IN ('consumption','consumption_reversal') THEN qty_base * unit_cost ELSE 0 END) AS u_val,
      -SUM(CASE WHEN kind IN ('waste','waste_void') THEN qty_base ELSE 0 END) AS w_base,
      -SUM(CASE WHEN kind IN ('waste','waste_void') THEN qty_base * unit_cost ELSE 0 END) AS w_val,
      SUM(CASE WHEN kind = 'count_adjust' THEN qty_base ELSE 0 END) AS a_base,
      SUM(CASE WHEN kind = 'count_adjust' THEN qty_base * unit_cost ELSE 0 END) AS a_val
    FROM inv_movements
    WHERE restaurant_id = p_restaurant AND created_at >= p_from AND created_at < p_to
    GROUP BY item_id
  )
  SELECT i.id, i.name, i.category,
         i.base_uom, i.purchase_uom, i.purchase_factor,
         i.qty_base, GREATEST(i.qty_base, 0) * i.avg_cost, i.par_qty,
         COALESCE(mv.b_base, 0), COALESCE(mv.b_val, 0),
         COALESCE(mv.u_base, 0), COALESCE(mv.u_val, 0),
         COALESCE(mv.w_base, 0), COALESCE(mv.w_val, 0),
         COALESCE(mv.a_base, 0), COALESCE(mv.a_val, 0)
    FROM inv_items i
    LEFT JOIN mv ON mv.item_id = i.id
   WHERE i.restaurant_id = p_restaurant
     AND (i.active OR mv.item_id IS NOT NULL)     -- retired items still show if they moved
   ORDER BY (GREATEST(i.qty_base, 0) * i.avg_cost) DESC, i.name;
$$;

-- ── C. purchases by vendor ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lfh_inv_report_vendors(
  p_restaurant uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE (vendor text, bills integer, amount numeric, is_cash boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(TRIM(vendor_name), ''),
                  CASE WHEN kind = 'cash' THEN 'Cash / market' ELSE 'Unnamed supplier' END),
         COUNT(*)::int, COALESCE(SUM(total), 0), BOOL_AND(kind = 'cash')
    FROM inv_purchases
   WHERE restaurant_id = p_restaurant AND voided_at IS NULL
     AND bill_date >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
     AND bill_date <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date
   GROUP BY 1
   ORDER BY 3 DESC;
$$;

-- ── D. bucketed cost series — the deferred 2nd line on the sales chart ───────
-- Day or month buckets in IST, matching lfh_owner_sales_report's bucketing so the
-- cost line lands on the same x-axis as the revenue line (a UTC bucket here would
-- shift every point by 5.5h and make the two lines disagree at day edges).
CREATE OR REPLACE FUNCTION lfh_inv_cost_series(
  p_restaurant uuid, p_from timestamptz, p_to timestamptz, p_bucket text DEFAULT 'day'
) RETURNS TABLE (bucket text, purchased numeric, used numeric, wasted numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH b AS (
    SELECT CASE WHEN p_bucket = 'month'
                THEN to_char(date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM')
                ELSE to_char((created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') END AS bk,
           kind, qty_base, unit_cost
      FROM inv_movements
     WHERE restaurant_id = p_restaurant AND created_at >= p_from AND created_at < p_to
  ), p AS (
    -- bill_date (a DATE) buckets directly — no timezone shift to apply, and it keeps the
    -- cost line on the same day the Inventory page shows the purchase.
    SELECT CASE WHEN p_bucket = 'month' THEN to_char(bill_date, 'YYYY-MM')
                ELSE to_char(bill_date, 'YYYY-MM-DD') END AS bk,
           total
      FROM inv_purchases
     WHERE restaurant_id = p_restaurant AND voided_at IS NULL
       AND bill_date >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
       AND bill_date <  (p_to   AT TIME ZONE 'Asia/Kolkata')::date
  )
  SELECT k.bk,
         COALESCE((SELECT SUM(total) FROM p WHERE p.bk = k.bk), 0),
         COALESCE((SELECT -SUM(qty_base * unit_cost) FROM b
                    WHERE b.bk = k.bk AND b.kind IN ('consumption','consumption_reversal')), 0),
         COALESCE((SELECT -SUM(qty_base * unit_cost) FROM b
                    WHERE b.bk = k.bk AND b.kind IN ('waste','waste_void')), 0)
    FROM (SELECT bk FROM b UNION SELECT bk FROM p) k
   ORDER BY 1;
$$;

-- ── E. per-dish ingredient cost & margin (only dishes WITH a recipe) ────────
-- "For making a dish, how much stuff is used" — priced at the ingredient's CURRENT
-- average cost (today's plate cost, the number you price a menu against). Dishes
-- without a recipe are deliberately ABSENT rather than shown as zero-cost, so nobody
-- reads an unmapped dish as infinitely profitable.
CREATE OR REPLACE FUNCTION lfh_inv_dish_cost(
  p_restaurant uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE (
  slug text, title text, price numeric, qty_sold numeric, revenue numeric,
  plate_cost numeric, cost_total numeric, ingredients integer
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH rc AS (   -- plate cost per mapped dish, at current average ingredient cost
    SELECT rl.owner_key AS slug,
           SUM(rl.qty_base * i.avg_cost) AS plate_cost,
           COUNT(*)::int AS ingredients
      FROM inv_recipe_lines rl
      JOIN inv_items i ON i.id = rl.item_id AND i.restaurant_id = p_restaurant
     WHERE rl.restaurant_id = p_restaurant AND rl.owner_type = 'dish'
     GROUP BY rl.owner_key
  ), sold AS (   -- SAME revenue rule as lfh_owner_dish_breakdown, keyed by slug
    SELECT it->>'slug' AS slug,
           COALESCE(SUM((it->>'qty')::numeric), 0) AS qty_sold,
           COALESCE(SUM((it->>'qty')::numeric * (it->>'price')::numeric)
                    FILTER (WHERE o.payment_status = 'paid'), 0) AS revenue
      FROM orders o
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS it
     WHERE o.restaurant_id = p_restaurant
       AND o.status <> 'cancelled'
       AND o.created_at >= p_from AND o.created_at < p_to
       AND COALESCE(it->>'slug', '') <> ''
     GROUP BY it->>'slug'
  )
  -- menu_items.title is plain TEXT on this schema (not the multilingual jsonb the
  -- categories/filters tables use) — a ->>'en' here fails to even create the function.
  -- menu_items.title AND price are both plain TEXT on this schema (not the multilingual
  -- jsonb the categories table uses, and not numeric) — a ->>'en' or a bare ::numeric
  -- here fails to even create the function. price is regex-guarded because an
  -- open-price dish (mig 215) legitimately stores '' / NULL.
  SELECT rc.slug,
         COALESCE(NULLIF(TRIM(mi.title), ''), rc.slug) AS title,
         CASE WHEN COALESCE(mi.price, '') ~ '^[0-9]+(\.[0-9]+)?$' THEN mi.price::numeric ELSE 0 END,
         COALESCE(sold.qty_sold, 0), COALESCE(sold.revenue, 0),
         rc.plate_cost, rc.plate_cost * COALESCE(sold.qty_sold, 0), rc.ingredients
    FROM rc
    LEFT JOIN sold ON sold.slug = rc.slug
    LEFT JOIN menu_items mi ON mi.restaurant_id = p_restaurant AND mi.slug = rc.slug
   ORDER BY (rc.plate_cost * COALESCE(sold.qty_sold, 0)) DESC;
$$;

-- ── F. recipe coverage — the honesty gate on every percentage ────────────────
-- covered_* counts only dishes that HAVE a recipe. The UI divides by covered_revenue
-- and prints the coverage, so a partially-mapped menu can never produce a flattering
-- food-cost %.
CREATE OR REPLACE FUNCTION lfh_inv_coverage(
  p_restaurant uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE (
  total_revenue numeric, covered_revenue numeric,
  total_dishes integer, covered_dishes integer,
  mapped_recipes integer, menu_dishes integer
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH sold AS (
    SELECT it->>'slug' AS slug,
           COALESCE(SUM((it->>'qty')::numeric * (it->>'price')::numeric)
                    FILTER (WHERE o.payment_status = 'paid'), 0) AS revenue
      FROM orders o
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS it
     WHERE o.restaurant_id = p_restaurant
       AND o.status <> 'cancelled'
       AND o.created_at >= p_from AND o.created_at < p_to
       AND COALESCE(it->>'slug', '') <> ''
     GROUP BY it->>'slug'
  ), r AS (
    SELECT DISTINCT owner_key AS slug FROM inv_recipe_lines
     WHERE restaurant_id = p_restaurant AND owner_type = 'dish'
  )
  SELECT COALESCE(SUM(s.revenue), 0),
         COALESCE(SUM(s.revenue) FILTER (WHERE r.slug IS NOT NULL), 0),
         COUNT(*)::int,
         COUNT(*) FILTER (WHERE r.slug IS NOT NULL)::int,
         (SELECT COUNT(*)::int FROM r),
         (SELECT COUNT(*)::int FROM menu_items WHERE restaurant_id = p_restaurant)
    FROM sold s LEFT JOIN r ON r.slug = s.slug;
$$;

-- Service-role only, like every other lfh_* report function.
REVOKE EXECUTE ON FUNCTION lfh_inv_report_summary(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION lfh_inv_report_items(uuid, timestamptz, timestamptz)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION lfh_inv_report_vendors(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION lfh_inv_cost_series(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION lfh_inv_dish_cost(uuid, timestamptz, timestamptz)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION lfh_inv_coverage(uuid, timestamptz, timestamptz)       FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_inv_report_summary(uuid, timestamptz, timestamptz) TO service_role;
GRANT  EXECUTE ON FUNCTION lfh_inv_report_items(uuid, timestamptz, timestamptz)   TO service_role;
GRANT  EXECUTE ON FUNCTION lfh_inv_report_vendors(uuid, timestamptz, timestamptz) TO service_role;
GRANT  EXECUTE ON FUNCTION lfh_inv_cost_series(uuid, timestamptz, timestamptz, text) TO service_role;
GRANT  EXECUTE ON FUNCTION lfh_inv_dish_cost(uuid, timestamptz, timestamptz)      TO service_role;
GRANT  EXECUTE ON FUNCTION lfh_inv_coverage(uuid, timestamptz, timestamptz)       TO service_role;

NOTIFY pgrst, 'reload schema';
