-- 272_composition_rate_and_mrp_lock.sql
--
-- Two faults in migration 270, both found before anything shipped. Neither can reach a live
-- restaurant today (every restaurant is on price_tax_mode='excl' with the master switch off),
-- but both would have been real the first time someone used the feature.
--
-- FAULT 1 — a composition-scheme restaurant could not give a discount at all.
--   Under composition every line resolves to 'exempt', so taxable_base is 0, so the discount
--   cap (lfh_order_discount_base) was 0. Worse, the identity every panel relies on —
--     due = total − discount × (1 + rate)
--   would have over-subtracted, because lfh_effective_tax_rate still returned the configured
--   rate (say 5%) for a restaurant that charges no tax at all. A ₹100 discount would have
--   taken ₹105 off the bill.
--   FIX: a composition restaurant's effective tax rate IS zero. Saying so in the one function
--   that answers "what is this restaurant's rate?" fixes the due formula, the analytics, the
--   Z-report and the discount cap in a single place, which is the whole reason that function
--   exists. No restaurant is on composition today, so nothing live moves.
--
-- FAULT 2 — MRP was conflated with "untaxed".
--   nontax_amount holds BOTH kinds of untaxed line: a sealed bottle sold at MRP (price is
--   legally final — a discount must never touch it) and an ordinary nil-rated good (a normal
--   item that simply carries no GST, and which staff may absolutely discount). Protecting both
--   meant refusing legitimate discounts on the second kind.
--   FIX: track the MRP part separately. Only THAT is locked.
--
-- The discount rule, stated once, in full:
--   · rate > 0  → cap at taxable_base. Any discount must land on the taxable part, or the
--                 due identity above stops holding and every panel's figure drifts.
--   · rate = 0  → cap at subtotal − mrp_amount. With no tax, (1 + rate) is 1, so the identity
--                 holds for a discount anywhere; only the MRP lock still applies.

-- ── 1. MRP is tracked apart from "merely untaxed" ────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mrp_amount numeric;   -- NULL = legacy = none

