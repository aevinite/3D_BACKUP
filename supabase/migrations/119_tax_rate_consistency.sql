-- 119_tax_rate_consistency.sql
--
-- FIX (2026-07-04): the named multi-tax feature (tax_components, mig 117) was cosmetic —
-- it only reached the PRINTED bill. Every server money path still hardcoded 5%
-- (`v_rate := 0.05`) in lfh_price_order (118), lfh_reprice_order + lfh_delete_order_item
-- (068). So a restaurant on, say, 12% had its orders STORED at 5%, and the staff pay
-- screen / dashboard (which read the stored total) collected the wrong amount — one bill
-- could show four different totals.
--
-- This migration introduces ONE source of truth for the rate — lfh_effective_tax_rate()
-- — mirroring taxModel() in the editor panel and effectiveTaxRate() in lib/tax.ts, and
-- points the three tax-computing functions at it. Bodies are otherwise IDENTICAL to 118 /
-- 068 (only the rate source changed). Purely a correctness fix; additive, no schema change.

-- ── ONE source of truth for a restaurant's effective tax rate (as a DECIMAL). ──
-- Named components (label + rate% > 0) SUM to the total rate; if none, the fallback
-- tax_rate; if that's 0/blank, 5%. Matches lib/tax.ts + the client taxModel() exactly.
CREATE OR REPLACE FUNCTION lfh_effective_tax_rate(p_restaurant_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT tax_components, tax_rate FROM settings WHERE restaurant_id = p_restaurant_id
  ),
  comps AS (
    SELECT COALESCE(SUM((c->>'rate')::numeric), 0) AS pct
    FROM s
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s.tax_components) = 'array' THEN s.tax_components ELSE '[]'::jsonb END) c
    WHERE COALESCE(NULLIF(trim(c->>'label'), ''), '') <> ''
      AND COALESCE((c->>'rate')::numeric, 0) > 0
  )
  SELECT CASE
    WHEN COALESCE((SELECT pct FROM comps), 0) > 0 THEN (SELECT pct FROM comps) / 100.0
    ELSE COALESCE(NULLIF((SELECT tax_rate FROM s), 0), 0.05)
  END;
$$;
GRANT EXECUTE ON FUNCTION lfh_effective_tax_rate(uuid) TO anon, authenticated, service_role;

-- ── lfh_price_order: body IDENTICAL to mig 118, only v_rate now per-restaurant. ──
DROP FUNCTION IF EXISTS lfh_price_order(jsonb, uuid);
CREATE OR REPLACE FUNCTION lfh_price_order(
  p_items jsonb,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_rid   uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_in    jsonb;
  v_mi    menu_items;
  v_qty   int;
  v_base  numeric;
  v_add   numeric;
  v_opts  jsonb;
  v_unit  numeric;
  v_items jsonb := '[]'::jsonb;
  v_sub   numeric := 0;
  v_tax   numeric;
  v_total numeric;
  v_rate  numeric := 0.05;   -- overwritten below with this restaurant's effective rate
BEGIN
  v_rate := lfh_effective_tax_rate(v_rid);   -- (119) per-restaurant tax, not a flat 5%
  -- An order with no lines is meaningless — refuse it.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_order');
  END IF;

  FOR v_in IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    -- Look up the real dish IN THIS RESTAURANT. A dish that exists but belongs
    -- to another restaurant is just as unknown as a made-up id.
    SELECT * INTO v_mi FROM menu_items
      WHERE id = v_in->>'id' AND restaurant_id = v_rid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'unknown_item', 'item', v_in->>'id');
    END IF;

    -- Sold-out dishes can NEVER be ordered, even if the front-end was bypassed.
    IF 'sold-out' = ANY(v_mi.tags) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'sold_out', 'item', v_mi.title);
    END IF;

    -- Quantity: at least 1, capped at 99 so nobody orders a ludicrous amount.
    v_qty := GREATEST(1, LEAST(99, COALESCE(NULLIF(v_in->>'qty', '')::int, 1)));

    -- Base price comes from the DB (text like "2.99"); strip anything non-numeric.
    v_base := COALESCE(NULLIF(regexp_replace(v_mi.price, '[^0-9.]', '', 'g'), '')::numeric, 0);

    -- Add-ons: ONLY options that truly exist on this dish count, at the DB's price.
    SELECT
      COALESCE(SUM((ch->>'price')::numeric), 0),
      COALESCE(jsonb_agg(jsonb_build_object(
        'group', grp->>'name', 'label', ch->>'label', 'price', (ch->>'price')::numeric)), '[]'::jsonb)
      INTO v_add, v_opts
    FROM jsonb_array_elements(COALESCE(v_in->'options', '[]'::jsonb)) opt
    JOIN jsonb_array_elements(COALESCE(v_mi.options, '[]'::jsonb)) grp
      ON grp->>'name' = opt->>'group'
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(grp->'choices', '[]'::jsonb)) ch
    WHERE ch->>'label' = opt->>'label';

    v_unit := lfh_nice_usd(v_base) + COALESCE(v_add, 0);
    v_sub  := v_sub + (v_unit * v_qty);

    v_items := v_items || jsonb_build_object(
      'id',      v_mi.id,
      'title',   v_mi.title,
      'price',   to_char(v_unit, 'FM999999990.00'),
      'qty',     v_qty,
      'options', CASE WHEN v_opts = '[]'::jsonb THEN NULL ELSE v_opts END,
      'removed', CASE WHEN jsonb_typeof(v_in->'removed') = 'array' THEN v_in->'removed' ELSE '[]'::jsonb END,
      'note',    v_in->>'note'
    );
  END LOOP;

  v_tax   := round(v_sub * v_rate, 2);
  v_total := v_sub + v_tax;
  RETURN jsonb_build_object('ok', true, 'items', v_items,
                            'subtotal', v_sub, 'tax', v_tax, 'total', v_total);
