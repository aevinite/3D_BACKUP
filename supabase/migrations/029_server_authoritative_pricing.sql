-- BULLETPROOF ORDERING — the server is the SINGLE source of truth for money.
--
-- The browser may send ONLY: item id + quantity + chosen options + removed
-- allergens + a note. It may NOT decide any price. The functions below look up
-- every price from `menu_items`, recompute the whole bill, REJECT sold-out and
-- unknown dishes, and rebuild the ticket so no tampered price or fake option can
-- ride along. Any subtotal/tax/total the client tries to send is ignored.
--
-- We ALSO drop the wide-open public INSERT policy on `orders`, so the browser can
-- no longer write an order row directly (it used to allow ANY values, e.g. a $0
-- total). After this, the ONLY way an order is created is through these
-- SECURITY DEFINER functions, which always price it themselves.

-- ── 1) The "confident price" rounding ───────────────────────────────────────
-- EXACT mirror of niceRound()/prettyUsd() in lib/format.ts (the USD branch).
-- The guest's screen rounds each price to a confident value (e.g. 4.29 -> 4.50,
-- 2.99 stays 2.99). The kitchen total must land on the SAME number, so we
-- reproduce the rule here.
--   IMPORTANT: if you ever change the rounding in lib/format.ts, change it here
--   too, or the server total will stop matching what the guest saw.
CREATE OR REPLACE FUNCTION lfh_nice_usd(v numeric)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE w numeric; f numeric;
BEGIN
  IF v IS NULL OR v <= 0 THEN RETURN 0; END IF;
  w := floor(v);          -- the whole-dollar part
  f := v - w;             -- the leftover cents
  IF f >= 0.92 THEN RETURN w + 0.99; END IF;  -- already near .99  -> .99
  IF f <  0.25 THEN RETURN w;        END IF;  -- tiny cents        -> whole
  IF f <  0.75 THEN RETURN w + 0.50; END IF;  -- middling          -> .50
  RETURN w + 0.99;                            -- high              -> .99
END; $$;

-- ── 2) Price a whole order from scratch ─────────────────────────────────────
-- Input  : a JSON array of lines, each { id, qty, options:[{group,label}], removed, note }.
-- Output : { ok, reason?, item?, items, subtotal, tax, total }.
--   ok=false with reason 'empty_order' | 'unknown_item' | 'sold_out'.
-- The returned `items` array is the SERVER's rebuilt ticket: server title, server
-- per-unit price, and only options that truly exist on the dish (at the DB price).
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

    -- One unit = confident-rounded (base + add-ons); line cost = unit * qty.
    v_unit := lfh_nice_usd(v_base + COALESCE(v_add, 0));
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

-- ── 3) Place a SESSION order (v2 dining sessions) ───────────────────────────
-- Same access checks as before (token, open session, approved, not blocked, OTP),
-- but the money is now computed by lfh_price_order. The browser sends only the
-- item lines + allergies (the new 3-argument signature below).
CREATE OR REPLACE FUNCTION lfh_place_order(p_token text, p_items jsonb, p_allergies text[])
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_s sessions; v_order uuid; v_item jsonb; v_req_otp boolean; v_priced jsonb;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF NOT v_m.approved THEN RETURN json_build_object('ok', false, 'reason', 'not_approved'); END IF;
  IF lfh_is_blocked(v_m.phone, v_s.table_number) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT require_otp INTO v_req_otp FROM settings WHERE id = 'site';
  IF COALESCE(v_req_otp, true) AND NOT v_m.phone_verified THEN
    RETURN json_build_object('ok', false, 'reason', 'otp_required');
  END IF;

  -- SERVER prices the order. If a line is unknown/sold-out, bail with that reason.
  v_priced := lfh_price_order(p_items);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id, member_id)
    VALUES (v_s.table_number, v_priced->'items',
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), 'received', v_s.id, v_m.id)
    RETURNING id INTO v_order;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_priced->'items') LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note)
      VALUES (v_order, v_s.id,
        COALESCE(v_item->>'title', ''),
        COALESCE((v_item->>'qty')::int, 1),
        COALESCE((v_item->>'price')::numeric, 0),
        v_item->'options',
        CASE WHEN jsonb_typeof(v_item->'removed') = 'array'
             THEN COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(v_item->'removed') x), '{}')
             ELSE '{}' END,
        v_item->>'note');
  END LOOP;

  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'order_id', v_order);
END; $$;
GRANT EXECUTE ON FUNCTION lfh_place_order(text, jsonb, text[]) TO anon;

-- Backward-compatibility wrapper: an older (not-yet-redeployed) client may still
-- call the previous 6-argument version with its own subtotal/tax/total. We IGNORE
-- that money entirely and delegate to the server-priced version above, so a stale
-- client keeps working AND still can't set its own prices. Safe to remove once the
-- menu app is fully redeployed.
CREATE OR REPLACE FUNCTION lfh_place_order(p_token text, p_items jsonb, p_subtotal numeric, p_tax numeric, p_total numeric, p_allergies text[])
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN lfh_place_order(p_token, p_items, p_allergies);
END; $$;
GRANT EXECUTE ON FUNCTION lfh_place_order(text, jsonb, numeric, numeric, numeric, text[]) TO anon;

-- ── 4) Place a NON-SESSION order (the older direct path, now server-priced) ──
-- Used when dining sessions are off. Replaces the old client-side direct INSERT.
-- Still server-priced, still rejects sold-out/unknown items.
CREATE OR REPLACE FUNCTION lfh_place_order_public(p_table text, p_items jsonb, p_allergies text[])
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order uuid; v_priced jsonb;
BEGIN
  v_priced := lfh_price_order(p_items);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;
  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status)
    VALUES (NULLIF(p_table, ''), v_priced->'items',
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), 'received')
    RETURNING id INTO v_order;
  RETURN json_build_object('ok', true, 'order_id', v_order);
END; $$;
GRANT EXECUTE ON FUNCTION lfh_place_order_public(text, jsonb, text[]) TO anon;

-- ── 5) Slam the open door ────────────────────────────────────────────────────
-- Remove the policy that let the anon (public) key INSERT any order row directly.
-- The SECURITY DEFINER functions above bypass RLS, so legitimate orders still work;
-- a hand-crafted direct insert from the browser now fails.
DROP POLICY IF EXISTS "public_insert_orders" ON orders;

-- Tell PostgREST to pick up the new function signatures.
NOTIFY pgrst, 'reload schema';
