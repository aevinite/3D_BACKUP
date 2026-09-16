-- 388_a_money_function_reads_like_it_behaves.sql
-- (owner picked items 18 and 19 of sweep #9 terminal 29's round-2 report, 2026-09-16)
--
-- TWO SMALL THINGS, BOTH ABOUT BEING ABLE TO TRUST WHAT YOU READ.
--
-- 18. `lfh_reprice_order` and `lfh_delete_order_item` — the two functions that recompute a bill when
--     staff change an order — each opened with:
--
--         v_rate   numeric := 0.05;
--
--     and then, before a single figure was computed, overwrote it with
--     `v_rate := lfh_effective_tax_rate(...)`. The 5% never reached the money. But anyone opening
--     those functions to answer "what tax does this charge?" met a hard-coded 5% at the top, in a
--     product whose whole point is per-restaurant GST. It cost this sweep twenty minutes and very
--     nearly became a filed alarm about money that was never wrong.
--
--     The initialiser is removed. The declaration now says what is true: the rate is read from the
--     restaurant, below, and is never defaulted here.
--
--     ⚠ THE ONE THING THAT WOULD MAKE THIS DANGEROUS was checked mechanically before the file was
--     written: if `v_rate` were ever READ before the `lfh_effective_tax_rate` assignment, removing
--     the initialiser would turn a 5% into a NULL and silently zero the tax on an edited bill. The
--     generator refused to emit either function unless the assignment came strictly before the first
--     use, and unless `lfh_effective_tax_rate` was present at all.
--
-- 19. `lfh_platform_insert` — the Zomato/Swiggy door — was the one function of its group that did not
--     go through `lfh_rid` (migration 386). A blank restaurant still failed, but only because
--     `aggregator_orders.restaurant_id` is NOT NULL with no default, so the error named a column
--     instead of saying what was actually wrong. It now refuses the same way as the other nineteen.
--
-- NOBODY RE-TYPED A BODY. All three were GENERATED from `pg_get_functiondef` — the live text — and
-- the generator compared its own output back against that text with the intended tokens removed and
-- all whitespace stripped, refusing to write the file if anything else had moved. CREATE OR REPLACE
-- keeps each function's existing grants; no permission moves here.
--
-- No money changes value. This is the same arithmetic, said honestly.


-- lfh_reprice_order — dropped the dead `:= 0.05`
CREATE OR REPLACE FUNCTION public.lfh_reprice_order(p_order uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sub    numeric := 0;
  v_base   numeric := 0;
  v_nontax numeric := 0;
  v_mrp    numeric := 0;
  v_tax    numeric;
  v_rate   numeric;   -- set from lfh_effective_tax_rate below; never defaulted here
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
END; $function$
;

-- lfh_delete_order_item — dropped the dead `:= 0.05`
CREATE OR REPLACE FUNCTION public.lfh_delete_order_item(p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_rate    numeric;   -- set from lfh_effective_tax_rate below; never defaulted here
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
       SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW()), subtotal = 0, tax = 0, total = 0,
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
END; $function$
;

-- lfh_platform_insert — the restaurant now goes through lfh_rid
CREATE OR REPLACE FUNCTION public.lfh_platform_insert(p_source text, p_external_id text, p_customer text, p_phone text, p_items jsonb, p_total numeric, p_restaurant_id uuid)
 RETURNS aggregator_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row aggregator_orders; v_rid uuid := lfh_rid(p_restaurant_id);
BEGIN
  INSERT INTO aggregator_orders(restaurant_id, source, external_id, payload, status, status_history,
      customer_name, customer_phone, items, total, kot_no, accepted_at)
  VALUES (v_rid, p_source, p_external_id, '{}'::jsonb, 'accepted',
      jsonb_build_array(jsonb_build_object('status','accepted','at', NOW(), 'by','auto')),
      p_customer, p_phone, COALESCE(p_items, '[]'::jsonb), COALESCE(p_total, 0),
      lfh_next_counter(p_restaurant_id, 'kot'), NOW())
  RETURNING * INTO v_row;
  RETURN v_row;
END $function$
;

NOTIFY pgrst, 'reload schema';
