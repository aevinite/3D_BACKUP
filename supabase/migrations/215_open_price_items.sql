-- 215_open_price_items.sql
-- "Open price" dishes — the price is entered by staff AT ORDER TIME (e.g. "Soft Drinks Can",
-- "Mineral Water" priced as-per-MRP, or any market-price item). Two additive parts:
--   1. menu_items.open_price boolean (default false) — the per-dish flag.
--   2. lfh_price_order() honours the CLIENT-supplied line price ONLY for a dish flagged
--      open_price (clamped to a sane range); every normal dish still gets its price from the
--      DB, ignoring whatever the device sends (server-authoritative pricing, unchanged).
--
-- Safe: additive column + a CREATE OR REPLACE of ONE STABLE calculator. Same args, same
-- GRANTs, every caller (guest/tablet place-order + add-item) keeps working. Baseline of the
-- function body = migration 203 (the current definition); only the per-line pricing gains an
-- `IF v_mi.open_price` branch. Correct at any migration number ≥ 214; idempotent to re-run.

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS open_price boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION lfh_price_order(
  p_items jsonb,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_rid   uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_in    jsonb;             -- one incoming line
  v_mi    menu_items;        -- the real dish from the DB
  v_qty   int;
  v_base  numeric;           -- dish base price (from the DB)
  v_add   numeric;           -- add-on price from chosen options (from the DB)
  v_opts  jsonb;             -- rebuilt options list (server label + price)
  v_unit  numeric;           -- confident per-unit price
  v_items jsonb := '[]'::jsonb;
  v_sub   numeric := 0;
  v_tax   numeric;
  v_total numeric;
  v_rate  numeric := 0.05;   -- 5% tax — server-side mirror of TAX_RATE in CartPanel.tsx
BEGIN
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

    IF v_mi.open_price THEN
      -- OPEN-PRICE dish: the staff typed the price at order time. Trust the incoming line
      -- price, but strip non-numerics and clamp to [0, 100000] so a fat-finger can't ring up
      -- a wild amount. No DB base, no add-on options for these items.
      v_unit := round(GREATEST(0, LEAST(100000,
        COALESCE(NULLIF(regexp_replace(COALESCE(v_in->>'price',''), '[^0-9.]', '', 'g'), '')::numeric, 0))), 2);
      -- A price is REQUIRED for an open-price line — never let one ring up as ₹0.
      IF v_unit <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'price_required', 'item', v_mi.title);
      END IF;
      v_opts := '[]'::jsonb;
    ELSE
      -- Base price comes from the DB (text like "2.99"); strip anything non-numeric.
      v_base := COALESCE(NULLIF(regexp_replace(v_mi.price, '[^0-9.]', '', 'g'), '')::numeric, 0);

      -- Add-ons: ONLY options that truly exist on this dish count, at the DB's price.
      -- Each of the three sources is guarded to '[]' unless it is genuinely an array, so a
      -- malformed (scalar/object) `options` on the incoming line — or an unexpected dish/group
      -- shape — degrades to "no add-ons" instead of throwing "cannot extract elements ...".
      SELECT
        COALESCE(SUM((ch->>'price')::numeric), 0),
        COALESCE(jsonb_agg(jsonb_build_object(
          'group', grp->>'name', 'label', ch->>'label', 'price', (ch->>'price')::numeric)), '[]'::jsonb)
        INTO v_add, v_opts
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_in->'options') = 'array' THEN v_in->'options' ELSE '[]'::jsonb END) opt
      JOIN jsonb_array_elements(CASE WHEN jsonb_typeof(v_mi.options) = 'array' THEN v_mi.options ELSE '[]'::jsonb END) grp
        ON grp->>'name' = opt->>'group'
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(grp->'choices') = 'array' THEN grp->'choices' ELSE '[]'::jsonb END) ch
      WHERE ch->>'label' = opt->>'label';

      v_unit := lfh_nice_usd(v_base) + COALESCE(v_add, 0);
    END IF;

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

NOTIFY pgrst, 'reload schema';
