-- ============================================================================
-- 239_banquet_tax.sql — a banquet is taxed at its own rate
--
-- Owner, 2026-07-31: "In the banquet there is eighteen percent GST, not five percent.
-- Whatever is in the bill I have sent you of banquet, it should be like that."
--
-- That is how Indian GST actually works, and Aangan's own paper proves it: restaurant
-- service is 5% (CGST 2.5 + SGST 2.5) while a banquet / outdoor catering with food is
-- 18% (CGST 9 + SGST 9). ONE restaurant, TWO rates — so the banquet bill needs its own
-- tax lines instead of borrowing settings.tax_components (mig 119/126), which must keep
-- serving every dine-in table at 5%.
--
--   settings.banquet_tax_components — [{label,rate}], EMPTY means "use the restaurant's
--     normal tax", so nothing changes for a restaurant that never sets it.
--   banquet_bills.tax_lines — the split that was actually PRINTED, frozen at issue, so a
--     re-print years later cannot be re-split by a rate that changed in between.
--
-- Additive: two new columns, one new function, one CREATE OR REPLACE of the bill RPC.
-- ============================================================================

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS banquet_tax_components jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE banquet_bills
  ADD COLUMN IF NOT EXISTS tax_lines jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ── the banquet rate ────────────────────────────────────────────────────────
-- Sum of the banquet components when the restaurant set them, else exactly what
-- lfh_effective_tax_rate already returns (one source of truth per case; a banquet is
-- never taxed by accident at a rate nobody chose).
CREATE OR REPLACE FUNCTION lfh_banquet_tax_rate(p_restaurant_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (SELECT banquet_tax_components AS bc FROM settings WHERE restaurant_id = p_restaurant_id),
  comps AS (
    SELECT COALESCE(SUM((c->>'rate')::numeric), 0) AS pct
    FROM s CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s.bc) = 'array' THEN s.bc ELSE '[]'::jsonb END) c
    WHERE COALESCE(NULLIF(trim(c->>'label'), ''), '') <> ''
      AND COALESCE((c->>'rate')::numeric, 0) > 0
  )
  SELECT CASE WHEN COALESCE((SELECT pct FROM comps), 0) > 0
              THEN (SELECT pct FROM comps) / 100
              ELSE lfh_effective_tax_rate(p_restaurant_id) END;
