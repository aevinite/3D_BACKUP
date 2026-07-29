-- 224_inventory_recipes.sql — INVENTORY STAGE 2: recipes + kitchen-fire depletion + usage report
-- ═════════════════════════════════════════════════════════════════════════════
-- Stage 2 of the inventory module (Stage 1 = mig 221). Adds:
--   A. inv_recipe_lines — dish→ingredient and prep-item→ingredient mappings
--   B. inv_items.recipe_batch_base — the batch size a prep recipe makes
--   C. lfh_inv_deplete_order() + trigger — automatic stock deduction the moment an
--      order is COMMITTED TO THE KITCHEN, with once-only keys per (order, dish, item)
--   D. lfh_inv_usage_report() — per-ingredient movement totals for the variance view
--
-- Design (docs/research/pos-inventory/00-MASTER-SYNTHESIS.md §1.3/1.4):
--   • Depletion fires at KOT-fire — in THIS app that is the moment an order's status
--     is (or becomes) anything in the kitchen-committed set. Guest orders are born
--     'pending' (kitchen hasn't started → no deduction until accepted); staff orders
--     and auto-accepted follow-ups are born 'preparing' (deduct immediately).
--   • Cancel matrix falls out naturally: pending→cancelled was never deducted;
--     preparing→cancelled KEEPS the deduction (the food was cooking) — it stays in
--     theoretical usage, which is correct because the ingredients really left the shelf.
--   • Once-only: every movement key is cons:<order>:<dish-slug>:<item>, enforced by the
--     UNIQUE dedupe index from mig 221 — a re-fired trigger, replayed write or repeated
--     status flip can never deduct twice.
--   • FAIL-OPEN, non-negotiable: the trigger swallows EVERY exception. A recipe problem
--     must never block a guest's order — worst case stock drifts and the count catches it.
--   • Known Stage-2 limits (documented, deliberate): qty edits AFTER firing don't adjust
--     stock (rare, editor-only path; the count absorbs it); a dish moved between tables
--     keeps its original order's deduction (correct — food already cooked).
--
-- LIVE-SAFE: additive only; the trigger no-ops for restaurants with zero recipe rows
-- (one indexed lookup), so nothing changes until a restaurant actually maps recipes.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── A. inv_recipe_lines ───────────────────────────────────────────────────────
-- owner_type 'dish': owner_key = the menu item's SLUG (orders.items[] carries slugs).
-- owner_type 'prep': owner_key = the prep inv_item's id::text (its own build list).
-- qty_base is per ONE unit sold (dish) / per ONE BATCH of recipe_batch_base (prep).
CREATE TABLE IF NOT EXISTS inv_recipe_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  owner_type     text NOT NULL CHECK (owner_type IN ('dish','prep')),
  owner_key      text NOT NULL,
  item_id        uuid NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  qty_base       numeric(16,4) NOT NULL CHECK (qty_base > 0),
  UNIQUE (restaurant_id, owner_type, owner_key, item_id)
);
-- The trigger's one lookup per order line; also the recipe editor's read.
CREATE INDEX IF NOT EXISTS idx_inv_recipe_lines_owner
  ON inv_recipe_lines (restaurant_id, owner_type, owner_key);
ALTER TABLE inv_recipe_lines ENABLE ROW LEVEL SECURITY;

-- ── B. prep batch size ────────────────────────────────────────────────────────
-- A prep item's recipe lists ingredients for ONE batch of this many BASE units
-- (e.g. gravy batch = 5000 ml). NULL = the item has no prep recipe.
ALTER TABLE inv_items ADD COLUMN IF NOT EXISTS recipe_batch_base numeric(16,4)
  CHECK (recipe_batch_base IS NULL OR recipe_batch_base > 0);

-- ── C. depletion at kitchen-fire ─────────────────────────────────────────────
-- Aggregates the order's items per slug (the same dish twice in items[] must sum,
-- not dedupe-away the second element), joins recipe lines, and posts one negative
-- 'consumption' movement per (dish, ingredient) valued at the item's current average
-- cost (lfh_inv_post_movement outflow default).
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
        SELECT it->>'slug' AS slug, SUM(COALESCE((it->>'qty')::numeric, 1)) AS qty
          FROM jsonb_array_elements(NEW.items) it
         WHERE COALESCE(it->>'slug','') <> ''
         GROUP BY it->>'slug'
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

DROP TRIGGER IF EXISTS trg_inv_deplete_order ON orders;
CREATE TRIGGER trg_inv_deplete_order
  AFTER INSERT OR UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION lfh_inv_deplete_order();

REVOKE EXECUTE ON FUNCTION lfh_inv_deplete_order() FROM PUBLIC, anon, authenticated;

-- ── D. usage / variance report ────────────────────────────────────────────────
-- Per ingredient over a window: purchased in, used by orders (theoretical),
-- produced (prep batches: + output / − ingredients), wasted, and count corrections
-- (the count_adjust bucket IS the unexplained variance — what the shelf said vs
-- what the ledger said). Value = Σ(qty × the movement's own unit_cost), so history
-- stays priced as it happened. One SQL aggregate — the client never sums the ledger.
CREATE OR REPLACE FUNCTION lfh_inv_usage_report(
  p_restaurant uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE (
  item_id        uuid,
  purchased_base numeric, purchased_val numeric,
  consumed_base  numeric, consumed_val  numeric,
  produced_base  numeric, produced_val  numeric,
  wasted_base    numeric, wasted_val    numeric,
  adjusted_base  numeric, adjusted_val  numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.item_id,
    COALESCE(SUM(CASE WHEN m.kind IN ('purchase','purchase_void','opening') THEN m.qty_base END), 0),
    COALESCE(SUM(CASE WHEN m.kind IN ('purchase','purchase_void','opening') THEN m.qty_base * m.unit_cost END), 0),
    COALESCE(SUM(CASE WHEN m.kind IN ('consumption','consumption_reversal') THEN m.qty_base END), 0),
    COALESCE(SUM(CASE WHEN m.kind IN ('consumption','consumption_reversal') THEN m.qty_base * m.unit_cost END), 0),
    COALESCE(SUM(CASE WHEN m.kind = 'production' THEN m.qty_base END), 0),
    COALESCE(SUM(CASE WHEN m.kind = 'production' THEN m.qty_base * m.unit_cost END), 0),
    COALESCE(SUM(CASE WHEN m.kind IN ('waste','waste_void') THEN m.qty_base END), 0),
    COALESCE(SUM(CASE WHEN m.kind IN ('waste','waste_void') THEN m.qty_base * m.unit_cost END), 0),
    COALESCE(SUM(CASE WHEN m.kind = 'count_adjust' THEN m.qty_base END), 0),
    COALESCE(SUM(CASE WHEN m.kind = 'count_adjust' THEN m.qty_base * m.unit_cost END), 0)
  FROM inv_movements m
  WHERE m.restaurant_id = p_restaurant
    AND m.created_at >= p_from AND m.created_at < p_to
  GROUP BY m.item_id;
$$;

REVOKE EXECUTE ON FUNCTION lfh_inv_usage_report(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_inv_usage_report(uuid, timestamptz, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';
