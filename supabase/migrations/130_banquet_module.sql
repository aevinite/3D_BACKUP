-- 130_banquet_module.sql
--
-- BANQUET MODULE, phase 1 (owner 2026-07-06): a SEPARATE bill-only menu for banquet /
-- fixed-plate events (price per plate × guest count). Banquet items live in their OWN
-- table — never in menu_items — so they can NEVER leak onto the guest menu or the
-- normal take-order screens by construction. Generating a banquet bill rides the
-- EXISTING order/session pipeline (same tax, invoice, mark-paid, Z-report), inserted
-- straight at status 'served' so it never appears as a kitchen ticket, never chimes,
-- never auto-prints a KOT — it exists only to be billed.
--
-- House two-layer gating pattern (mirrors auto_print_kot, mig 107 + 074):
--   • banquet_allowed  — the ADMIN's entitlement (default FALSE, new modules default off).
--   • tablet_banquet   — the manager/owner tri-state for the WAITER TABLET
--                        ('off' default | 'on' | 'pin'), same column style as
--                        tablet_discount (074), with the per-user override riding
--                        staff_users.permissions (mig 115) under the same key.
--   The manager panel's Banquet tab needs only the entitlement; the tablet needs
--   entitlement AND its tri-state to resolve on/pin.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS banquet_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tablet_banquet TEXT NOT NULL DEFAULT 'off'
  CHECK (tablet_banquet IN ('off','on','pin'));

-- The banquet menu itself. Deliberately slim: bill lines need a name and a per-unit
-- price, nothing else (no 3D, no tags, no allergens — it is not a dining menu).
CREATE TABLE IF NOT EXISTS banquet_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  title         text NOT NULL,
  price         numeric NOT NULL DEFAULT 0 CHECK (price >= 0),
  unit          text NOT NULL DEFAULT 'per plate',
  sort_order    int NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS banquet_items_rid_idx ON banquet_items(restaurant_id, sort_order);

-- Staff-only data: RLS on with NO anon/authenticated policies = only the service
-- role (our API routes) can touch it. Guests can never read a banquet menu.
ALTER TABLE banquet_items ENABLE ROW LEVEL SECURITY;

-- ── lfh_banquet_place_order: price a banquet bill SERVER-SIDE and land it as a
-- normal order on a table. Mirrors lfh_staff_place_order (081) + the mig-119 money
-- math, but prices from banquet_items and inserts at 'served' (bill-only).
-- Qty cap is 5000 (a wedding's plate count), not the dining cap of 99.
CREATE OR REPLACE FUNCTION lfh_banquet_place_order(
  p_table text, p_lines jsonb,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid     uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_allowed boolean;
  v_s       sessions; v_order uuid; v_kot int;
  v_in      jsonb; v_bi banquet_items;
  v_qty     int; v_unit numeric;
  v_items   jsonb := '[]'::jsonb;
  v_sub     numeric := 0; v_rate numeric; v_tax numeric; v_total numeric;
BEGIN
  -- Backend-first entitlement check: a restaurant the admin hasn't granted the
  -- module can't be billed through it even by a forged client.
  SELECT banquet_allowed INTO v_allowed FROM settings WHERE restaurant_id = v_rid;
  IF NOT COALESCE(v_allowed, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_allowed');
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'empty_order');
  END IF;
  IF p_table !~ '^\d+$' THEN
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

  -- The table's open session for THIS restaurant, or open one now (bill-on-first-order).
  SELECT * INTO v_s FROM sessions
    WHERE table_number = p_table AND status = 'open' AND restaurant_id = v_rid
    ORDER BY last_activity_at DESC LIMIT 1;
  IF v_s.id IS NULL THEN
    INSERT INTO sessions(table_number, status, opened_by, opened_at, restaurant_id)
      VALUES (p_table, 'open', 'waiter', NOW(), v_rid)
      RETURNING * INTO v_s;
  END IF;

  -- Straight to 'served': bill-only, so the kitchen lanes (new/cooking/ready), the
  -- chime, and the KOT auto-print (all keyed on 'received') never see it.
  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id, member_id, restaurant_id)
    VALUES (p_table, v_items, v_sub, v_tax, v_total, '{}', 'served', v_s.id, NULL, v_rid)
    RETURNING id, kot_no INTO v_order, v_kot;

  FOR v_in IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note, status, restaurant_id)
      VALUES (v_order, v_s.id, v_in->>'title', (v_in->>'qty')::int, (v_in->>'price')::numeric,
              NULL, '{}', NULL, 'served', v_rid);
  END LOOP;

  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'order_id', v_order, 'kot_no', v_kot,
                           'subtotal', v_sub, 'tax', v_tax, 'total', v_total);
END; $$;

-- Staff-only function (the mig-038 rule: new functions are PUBLIC-executable by default).
REVOKE EXECUTE ON FUNCTION lfh_banquet_place_order(text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_banquet_place_order(text, jsonb, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