END; $$;
GRANT EXECUTE ON FUNCTION lfh_price_order(jsonb, uuid) TO anon, authenticated;

-- ── lfh_reprice_order: body IDENTICAL to mig 068, only v_rate now per-restaurant. ──
CREATE OR REPLACE FUNCTION lfh_reprice_order(p_order uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub   numeric := 0;
  v_rate  numeric := 0.05;
  v_rid   uuid;
  v_total_n int; v_served_n int; v_active boolean;
  v_status text;
BEGIN
  SELECT restaurant_id INTO v_rid FROM orders WHERE id = p_order;
  v_rate := lfh_effective_tax_rate(v_rid);   -- (119) per-restaurant tax, not a flat 5%

  SELECT COALESCE(SUM(unit_price * qty), 0),
         COUNT(*),
         COUNT(*) FILTER (WHERE status = 'served'),
         COALESCE(bool_or(status IN ('preparing', 'ready', 'served')), false)
    INTO v_sub, v_total_n, v_served_n, v_active
    FROM order_items WHERE order_id = p_order;

  v_status := CASE
    WHEN v_total_n > 0 AND v_served_n = v_total_n THEN 'served'
    WHEN v_active THEN 'preparing'
    ELSE 'received' END;

  UPDATE orders
     SET subtotal = v_sub,
         tax      = round(v_sub * v_rate, 2),
         total    = v_sub + round(v_sub * v_rate, 2),
         status   = CASE WHEN status = 'cancelled' THEN status ELSE v_status END
   WHERE id = p_order;

  PERFORM lfh_sync_order_items_json(p_order); -- rebuild the KOT ticket from order_items
  RETURN v_sub + round(v_sub * v_rate, 2);
END; $$;

-- ── lfh_delete_order_item: body IDENTICAL to mig 068, only v_rate now per-restaurant. ──
CREATE OR REPLACE FUNCTION lfh_delete_order_item(p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item    order_items;
  v_order   orders;
  v_sub     numeric := 0;
  v_tax     numeric;
  v_total   numeric;
  v_left    int;
  v_rate    numeric := 0.05;
BEGIN
  SELECT * INTO v_item FROM order_items WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'item_not_found'); END IF;
  SELECT * INTO v_order FROM orders WHERE id = v_item.order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;

  v_rate := lfh_effective_tax_rate(v_order.restaurant_id);   -- (119) per-restaurant tax

  IF v_order.payment_status = 'paid' AND v_order.status <> 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_paid');
  END IF;

  DELETE FROM order_items WHERE id = p_item_id;

  SELECT COALESCE(SUM(unit_price * qty), 0), COUNT(*)
    INTO v_sub, v_left
    FROM order_items WHERE order_id = v_order.id;

  -- No dishes left → cancel the order so no empty ₹0 line lingers on the bill.
  IF v_left = 0 THEN
    UPDATE orders
       SET status = 'cancelled', subtotal = 0, tax = 0, total = 0, items = '[]'::jsonb
     WHERE id = v_order.id;
    RETURN jsonb_build_object('ok', true, 'order_id', v_order.id,
                              'order_cancelled', true, 'items_left', 0, 'total', 0);
  END IF;

  v_tax   := round(v_sub * v_rate, 2);
  v_total := v_sub + v_tax;
  UPDATE orders SET subtotal = v_sub, tax = v_tax, total = v_total WHERE id = v_order.id;
  PERFORM lfh_sync_order_items_json(v_order.id); -- rebuild ticket from the SURVIVORS

  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id,
                            'order_cancelled', false, 'items_left', v_left, 'total', v_total);
END; $$;

-- Re-lock the two staff-only functions (CREATE OR REPLACE keeps grants, but be explicit).
REVOKE ALL ON FUNCTION lfh_reprice_order(uuid)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_delete_order_item(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_reprice_order(uuid)     TO service_role;
GRANT EXECUTE ON FUNCTION lfh_delete_order_item(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
