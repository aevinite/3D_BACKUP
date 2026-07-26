-- 203_price_order_options_type_guard.sql
-- Fix: a tablet/guest "place order" whose line carried an `options` value that was NOT a
-- json array (a scalar string/number, or an object) crashed the whole order with the raw
-- Postgres error "cannot extract elements from a scalar" (a 500 to the waiter; logged 6× on
-- the tablet the morning of 2026-07-26). Root cause: lfh_price_order's add-on lookup did
--   FROM jsonb_array_elements(COALESCE(v_in->'options', '[]'::jsonb)) opt
--   JOIN jsonb_array_elements(COALESCE(v_mi.options,  '[]'::jsonb)) grp
--   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(grp->'choices', '[]'::jsonb)) ch
-- where COALESCE only rescues a NULL — a present-but-wrong-typed value (scalar/object) still
-- reaches jsonb_array_elements, which throws. The three other extraction sites in the staff/
-- guest order RPCs already guard with `jsonb_typeof(...) = 'array'`; this one did not.
--
-- The server must never trust the client's line shape. A non-array `options` means "no valid
-- add-ons on this line" — price the dish plainly, don't crash the order. Same for the DB-side
-- `v_mi.options` / group `choices` (all arrays today, but the guard is cheap defence-in-depth).
--
-- ⚠ MIGRATION NUMBER: next free after the two 202_* files. Purely a CREATE OR REPLACE of one
--   STABLE calculator function — no schema change, correct at any number, idempotent to re-run.
-- Baseline = migration 118 (the current definition); only the three COALESCE(...) wrappers in
-- the add-on subquery gain a jsonb_typeof array-guard. Nothing else changes (same args, same
-- pricing, same GRANTs), so every caller (guest/tablet/add-item, and mig 202's place-order
-- which calls this) keeps working unchanged.

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

-- Same exposure as before: a read-only calculator over public menu data.
GRANT EXECUTE ON FUNCTION lfh_price_order(jsonb, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