-- ── 2. A composition restaurant's rate is zero ───────────────────────────────────────────
-- Baseline: migration 119. The CASE is unchanged except for the new first branch.
CREATE OR REPLACE FUNCTION lfh_effective_tax_rate(p_restaurant_id uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  WITH s AS (
    SELECT tax_rate, tax_components, price_tax_mode
      FROM settings WHERE restaurant_id = p_restaurant_id
  ), comps AS (
    SELECT COALESCE(SUM((c->>'rate')::numeric), 0) AS pct
      FROM s, jsonb_array_elements(
             CASE WHEN jsonb_typeof(s.tax_components) = 'array' THEN s.tax_components
                  ELSE '[]'::jsonb END) c
     WHERE COALESCE(NULLIF(TRIM(c->>'label'), ''), '') <> ''
       AND COALESCE((c->>'rate')::numeric, 0) > 0
  )
  SELECT CASE
    -- Composition scheme: the restaurant cannot pass GST to the diner, so its effective rate
    -- is 0 — not "5% that we then hide". Hiding a rate while still arithmetically applying it
    -- is how a bill stops adding up.
    WHEN (SELECT price_tax_mode FROM s) = 'composition' THEN 0
    WHEN COALESCE((SELECT pct FROM comps), 0) > 0 THEN (SELECT pct FROM comps) / 100.0
    ELSE COALESCE(NULLIF((SELECT tax_rate FROM s), 0), 0.05)
  END;
$$;

-- ── 3. The split also reports the LOCKED part ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lfh_split_items_tax(p_items jsonb, p_restaurant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_rate   numeric := lfh_effective_tax_rate(p_restaurant_id);
  v_ln     jsonb;
  v_amt    numeric;
  v_mode   text;
  v_base   numeric := 0;
  v_nontax numeric := 0;
  v_mrp    numeric := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RETURN NULL; END IF;

  FOR v_ln IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_amt := round(
      COALESCE(NULLIF(regexp_replace(COALESCE(v_ln->>'price', ''), '[^0-9.]', '', 'g'), '')::numeric, 0)
      * GREATEST(1, COALESCE(NULLIF(v_ln->>'qty', '')::int, 1)), 2);
    v_mode := COALESCE(v_ln->>'tax_mode', 'excl');
    IF COALESCE((v_ln->>'is_mrp')::boolean, false) THEN v_mrp := v_mrp + v_amt; END IF;
    IF v_mode = 'exempt' THEN
      v_nontax := v_nontax + v_amt;
    ELSIF v_mode = 'incl' THEN
      v_base := v_base + round(v_amt / (1 + v_rate), 2);
    ELSE
      v_base := v_base + v_amt;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('taxable_base', v_base, 'nontax_amount', v_nontax,
                            'mrp_amount', v_mrp, 'rate', v_rate);
END; $$;

-- ── 4. The orders trigger carries mrp_amount through ─────────────────────────────────────
CREATE OR REPLACE FUNCTION lfh_orders_fill_tax_split()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_split jsonb;
BEGIN
  IF NEW.taxable_base IS NOT NULL THEN RETURN NEW; END IF;
  v_split := lfh_split_items_tax(NEW.items, NEW.restaurant_id);
  IF v_split IS NULL THEN RETURN NEW; END IF;

  NEW.taxable_base  := (v_split->>'taxable_base')::numeric;
  NEW.nontax_amount := (v_split->>'nontax_amount')::numeric;
  NEW.mrp_amount    := (v_split->>'mrp_amount')::numeric;

  -- The plain all-taxable case (every restaurant today) leaves the money untouched.
  IF NEW.nontax_amount > 0 OR NEW.taxable_base <> COALESCE(NEW.subtotal, 0) THEN
    NEW.subtotal := round(NEW.taxable_base + NEW.nontax_amount, 2);
    NEW.tax      := round(NEW.taxable_base * (v_split->>'rate')::numeric, 2);
    NEW.total    := round(NEW.subtotal + NEW.tax, 2);
  END IF;
  RETURN NEW;
END; $$;

-- ── 5. THE DISCOUNT CAP, in one place ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lfh_order_discount_base(p_order uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE
    -- No tax: (1 + rate) is 1, so a discount anywhere keeps the due identity true. Only the
    -- MRP lock still bites — a sealed bottle's price is final whatever the tax situation.
    WHEN lfh_effective_tax_rate(o.restaurant_id) = 0
      THEN GREATEST(COALESCE(o.subtotal, 0) - COALESCE(o.mrp_amount, 0), 0)
    -- Tax applies: the discount must land on the taxable part, or `due = total − disc×(1+rate)`
    -- — which the floor tiles, the waiter's due, the guest bill and every report rely on —
    -- silently stops being true.
    ELSE COALESCE(o.taxable_base, o.subtotal, 0)
  END
  FROM orders o WHERE o.id = p_order;
$$;

-- ── 6. Rebuilds from order_items keep mrp_amount right ───────────────────────────────────
-- Same bodies as migration 270; only the MRP accumulator is added.
CREATE OR REPLACE FUNCTION lfh_reprice_order(p_order uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub    numeric := 0;
  v_base   numeric := 0;
  v_nontax numeric := 0;
  v_mrp    numeric := 0;
  v_tax    numeric;
  v_rate   numeric := 0.05;
  v_rid    uuid;
  v_total_n int; v_served_n int; v_active boolean;
  v_status text;
BEGIN
  SELECT restaurant_id INTO v_rid FROM orders WHERE id = p_order;
  v_rate := lfh_effective_tax_rate(v_rid);

  SELECT
    COALESCE(SUM(CASE WHEN COALESCE(tax_mode,'excl') = 'exempt' THEN 0
                      WHEN COALESCE(tax_mode,'excl') = 'incl'
                        THEN round(unit_price * qty / (1 + v_rate), 2)
                      ELSE round(unit_price * qty, 2) END), 0),
    COALESCE(SUM(CASE WHEN COALESCE(tax_mode,'excl') = 'exempt'
                        THEN round(unit_price * qty, 2) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN is_mrp THEN round(unit_price * qty, 2) ELSE 0 END), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'served'),
    COALESCE(bool_or(status IN ('preparing', 'ready', 'served')), false)
    INTO v_base, v_nontax, v_mrp, v_total_n, v_served_n, v_active
    FROM order_items WHERE order_id = p_order;

  v_sub := round(v_base + v_nontax, 2);
  v_tax := round(v_base * v_rate, 2);

  v_status := CASE
    WHEN v_total_n > 0 AND v_served_n = v_total_n THEN 'served'
    WHEN v_active THEN 'preparing'
    ELSE 'received' END;

  UPDATE orders
     SET subtotal = v_sub, tax = v_tax, total = round(v_sub + v_tax, 2),
         taxable_base = v_base, nontax_amount = v_nontax, mrp_amount = v_mrp,
         status = CASE WHEN status = 'cancelled' THEN status ELSE v_status END
   WHERE id = p_order;

  PERFORM lfh_sync_order_items_json(p_order);
  RETURN round(v_sub + v_tax, 2);
END; $$;

CREATE OR REPLACE FUNCTION lfh_delete_order_item(p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item    order_items;
  v_order   orders;
  v_sub     numeric := 0;
  v_base    numeric := 0;
  v_nontax  numeric := 0;
  v_mrp     numeric := 0;
  v_tax     numeric;
  v_total   numeric;
  v_left    int;
  v_rate    numeric := 0.05;
BEGIN
  SELECT * INTO v_item FROM order_items WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'item_not_found'); END IF;
  SELECT * INTO v_order FROM orders WHERE id = v_item.order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;

  v_rate := lfh_effective_tax_rate(v_order.restaurant_id);

  IF v_order.payment_status = 'paid' AND v_order.status <> 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_paid');
  END IF;

  DELETE FROM order_items WHERE id = p_item_id;

  SELECT
    COALESCE(SUM(CASE WHEN COALESCE(tax_mode,'excl') = 'exempt' THEN 0
                      WHEN COALESCE(tax_mode,'excl') = 'incl'
                        THEN round(unit_price * qty / (1 + v_rate), 2)
                      ELSE round(unit_price * qty, 2) END), 0),
    COALESCE(SUM(CASE WHEN COALESCE(tax_mode,'excl') = 'exempt'
                        THEN round(unit_price * qty, 2) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN is_mrp THEN round(unit_price * qty, 2) ELSE 0 END), 0),
    COUNT(*)
    INTO v_base, v_nontax, v_mrp, v_left
    FROM order_items WHERE order_id = v_order.id;

  IF v_left = 0 THEN
    UPDATE orders
       SET status = 'cancelled', subtotal = 0, tax = 0, total = 0,
           taxable_base = 0, nontax_amount = 0, mrp_amount = 0, items = '[]'::jsonb
     WHERE id = v_order.id;
    RETURN jsonb_build_object('ok', true, 'order_id', v_order.id,
                              'order_cancelled', true, 'items_left', 0, 'total', 0);
  END IF;

  v_sub   := round(v_base + v_nontax, 2);
  v_tax   := round(v_base * v_rate, 2);
  v_total := round(v_sub + v_tax, 2);
  UPDATE orders SET subtotal = v_sub, tax = v_tax, total = v_total,
                    taxable_base = v_base, nontax_amount = v_nontax, mrp_amount = v_mrp
   WHERE id = v_order.id;
  PERFORM lfh_sync_order_items_json(v_order.id);

  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id,
                            'order_cancelled', false, 'items_left', v_left, 'total', v_total);
END; $$;

-- lfh_price_order is deliberately NOT re-issued here. The place-order functions insert an
-- order without setting taxable_base, so the trigger above fires and derives all three figures
-- — including mrp_amount — from the priced ticket. Re-issuing that long body to add one
-- accumulator it does not need is exactly the risk this migration's header warns about.

REVOKE ALL ON FUNCTION lfh_split_items_tax(jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_order_discount_base(uuid)    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_split_items_tax(jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION lfh_order_discount_base(uuid)    TO service_role;
-- lfh_effective_tax_rate keeps the grants migration 119 gave it.
GRANT EXECUTE ON FUNCTION lfh_effective_tax_rate(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
