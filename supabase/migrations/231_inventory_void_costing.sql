-- 231_inventory_void_costing.sql — VOIDING A PURCHASE MUST UNDO ITS COST EFFECT
-- ═════════════════════════════════════════════════════════════════════════════
-- Found by a full re-test with deliberately awkward data (2026-07-30): a bill entered
-- at the WRONG PRICE and then voided left the ingredient's weighted-average cost
-- inflated, so the shelf stayed over-valued for ever.
--
--   buy 20 kg @ ₹0.06/g   → avg 0.0600          ✔
--   buy 50 kg @ ₹0.10/g   → avg 0.0886          ✔ (correct weighted average)
--   VOID that 50 kg bill  → qty back to 20 kg, avg STILL 0.0886   ✘  48% too high
--                            (₹535 of phantom value on this one ingredient)
--
-- WHY it happened: lfh_inv_post_movement (mig 221) leaves the average untouched on every
-- outflow. That is exactly right for consumption and waste — taking stock out at the
-- current average doesn't change the average of what remains. But a `purchase_void` is
-- NOT a consumption: it is the removal of an inflow that should never have happened, so
-- its cost effect has to be undone too.
--
-- THE RULE: a reversal-of-an-inflow removes value at the ORIGINAL inflow's unit cost and
-- re-derives the average over what is left —
--   new_avg = (old_qty × old_avg − reversed_qty × original_cost) ÷ (old_qty − reversed_qty)
-- Worked on the case above: (70000×0.0886 − 50000×0.10) ÷ 20000 = 1200 ÷ 20000 = 0.06 ✔
-- back to exactly the price actually paid.
--
-- Notice the arithmetic is the SAME weighted-average expression as an inflow (p_qty_base
-- is negative, so it subtracts). The only change is WHICH kinds recompute on an outflow.
-- Guard rails: never let the average go negative (bad data shouldn't produce a negative
-- asset), and reset to 0 when the reversal empties the balance.
--
-- Callers must pass the ORIGINAL cost on a reversal (the route now sends the purchase
-- line's own amount ÷ qty_base, and a waste-void sends the waste's snapshot cost);
-- passing NULL would value the reversal at today's average and cancel itself out.
-- LIVE-SAFE: replaces one function. No table changes. Existing movement rows are not
-- rewritten — see the note at the end about correcting an already-inflated average.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION lfh_inv_post_movement(
  p_restaurant  uuid,
  p_item        uuid,
  p_qty_base    numeric,
  p_kind        text,
  p_dedupe      text,
  p_unit_cost   numeric DEFAULT NULL,
  p_reason      text    DEFAULT NULL,
  p_ref_type    text    DEFAULT NULL,
  p_ref_id      text    DEFAULT NULL,
  p_created_by  text    DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old_qty  numeric;
  v_old_avg  numeric;
  v_new_qty  numeric;
  v_cost     numeric;
  v_id       bigint;
BEGIN
  IF p_qty_base IS NULL OR p_qty_base = 0 THEN
    RAISE EXCEPTION 'inv movement qty must be non-zero';
  END IF;

  SELECT qty_base, avg_cost INTO v_old_qty, v_old_avg
    FROM inv_items WHERE id = p_item AND restaurant_id = p_restaurant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inv item % not found for restaurant %', p_item, p_restaurant;
  END IF;

  v_cost := COALESCE(p_unit_cost, v_old_avg, 0);

  INSERT INTO inv_movements (restaurant_id, item_id, qty_base, kind, reason,
                             ref_type, ref_id, unit_cost, dedupe_key, created_by)
  VALUES (p_restaurant, p_item, p_qty_base, p_kind, p_reason,
          p_ref_type, p_ref_id, v_cost, p_dedupe, p_created_by)
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN NULL;                       -- replay: balance already reflects this movement
  END IF;

  v_new_qty := v_old_qty + p_qty_base;

  IF p_qty_base > 0 THEN
    -- INFLOW: standard perpetual weighted average. A balance at or below zero has no
    -- meaningful average to blend with (mig 221's clamp), so the new cost takes over.
    IF v_old_qty <= 0 THEN
      v_old_avg := v_cost;
    ELSE
      v_old_avg := ((v_old_qty * COALESCE(v_old_avg, 0)) + (p_qty_base * v_cost)) / v_new_qty;
    END IF;
  ELSIF p_kind = 'purchase_void' THEN
    -- REVERSAL OF AN INFLOW (this migration's fix): undo the value it added, at its own
    -- cost, and re-derive the average over what remains.
    IF v_new_qty > 0 THEN
      v_old_avg := GREATEST(((v_old_qty * COALESCE(v_old_avg, 0)) + (p_qty_base * v_cost)) / v_new_qty, 0);
    ELSE
      v_old_avg := 0;                  -- reversal emptied the balance: no average to hold
    END IF;
  END IF;
  -- every OTHER outflow (consumption / waste / transfer_out / count_adjust down) leaves
  -- the average alone — correct, and unchanged from mig 221.

  UPDATE inv_items
     SET qty_base   = v_new_qty,
         avg_cost   = COALESCE(v_old_avg, 0),
         updated_at = now()
   WHERE id = p_item;

  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION lfh_inv_post_movement(uuid,uuid,numeric,text,text,numeric,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_inv_post_movement(uuid,uuid,numeric,text,text,numeric,text,text,text,text)
  TO service_role;

-- Correcting averages that were ALREADY inflated by a void before this fix: there is no
-- safe blanket re-derivation (a ledger may legitimately contain manual adjustments), and
-- silently rewriting history is exactly what this project forbids. The honest correction
-- is the one the module already has: a physical count, which posts a dated, visible
-- count_adjust. No restaurant is live on inventory yet, so no real data is affected.

NOTIFY pgrst, 'reload schema';