$$;
REVOKE EXECUTE ON FUNCTION lfh_banquet_tax_rate(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_banquet_tax_rate(uuid) TO service_role;

-- ── the printed split, worked out ONCE on the server ────────────────────────
-- Rupee amounts per named tax, with the LAST line taking the remainder so the lines
-- always foot exactly to the tax on the total (the rule the customer bill and the GST
-- report already use). Returns [{label,rate,amt}].
CREATE OR REPLACE FUNCTION lfh_banquet_tax_lines(p_restaurant_id uuid, p_taxable numeric, p_tax numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_comps jsonb; v_c jsonb; v_sum numeric := 0; v_run numeric := 0;
  v_out jsonb := '[]'::jsonb; v_amt numeric; v_i int := 0; v_n int;
BEGIN
  SELECT CASE WHEN jsonb_typeof(banquet_tax_components) = 'array'
                   AND jsonb_array_length(banquet_tax_components) > 0
              THEN banquet_tax_components
              WHEN jsonb_typeof(tax_components) = 'array' THEN tax_components
              ELSE '[]'::jsonb END
    INTO v_comps FROM settings WHERE restaurant_id = p_restaurant_id;
  -- No named taxes anywhere: fall back to the historical CGST+SGST halves so the paper
  -- still itemises something truthful.
  IF v_comps IS NULL OR jsonb_array_length(v_comps) = 0 THEN
    v_comps := jsonb_build_array(
      jsonb_build_object('label', 'CGST', 'rate', round(COALESCE(lfh_banquet_tax_rate(p_restaurant_id), 0) * 100 / 2, 2)),
      jsonb_build_object('label', 'SGST', 'rate', round(COALESCE(lfh_banquet_tax_rate(p_restaurant_id), 0) * 100 / 2, 2)));
  END IF;
  SELECT COALESCE(SUM((c->>'rate')::numeric), 0) INTO v_sum
    FROM jsonb_array_elements(v_comps) c;
  IF v_sum <= 0 THEN v_sum := 1; END IF;
  v_n := jsonb_array_length(v_comps);
  FOR v_c IN SELECT * FROM jsonb_array_elements(v_comps) LOOP
    v_i := v_i + 1;
    v_amt := CASE WHEN v_i = v_n THEN round(p_tax - v_run, 2)
                  ELSE round(p_tax * ((v_c->>'rate')::numeric / v_sum), 2) END;
    v_run := v_run + v_amt;
    v_out := v_out || jsonb_build_object('label', v_c->>'label', 'rate', (v_c->>'rate')::numeric, 'amt', v_amt);
  END LOOP;
  RETURN v_out;
END; $$;
REVOKE EXECUTE ON FUNCTION lfh_banquet_tax_lines(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_banquet_tax_lines(uuid, numeric, numeric) TO service_role;

-- ── the bill RPC now taxes a banquet at the banquet rate ────────────────────
-- Body identical to mig 237 except: v_rate comes from lfh_banquet_tax_rate, and the
-- printed split is stored on the bill (tax_lines) so a re-print is always identical.
CREATE OR REPLACE FUNCTION lfh_banquet_bill_create(
  p_lines jsonb,
  p_meta  jsonb DEFAULT '{}'::jsonb,
  p_table text DEFAULT NULL,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001',
  p_by    text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid    uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_set    settings;
  v_table  text := NULLIF(trim(COALESCE(p_table, '')), '');
  v_fields jsonb;
  v_in     jsonb; v_bi banquet_items;
  v_qty    int; v_unit numeric; v_pct numeric; v_gross numeric;
  v_items  jsonb := '[]'::jsonb;
  v_sub    numeric := 0; v_disc numeric := 0; v_rate numeric; v_tax numeric; v_total numeric;
  v_lines  jsonb;
  v_s      sessions; v_order uuid; v_kot int;
  v_seq    int; v_no text; v_now timestamptz := now();
  v_adv    jsonb := '[]'::jsonb; v_recv numeric := 0; v_a jsonb;
  v_bill   uuid;
BEGIN
  SELECT * INTO v_set FROM settings WHERE restaurant_id = v_rid FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(v_set.banquet_allowed, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
  v_fields := COALESCE(v_set.banquet_fields, '[]'::jsonb);

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'empty_order');
  END IF;
  IF v_table IS NOT NULL AND v_table !~ '^\d+$' THEN
    RETURN json_build_object('ok', false, 'reason', 'bad_table');
  END IF;

  FOR v_in IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_bi FROM banquet_items
      WHERE id = (v_in->>'id')::uuid AND restaurant_id = v_rid AND active;
    IF NOT FOUND THEN
      RETURN json_build_object('ok', false, 'reason', 'unknown_item', 'item', v_in->>'id');
    END IF;
    v_qty := GREATEST(1, LEAST(5000, COALESCE(NULLIF(v_in->>'qty','')::int, 1)));
    v_unit := CASE WHEN COALESCE(v_bi.price, 0) = 0 AND (v_in ? 'price')
                   THEN GREATEST(0, LEAST(10000000, round(COALESCE(NULLIF(v_in->>'price','')::numeric, 0), 2)))
                   ELSE round(v_bi.price, 2) END;
    v_gross := v_unit * v_qty;
    v_sub := v_sub + v_gross;
    IF v_fields ? 'disc' THEN
      v_pct := GREATEST(0, LEAST(100, COALESCE(NULLIF(v_in->>'disc','')::numeric, 0)));
      v_disc := v_disc + round(v_gross * v_pct / 100, 2);
    END IF;
    v_items := v_items || jsonb_build_object(
      'id', v_bi.id,
      'title', v_bi.title || CASE WHEN COALESCE(v_bi.unit,'') <> '' THEN ' (' || v_bi.unit || ')' ELSE '' END,
      'price', to_char(v_unit, 'FM999999990.00'),
      'qty', v_qty, 'options', NULL, 'removed', '[]'::jsonb, 'note', NULL);
  END LOOP;

  -- THE banquet rate (18% where the restaurant set it), not the dine-in rate.
  v_rate  := lfh_banquet_tax_rate(v_rid);
  v_disc  := LEAST(v_disc, v_sub);
  v_tax   := round((v_sub - v_disc) * v_rate, 2);
  v_total := v_sub - v_disc + v_tax;
  v_lines := lfh_banquet_tax_lines(v_rid, v_sub - v_disc, v_tax);

  IF v_table IS NOT NULL THEN
    SELECT * INTO v_s FROM sessions
      WHERE table_number = v_table AND status = 'open' AND restaurant_id = v_rid
      ORDER BY last_activity_at DESC LIMIT 1;
    IF v_s.id IS NULL THEN
      INSERT INTO sessions(table_number, status, opened_by, opened_at, restaurant_id)
        VALUES (v_table, 'open', 'waiter', v_now, v_rid) RETURNING * INTO v_s;
    END IF;
  END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, discount, discount_note,
                     allergies, status, session_id, member_id, restaurant_id)
    VALUES (v_table, v_items, v_sub, v_tax, v_total, v_disc,
            CASE WHEN v_disc > 0 THEN 'banquet bill discount' END,
            '{}', 'served', v_s.id, NULL, v_rid)
    RETURNING id, kot_no INTO v_order, v_kot;

  FOR v_in IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note, status, restaurant_id)
      VALUES (v_order, v_s.id, v_in->>'title', (v_in->>'qty')::int, (v_in->>'price')::numeric,
              NULL, '{}', NULL, 'served', v_rid);
  END LOOP;
  IF v_s.id IS NOT NULL THEN
    UPDATE sessions SET last_activity_at = v_now WHERE id = v_s.id;
  END IF;

  v_seq := GREATEST(COALESCE(v_set.banquet_bill_next, 1), 1);
  UPDATE settings SET banquet_bill_next = v_seq + 1 WHERE restaurant_id = v_rid;
  v_no := lfh_banquet_bill_no(v_set.banquet_bill_prefix, v_set.banquet_bill_style, v_seq, v_now);

  IF (v_fields ? 'advance') OR (v_fields ? 'paysplit') THEN
    FOR v_a IN SELECT * FROM jsonb_array_elements(COALESCE(p_meta->'advances', '[]'::jsonb)) LOOP
      IF COALESCE(NULLIF(v_a->>'amt','')::numeric, 0) > 0 THEN
        v_adv  := v_adv || jsonb_build_object(
          'date', COALESCE(NULLIF(v_a->>'date',''), to_char(v_now, 'YYYY-MM-DD')),
          'mode', left(COALESCE(NULLIF(v_a->>'mode',''), 'Cash'), 20),
          'ref',  left(COALESCE(v_a->>'ref',''), 60),
          'amt',  round((v_a->>'amt')::numeric, 2));
        v_recv := v_recv + round((v_a->>'amt')::numeric, 2);
      END IF;
    END LOOP;
  END IF;

  INSERT INTO banquet_bills(
    restaurant_id, order_id, session_id, bill_seq, bill_no, issued_at,
    subtotal, tax, total, discount, received, advances, tax_lines,
    hall, func, fn_date, fn_from, fn_to, pax, rate,
    cust_name, cust_phone, cust_gstin, cust_addr, cust_person,
    remark, prepared_by, table_number, created_by)
  VALUES (
    v_rid, v_order, v_s.id, v_seq, v_no, v_now,
    v_sub, v_tax, v_total, v_disc, v_recv, v_adv, v_lines,
    CASE WHEN v_fields ? 'hall'    THEN left(NULLIF(p_meta->>'hall',''), 60) END,
    CASE WHEN v_fields ? 'func'    THEN left(NULLIF(p_meta->>'func',''), 60) END,
    CASE WHEN v_fields ? 'fndate'  THEN NULLIF(p_meta->>'fn_date','')::date END,
    CASE WHEN v_fields ? 'fndate'  THEN left(NULLIF(p_meta->>'fn_from',''), 10) END,
    CASE WHEN v_fields ? 'fndate'  THEN left(NULLIF(p_meta->>'fn_to',''), 10) END,
    CASE WHEN v_fields ? 'pax'     THEN NULLIF(p_meta->>'pax','')::int END,
    CASE WHEN v_fields ? 'rate'    THEN NULLIF(p_meta->>'rate','')::numeric END,
    CASE WHEN v_fields ? 'cust_name'  THEN left(NULLIF(p_meta->>'cust_name',''), 120) END,
    CASE WHEN v_fields ? 'cust_phone' THEN left(NULLIF(regexp_replace(COALESCE(p_meta->>'cust_phone',''), '[^0-9+]', '', 'g'), ''), 15) END,
    CASE WHEN v_fields ? 'gstin'   THEN upper(left(NULLIF(p_meta->>'cust_gstin',''), 20)) END,
    CASE WHEN v_fields ? 'address' THEN left(NULLIF(p_meta->>'cust_addr',''), 300) END,
    CASE WHEN v_fields ? 'person'  THEN left(NULLIF(p_meta->>'cust_person',''), 80) END,
    CASE WHEN v_fields ? 'remark'  THEN left(NULLIF(p_meta->>'remark',''), 300) END,
    left(NULLIF(COALESCE(p_meta->>'prepared_by', p_by), ''), 80),
    v_table, left(COALESCE(p_by, ''), 80))
  RETURNING id INTO v_bill;

  IF (v_fields ? 'cust_phone') AND lfh_phone10(p_meta->>'cust_phone') IS NOT NULL THEN
    INSERT INTO customers(phone, name, restaurant_id, first_seen_at, last_seen_at)
      VALUES (lfh_phone10(p_meta->>'cust_phone'),
              NULLIF(left(COALESCE(p_meta->>'cust_name',''), 120), ''), v_rid, v_now, v_now)
    ON CONFLICT (restaurant_id, phone) DO UPDATE
      SET name = COALESCE(NULLIF(EXCLUDED.name, ''), customers.name),
          last_seen_at = v_now;
  END IF;

  RETURN json_build_object('ok', true, 'bill_id', v_bill, 'bill_no', v_no, 'bill_seq', v_seq,
                           'order_id', v_order, 'kot_no', v_kot, 'table', v_table,
                           'subtotal', v_sub, 'tax', v_tax, 'total', v_total,
                           'discount', v_disc, 'received', v_recv, 'tax_lines', v_lines);
END; $$;
REVOKE EXECUTE ON FUNCTION lfh_banquet_bill_create(jsonb, jsonb, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_banquet_bill_create(jsonb, jsonb, text, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
