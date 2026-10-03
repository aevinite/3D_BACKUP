-- 409_stock_deduction_never_fired.sql — the depletion trigger looked for a key that is never written
-- ═════════════════════════════════════════════════════════════════════════════
-- THE FAULT (found 2026-10-03, by asking why selling a dish never moved its stock)
--
-- mig 224 built automatic stock depletion and wired it to `orders`. It has never once fired.
-- `inv_movements` across the whole database holds count_adjust / opening / purchase / waste and
-- ZERO 'consumption' rows, on 300+ orders and 69 recipe lines.
--
-- Its own header states the assumption that broke it:
--     "owner_type 'dish': owner_key = the menu item's SLUG (orders.items[] carries slugs)"
-- orders.items[] does not carry slugs. Every order line in the app is built by ONE normaliser,
-- lfh_price_order(), which emits exactly:
--     id, title, price, qty, options, removed, note, tax_mode, is_mrp
-- There is no 'slug'. So the trigger's inner filter
--     WHERE COALESCE(it->>'slug','') <> ''
-- discarded every line before the recipe join was even reached, the loop ran zero times, and
-- because the function is deliberately FAIL-OPEN (EXCEPTION WHEN OTHERS THEN RETURN NEW) nothing
-- ever errored, logged, or looked wrong. A silent no-op for as long as the feature has existed.
--
-- Measured on the dev DB before this migration:
--   · 134,773 order lines total — 74,228 carry 'id', and the 59,965 carrying 'slug' are all
--     historical rows that predate lfh_price_order becoming the single writer.
--   · restaurant …0007 has 2,617 order lines for 'buddha-bowl' AND a recipe for it: the one place
--     the old code could have worked, and it still never did, because those rows are the old shape.
--
-- ── THE FIX: resolve the dish the way the order actually names it ────────────────────────────
-- The line carries `id` (e.g. 'buddha-bowl__aev'); the recipe is keyed by the menu item's slug
-- ('buddha-bowl'). menu_items holds both, so the trigger joins through it. ONE mechanism, not a
-- slug-with-an-id-fallback: `id` is what every line written by this app has, past and future, so
-- there is nothing for a second path to catch.
--
-- Deliberately NOT done: adding 'slug' to lfh_price_order's output. That function prices the bill;
-- the money path does not get touched to fix an inventory join when the id is already there.
--
-- Everything else about mig 224 stands and is re-stated verbatim below: fires only when the order
-- is kitchen-committed, once-only per (order, dish, ingredient) via the dedupe key, fail-open.
-- Verified by probe before shipping: an order for 2 × buddha-bowl now posts consumption of
-- -400 and -60 base units against its two ingredients (rolled back, no rows left behind).
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION lfh_inv_deplete_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
BEGIN
  -- Only when the order is kitchen-committed. 'pending' and 'cancelled' never deplete.
  IF NEW.status IS NULL OR NEW.status IN ('pending','cancelled') THEN RETURN NEW; END IF;
  IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

  FOR r IN
    SELECT rl.item_id, SUM(d.qty * rl.qty_base) AS use_base, d.slug
      FROM (
        -- The order line names the dish by menu_items.id; the recipe is keyed by its slug.
        -- Summing per SLUG (not per id) is what makes the same dish appearing twice in items[]
        -- add up instead of one copy winning.
        SELECT m.slug AS slug, SUM(COALESCE((it->>'qty')::numeric, 1)) AS qty
          FROM jsonb_array_elements(NEW.items) it
          JOIN menu_items m
            ON m.id = it->>'id'
           AND m.restaurant_id = NEW.restaurant_id
         WHERE COALESCE(m.slug, '') <> ''
         GROUP BY m.slug
      ) d
      JOIN inv_recipe_lines rl
        ON rl.restaurant_id = NEW.restaurant_id
       AND rl.owner_type = 'dish'
       AND rl.owner_key = d.slug
     GROUP BY rl.item_id, d.slug
  LOOP
    -- Once-only per (order, dish, ingredient): a replay/second status flip is a no-op.
    PERFORM lfh_inv_post_movement(
      NEW.restaurant_id, r.item_id, -r.use_base, 'consumption',
      'cons:' || NEW.id || ':' || r.slug || ':' || r.item_id,
      NULL, NULL, 'order', NEW.id::text, 'kitchen'
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- FAIL-OPEN: an inventory hiccup must never block an order reaching the kitchen.
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION lfh_inv_deplete_order() FROM PUBLIC, anon, authenticated;

-- ── THE SAME DEAD JOIN, IN THE TWO REPORTS THAT PRICE IT ────────────────────────────────────
-- Asking the live database which functions still read an order line's 'slug' returned exactly
-- two besides the trigger: lfh_inv_dish_cost and lfh_inv_coverage (mig 227). Both are therefore
-- just as dead, and in a way that LOOKS like an answer instead of an error:
--   · lfh_inv_dish_cost  — "sold qty" and "revenue" per mapped dish were always 0, so the dish
--     profit table showed every recipe costing money and earning nothing.
--   · lfh_inv_coverage   — total_revenue, covered_revenue and total_dishes were always 0. This
--     is the function the UI divides by to print the food-cost %, and it is explicitly the
--     "honesty gate on every percentage" (mig 227 §F). A zero denominator is the one number
--     that gate existed to prevent.
--
-- This is the THIRD time this join has been written wrong. Mig 130 fixed it in the owner
-- category breakdown on 2026-07-06 and wrote the reason down in its own header —
--   "the server-authoritative order builder (mig 029) writes each line as
--    {id, title, price, qty, options, removed, note} — no slug"
-- — and mig 224 and mig 227 both reintroduced it afterwards. Hence the comment on the join
-- below, in all three places: the order line names the dish by ID.
CREATE OR REPLACE FUNCTION lfh_inv_dish_cost(
  p_restaurant uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE (
  -- Column list copied from the LIVE function, not from mig 227: a later migration renamed
  -- menu_price -> price, and Postgres refuses a CREATE OR REPLACE that changes the row type.
  slug text, title text, price numeric,
  qty_sold numeric, revenue numeric,
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
  ), sold AS (   -- SAME revenue rule as lfh_owner_dish_breakdown, resolved id -> slug
    SELECT mi.slug AS slug,
           COALESCE(SUM((it->>'qty')::numeric), 0) AS qty_sold,
           COALESCE(SUM((it->>'qty')::numeric * (it->>'price')::numeric)
                    FILTER (WHERE o.payment_status = 'paid'), 0) AS revenue
      FROM orders o
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS it
      JOIN menu_items mi
        ON mi.restaurant_id = o.restaurant_id AND mi.id::text = (it->>'id')
     WHERE o.restaurant_id = p_restaurant
       AND o.status <> 'cancelled'
       AND o.created_at >= p_from AND o.created_at < p_to
       AND COALESCE(mi.slug, '') <> ''
     GROUP BY mi.slug
  )
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

CREATE OR REPLACE FUNCTION lfh_inv_coverage(
  p_restaurant uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE (
  total_revenue numeric, covered_revenue numeric,
  total_dishes integer, covered_dishes integer,
  mapped_recipes integer, menu_dishes integer
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH sold AS (
    SELECT mi.slug AS slug,
           COALESCE(SUM((it->>'qty')::numeric * (it->>'price')::numeric)
                    FILTER (WHERE o.payment_status = 'paid'), 0) AS revenue
      FROM orders o
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS it
      JOIN menu_items mi
        ON mi.restaurant_id = o.restaurant_id AND mi.id::text = (it->>'id')
     WHERE o.restaurant_id = p_restaurant
       AND o.status <> 'cancelled'
       AND o.created_at >= p_from AND o.created_at < p_to
       AND COALESCE(mi.slug, '') <> ''
     GROUP BY mi.slug
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

-- mig 227 granted these to the panel roles; CREATE OR REPLACE keeps existing grants, but a
-- function recreated by a future re-seed must not fall back to PUBLIC (the mig 038/267 lesson).
REVOKE EXECUTE ON FUNCTION lfh_inv_dish_cost(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION lfh_inv_coverage(uuid, timestamptz, timestamptz)  FROM PUBLIC, anon;
