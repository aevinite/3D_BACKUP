-- 031_align_addon_pricing.sql — make the server price add-ons EXACTLY like the
-- client so the bill the guest sees and the total the kitchen charges agree.
--
-- Before: v_unit = lfh_nice_usd(base + add-ons) — "prettifying" the SUM could
-- bump it (6.50 + 1.25 = 7.75 -> 7.99) while the client shows pretty(base) +
-- add-ons at face value (7.75). Now both sides do: nice base + raw add-ons.
-- Add-on prices are charged exactly as the owner listed them.
--
-- Also grants EXECUTE on lfh_price_order to anon: it's a STABLE (read-only)
-- pricing calculator over public menu data, and exposing it lets an automated
-- test compare client math vs server math without creating junk orders.

CREATE OR REPLACE FUNCTION lfh_price_order(p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
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
    -- Look up the real dish. An unknown id can't be priced -> refuse the order.
    SELECT * INTO v_mi FROM menu_items WHERE id = v_in->>'id';
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
    -- We also rebuild the chosen-options list from those matched DB entries, so a
    -- tampered or invented option can neither appear on the ticket nor change money.
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

    -- One unit = confident-rounded BASE plus add-ons at face value — the exact
    -- mirror of the client's prettyUsd(base) + add-ons (lib/format.ts), so the
    -- popup, the bill and the kitchen all agree to the cent.
    v_unit := lfh_nice_usd(v_base) + COALESCE(v_add, 0);
    v_sub  := v_sub + (v_unit * v_qty);

    -- Append the server-built line (server title + server price).
    v_items := v_items || jsonb_build_object(
      'id',      v_mi.id,
      'title',   v_mi.title,
      'price',   to_char(v_unit, 'FM999999990.00'),  -- string, like the old client shape
      'qty',     v_qty,
      'options', CASE WHEN v_opts = '[]'::jsonb THEN NULL ELSE v_opts END,
      -- ALWAYS an array (never JSON null) — downstream lfh_place_order runs
      -- jsonb_array_elements_text() over this, which errors on a scalar null.
      'removed', CASE WHEN jsonb_typeof(v_in->'removed') = 'array' THEN v_in->'removed' ELSE '[]'::jsonb END,
      'note',    v_in->>'note'
    );
  END LOOP;

  v_tax   := round(v_sub * v_rate, 2);
  v_total := v_sub + v_tax;
  RETURN jsonb_build_object('ok', true, 'items', v_items,
                            'subtotal', v_sub, 'tax', v_tax, 'total', v_total);
END; $$;

-- Read-only pricing calculator over public menu data — safe for anon, and it
-- lets tests/order-totals.e2e.mjs verify client/server agreement end-to-end.
GRANT EXECUTE ON FUNCTION lfh_price_order(jsonb) TO anon, authenticated;
