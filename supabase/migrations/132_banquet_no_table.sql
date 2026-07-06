-- 132_banquet_no_table.sql
--
-- Banquet bills WITHOUT a table (owner 2026-07-06: "why we need table 11 if we can
-- make bills from the banquet menu — we don't need both"). The table is now OPTIONAL:
--   • p_table given  → exactly as mig 130 (session on that table, settles from Tables).
--   • p_table NULL/'' → a STANDALONE bill: order lands with table_number NULL and no
--     session — it shows in the manager's Bills tab as "Walk-in / no table" (the same
--     path platform orders already use) and is settled by the per-order Mark-paid /
--     discount buttons there. No phantom table needed, nothing on the floor map.
-- Body otherwise identical to mig 130 (server-priced, entitlement re-checked,
-- status 'served' so no kitchen ticket/chime/KOT ever fires).
CREATE OR REPLACE FUNCTION lfh_banquet_place_order(
  p_table text, p_lines jsonb,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid     uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_allowed boolean;
  v_table   text := NULLIF(trim(COALESCE(p_table, '')), '');
  v_s       sessions; v_order uuid; v_kot int;
  v_in      jsonb; v_bi banquet_items;
  v_qty     int; v_unit numeric;
  v_items   jsonb := '[]'::jsonb;
  v_sub     numeric := 0; v_rate numeric; v_tax numeric; v_total numeric;
BEGIN
  SELECT banquet_allowed INTO v_allowed FROM settings WHERE restaurant_id = v_rid;
  IF NOT COALESCE(v_allowed, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_allowed');
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'empty_order');
  END IF;
  -- A table, when given, must be numeric; blank means "standalone bill".
  IF v_table IS NOT NULL AND v_table !~ '^\d+$' THEN
    RETURN json_build_object('ok', false, 'reason', 'bad_table');
  END IF;

  FOR v_in IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_bi FROM banquet_items
      WHERE id = (v_in->>'id')::uuid AND restaurant_id = v_rid AND active;
    IF NOT FOUND THEN
      RETURN json_build_object('ok', false, 'reason', 'unknown_item', 'item', v_in->>'id');
    END IF;
    v_qty  := GREATEST(1, LEAST(5000, COALESCE(NULLIF(v_in->>'qty', '')::int, 1)));
    v_unit := round(v_bi.price, 2);
    v_sub  := v_sub + (v_unit * v_qty);
    v_items := v_items || jsonb_build_object(
      'id',      v_bi.id,
      'title',   v_bi.title || CASE WHEN COALESCE(v_bi.unit, '') <> '' THEN ' (' || v_bi.unit || ')' ELSE '' END,
      'price',   to_char(v_unit, 'FM999999990.00'),
      'qty',     v_qty,
      'options', NULL,
      'removed', '[]'::jsonb,
      'note',    NULL
    );
  END LOOP;

  v_rate  := lfh_effective_tax_rate(v_rid);
  v_tax   := round(v_sub * v_rate, 2);
  v_total := v_sub + v_tax;

  -- With a table: attach to (or open) that table's session, as before. Without:
  -- no session at all — a standalone walk-in-style bill.
  IF v_table IS NOT NULL THEN
    SELECT * INTO v_s FROM sessions
      WHERE table_number = v_table AND status = 'open' AND restaurant_id = v_rid
      ORDER BY last_activity_at DESC LIMIT 1;
    IF v_s.id IS NULL THEN
      INSERT INTO sessions(table_number, status, opened_by, opened_at, restaurant_id)
        VALUES (v_table, 'open', 'waiter', NOW(), v_rid)
        RETURNING * INTO v_s;
    END IF;
  END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id, member_id, restaurant_id)
    VALUES (v_table, v_items, v_sub, v_tax, v_total, '{}', 'served', v_s.id, NULL, v_rid)
    RETURNING id, kot_no INTO v_order, v_kot;

  FOR v_in IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note, status, restaurant_id)
      VALUES (v_order, v_s.id, v_in->>'title', (v_in->>'qty')::int, (v_in->>'price')::numeric,
              NULL, '{}', NULL, 'served', v_rid);
  END LOOP;

  IF v_s.id IS NOT NULL THEN
    UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  END IF;
  RETURN json_build_object('ok', true, 'order_id', v_order, 'kot_no', v_kot,
                           'subtotal', v_sub, 'tax', v_tax, 'total', v_total,
                           'table', v_table);
END; $$;

-- Same grants as mig 130 (CREATE OR REPLACE with an unchanged signature keeps them,
-- restated for clarity/idempotence).
REVOKE EXECUTE ON FUNCTION lfh_banquet_place_order(text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_banquet_place_order(text, jsonb, uuid) TO service_role;
