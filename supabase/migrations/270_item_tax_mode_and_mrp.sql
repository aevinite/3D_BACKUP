-- 270_item_tax_mode_and_mrp.sql
--
-- "The price I type for a dish — does it already include GST, or does GST get added on top?"
-- plus "an MRP item (a sealed water bottle) is a FINAL price: nothing may ever be added to it."
-- Owner, 2026-08-04. Aangan's water is the case that forced it: adding 5% on top of a ₹20
-- bottle charges ₹21, which is above MRP, and selling above MRP is a legal-metrology offence.
--
-- ── THE MODEL ────────────────────────────────────────────────────────────────────────────
-- Every dish line resolves, AT ORDER TIME, to exactly one of three BEHAVIOURS:
--   'excl'   — the price is net; GST is added on top.            (today's behaviour, the default)
--   'incl'   — the price already contains GST; it is pulled OUT. (net = price / (1 + rate))
--   'exempt' — no GST at all; the price is final and untouched.  (MRP items, nil-rated goods)
-- The behaviour is FROZEN onto the order line. Flipping a switch tomorrow must never change
-- what a guest was billed yesterday — the same principle as the banquet bill's frozen tax_lines.
--
-- ── WHY EXISTING READERS DO NOT NEED CHANGING (the load-bearing bit) ──────────────────────
-- An order now carries the split:  subtotal = taxable_base + nontax_amount.
-- With the discount capped at taxable_base, the rule the whole app already uses —
--     due = total − discount × (1 + rate)
-- stays EXACTLY correct:
--     total − disc×(1+rate) = (taxable_base − disc)×(1+rate) + nontax_amount
-- so lfh_table_view_summary, lfh_floor_state, lfh_session_state, every owner analytics
-- function, khata and lib/sessionClose.ts keep working untouched. That is deliberate: this
-- migration adds a split without reopening forty money call sites.
--
-- ── WHY TRIGGERS AND NOT A REWRITE OF EVERY PLACE-ORDER FUNCTION ──────────────────────────
-- Five functions insert orders (lfh_place_order, _public, lfh_staff_place_order, the add-item
-- path, the move-order path). Re-issuing five long bodies is exactly how an earlier fix gets
-- silently reverted here (mig 203/215 dropped the per-restaurant tax rate that mig 119 added —
-- see the regression fixed below). So the split is computed by a trigger on `orders`, the way
-- mig 232 put session cleanup on the status change itself: every path is covered, including
-- ones written after today, and no existing function body is re-issued.
--
-- ADDITIVE AND OFF: every restaurant lands on `item_tax_modes_allowed = false`, which forces
-- every line to the restaurant's own price mode and ignores per-dish settings entirely. With
-- the defaults below (price_tax_mode='excl'), this migration changes NO existing number
-- anywhere. Owner, 2026-08-04: "off this for all restaurant for now, only admin can adjust."

-- ── 1. THE COLUMNS ───────────────────────────────────────────────────────────────────────

-- The per-dish choice the menu editor writes. 'default' = follow the restaurant.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS tax_mode text NOT NULL DEFAULT 'default';
DO $$ BEGIN
  ALTER TABLE menu_items ADD CONSTRAINT menu_items_tax_mode_chk
    CHECK (tax_mode IN ('default','excl','incl','mrp','none'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The RESOLVED behaviour, frozen onto the sold line. NULL = ordered before this migration
-- = 'excl' (all of it was taxable), which is what those bills actually charged.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tax_mode text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS is_mrp boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT order_items_tax_mode_chk
    CHECK (tax_mode IS NULL OR tax_mode IN ('excl','incl','exempt'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The order's split. Deliberately NULLABLE with NO backfill: NULL means "legacy — all of
-- subtotal was taxable", which every reader below treats correctly via COALESCE. A backfill
-- UPDATE across ~400k orders on a shared-CPU free tier is a statement-timeout waiting to
-- happen, and it would buy nothing.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS taxable_base  numeric;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS nontax_amount numeric;

-- The restaurant-wide setting. NOTE: settings.tax_inclusive (mig 037, "menu prices include
-- tax?") was added as a backend stub in 2026 and never wired to anything. It is left in place
-- (additive-only rule) but it is DEAD — price_tax_mode is the real one, because the third
-- state (composition scheme) cannot be expressed as a boolean.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS price_tax_mode text NOT NULL DEFAULT 'excl';
DO $$ BEGIN
  ALTER TABLE settings ADD CONSTRAINT settings_price_tax_mode_chk
    CHECK (price_tax_mode IN ('excl','incl','composition'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The master switch. FALSE = per-dish modes are ignored entirely (the state every restaurant
-- starts in). Admin-only; there is no owner or manager control for it.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS item_tax_modes_allowed boolean NOT NULL DEFAULT false;

-- How an MRP line is treated underneath. Both answers give the guest the SAME price (never a
-- rupee above MRP); they differ only in what the restaurant declares as output tax.
--   'none'      — no GST recorded on the line at all.  (owner's choice for now)
--   'inclusive' — the GST is pulled out of the MRP and declared. (the legally clean one)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS mrp_tax_treatment text NOT NULL DEFAULT 'none';
DO $$ BEGIN
  ALTER TABLE settings ADD CONSTRAINT settings_mrp_tax_treatment_chk
    CHECK (mrp_tax_treatment IN ('none','inclusive'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. THE RESOLVER — one rule, mirrored by lib/tax.ts and the panels ─────────────────────
-- Turns a dish's stored choice into the behaviour a line actually gets, for this restaurant,
-- right now. A restaurant with no settings row behaves exactly as it does today.
CREATE OR REPLACE FUNCTION lfh_resolve_tax_mode(p_dish_mode text, p_restaurant_id uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT CASE
      -- A composition-scheme restaurant may not pass GST to the diner at all, so nothing on
      -- its bill is taxable and no tax line is printed (docs/COMPLIANCE-GUARDRAILS.md §3).
      WHEN s.price_tax_mode = 'composition' THEN 'exempt'
      -- Master switch off → every dish follows the restaurant, whatever the dish says.
      WHEN NOT COALESCE(s.item_tax_modes_allowed, false)
        THEN CASE WHEN s.price_tax_mode = 'incl' THEN 'incl' ELSE 'excl' END
      WHEN COALESCE(p_dish_mode, 'default') = 'excl' THEN 'excl'
      WHEN COALESCE(p_dish_mode, 'default') = 'incl' THEN 'incl'
      WHEN COALESCE(p_dish_mode, 'default') = 'none' THEN 'exempt'
      WHEN COALESCE(p_dish_mode, 'default') = 'mrp'
        THEN CASE WHEN s.mrp_tax_treatment = 'inclusive' THEN 'incl' ELSE 'exempt' END
      ELSE CASE WHEN s.price_tax_mode = 'incl' THEN 'incl' ELSE 'excl' END
    END
    FROM settings s WHERE s.restaurant_id = p_restaurant_id
  ), 'excl');
$$;

-- ── 3. THE SPLIT — the only place the three behaviours turn into money ────────────────────
-- Reads a priced items array (the shape lfh_price_order returns and orders.items stores) and
-- returns { taxable_base, nontax_amount, rate }. Rounding is PER LINE, not per unit: a bill's
-- lines are what a person checks against the paper.
CREATE OR REPLACE FUNCTION lfh_split_items_tax(p_items jsonb, p_restaurant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_rate   numeric := lfh_effective_tax_rate(p_restaurant_id);
  v_ln     jsonb;
  v_amt    numeric;
  v_mode   text;
  v_base   numeric := 0;
  v_nontax numeric := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RETURN NULL; END IF;

  FOR v_ln IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_amt := round(
      COALESCE(NULLIF(regexp_replace(COALESCE(v_ln->>'price', ''), '[^0-9.]', '', 'g'), '')::numeric, 0)
      * GREATEST(1, COALESCE(NULLIF(v_ln->>'qty', '')::int, 1)), 2);
    -- A line with no mode is a line priced before this feature existed: fully taxable.
    v_mode := COALESCE(v_ln->>'tax_mode', 'excl');
    IF v_mode = 'exempt' THEN
      v_nontax := v_nontax + v_amt;
    ELSIF v_mode = 'incl' THEN
      v_base := v_base + round(v_amt / (1 + v_rate), 2);
    ELSE
      v_base := v_base + v_amt;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('taxable_base', v_base, 'nontax_amount', v_nontax, 'rate', v_rate);
END; $$;

-- ── 4. lfh_price_order — the split at source, AND a real regression fixed ─────────────────
-- Baseline = migration 215. Two changes:
--   (a) THE BUG: 215 (inherited from 203) declares `v_rate numeric := 0.05` and never calls
--       lfh_effective_tax_rate. Migration 119 added that call precisely so a restaurant's own
--       rate is used; 203 dropped it. Since then EVERY new order has been priced at a flat 5%
--       while every reporting function read the restaurant's configured rate — so a restaurant
--       on any other rate has been billing one number and reporting another. Restored here.
--   (b) each line now carries its resolved tax_mode + an is_mrp flag, and the totals use the
--       taxable/non-taxable split.
CREATE OR REPLACE FUNCTION lfh_price_order(
  p_items jsonb,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_rid    uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_in     jsonb;
  v_mi     menu_items;
  v_qty    int;
  v_base   numeric;
  v_add    numeric;
  v_opts   jsonb;
  v_unit   numeric;
  v_items  jsonb := '[]'::jsonb;
  v_sub    numeric := 0;
  v_tax    numeric;
  v_total  numeric;
  v_rate   numeric;
  v_mode   text;
  v_mrp    boolean;
  v_amt    numeric;
  v_taxbase numeric := 0;
  v_nontax  numeric := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_order');
  END IF;

  -- (119) the restaurant's OWN rate, never a hardcoded 5%.
  v_rate := lfh_effective_tax_rate(v_rid);

  FOR v_in IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_mi FROM menu_items
      WHERE id = v_in->>'id' AND restaurant_id = v_rid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'unknown_item', 'item', v_in->>'id');
    END IF;

    IF 'sold-out' = ANY(v_mi.tags) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'sold_out', 'item', v_mi.title);
    END IF;

    v_qty := GREATEST(1, LEAST(99, COALESCE(NULLIF(v_in->>'qty', '')::int, 1)));

    IF v_mi.open_price THEN
      v_unit := round(GREATEST(0, LEAST(100000,
        COALESCE(NULLIF(regexp_replace(COALESCE(v_in->>'price',''), '[^0-9.]', '', 'g'), '')::numeric, 0))), 2);
      IF v_unit <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'price_required', 'item', v_mi.title);
      END IF;
      v_opts := '[]'::jsonb;
    ELSE
      v_base := COALESCE(NULLIF(regexp_replace(v_mi.price, '[^0-9.]', '', 'g'), '')::numeric, 0);

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

    -- Resolve the behaviour ONCE, here, and freeze it onto the line.
    v_mode := lfh_resolve_tax_mode(v_mi.tax_mode, v_rid);
    v_mrp  := (COALESCE(v_mi.tax_mode, 'default') = 'mrp')
              AND COALESCE((SELECT item_tax_modes_allowed FROM settings WHERE restaurant_id = v_rid), false);

    v_amt := round(v_unit * v_qty, 2);
    v_sub := v_sub + v_amt;
    IF v_mode = 'exempt' THEN
      v_nontax := v_nontax + v_amt;
    ELSIF v_mode = 'incl' THEN
      v_taxbase := v_taxbase + round(v_amt / (1 + v_rate), 2);
    ELSE
      v_taxbase := v_taxbase + v_amt;
    END IF;

    v_items := v_items || jsonb_build_object(
      'id',       v_mi.id,
      'title',    v_mi.title,
      'price',    to_char(v_unit, 'FM999999990.00'),
      'qty',      v_qty,
      'options',  CASE WHEN v_opts = '[]'::jsonb THEN NULL ELSE v_opts END,
      'removed',  CASE WHEN jsonb_typeof(v_in->'removed') = 'array' THEN v_in->'removed' ELSE '[]'::jsonb END,
      'note',     v_in->>'note',
      'tax_mode', v_mode,
      'is_mrp',   v_mrp
    );
  END LOOP;

  -- subtotal is the taxable NET plus the untaxed lines, so `subtotal + tax = total` still
  -- holds and a tax-inclusive price still totals to exactly the price on the menu.
  v_sub   := round(v_taxbase + v_nontax, 2);
  v_tax   := round(v_taxbase * v_rate, 2);
  v_total := round(v_sub + v_tax, 2);

  RETURN jsonb_build_object('ok', true, 'items', v_items,
                            'subtotal', v_sub, 'tax', v_tax, 'total', v_total,
                            'taxable_base', v_taxbase, 'nontax_amount', v_nontax);
END; $$;

GRANT EXECUTE ON FUNCTION lfh_price_order(jsonb, uuid) TO anon, authenticated;

-- ── 5. THE TRIGGERS — every write path, including ones written later ──────────────────────

-- (a) orders: fill the split from the priced ticket. BEFORE INSERT only — the two functions
--     that UPDATE money (lfh_reprice_order, lfh_delete_order_item) set the split themselves
--     below, and a trigger fighting them over the same row is how a total starts flickering.
CREATE OR REPLACE FUNCTION lfh_orders_fill_tax_split()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_split jsonb;
BEGIN
  IF NEW.taxable_base IS NOT NULL THEN RETURN NEW; END IF;   -- caller was explicit; respect it
  v_split := lfh_split_items_tax(NEW.items, NEW.restaurant_id);
  IF v_split IS NULL THEN RETURN NEW; END IF;

  NEW.taxable_base  := (v_split->>'taxable_base')::numeric;
  NEW.nontax_amount := (v_split->>'nontax_amount')::numeric;

  -- The plain all-taxable case (every restaurant today) lands here with taxable_base exactly
  -- equal to subtotal and nothing untaxed — so the money is left ALONE, byte for byte.
  IF NEW.nontax_amount > 0 OR NEW.taxable_base <> COALESCE(NEW.subtotal, 0) THEN
    NEW.subtotal := round(NEW.taxable_base + NEW.nontax_amount, 2);
    NEW.tax      := round(NEW.taxable_base * (v_split->>'rate')::numeric, 2);
    NEW.total    := round(NEW.subtotal + NEW.tax, 2);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_orders_fill_tax_split ON orders;
CREATE TRIGGER trg_orders_fill_tax_split
  BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION lfh_orders_fill_tax_split();

-- (b) order_items: carry the mode down from the ticket that created the line. order_items has
--     no menu_item_id, so the mode is matched by TITLE within this one order — safe, because
--     two lines with the same title in the same order necessarily came from the same dish.
CREATE OR REPLACE FUNCTION lfh_order_items_fill_tax_mode()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_ln jsonb;
BEGIN
  IF NEW.tax_mode IS NOT NULL THEN RETURN NEW; END IF;
  SELECT ln INTO v_ln
    FROM orders o, jsonb_array_elements(
           CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) ln
   WHERE o.id = NEW.order_id AND ln->>'title' = NEW.title
   LIMIT 1;
  NEW.tax_mode := COALESCE(v_ln->>'tax_mode', 'excl');
  NEW.is_mrp   := COALESCE((v_ln->>'is_mrp')::boolean, false);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_order_items_fill_tax_mode ON order_items;
CREATE TRIGGER trg_order_items_fill_tax_mode
  BEFORE INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION lfh_order_items_fill_tax_mode();

-- ── 6. THE TWO FUNCTIONS THAT REBUILD MONEY FROM order_items ─────────────────────────────
-- Both rebuilt an order's money as `SUM(unit_price*qty)` × (1+rate). That is only right when
-- every line is taxable, so both now rebuild the SPLIT instead. Bodies are otherwise migration
-- 119's, unchanged.

CREATE OR REPLACE FUNCTION lfh_reprice_order(p_order uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub   numeric := 0;
  v_base  numeric := 0;
  v_nontax numeric := 0;
  v_tax   numeric;
  v_rate  numeric := 0.05;
  v_rid   uuid;
  v_total_n int; v_served_n int; v_active boolean;
  v_status text;
BEGIN
  SELECT restaurant_id INTO v_rid FROM orders WHERE id = p_order;
  v_rate := lfh_effective_tax_rate(v_rid);   -- (119) per-restaurant tax, not a flat 5%

  SELECT
    COALESCE(SUM(CASE WHEN COALESCE(tax_mode,'excl') = 'exempt' THEN 0
                      WHEN COALESCE(tax_mode,'excl') = 'incl'
                        THEN round(unit_price * qty / (1 + v_rate), 2)
                      ELSE round(unit_price * qty, 2) END), 0),
    COALESCE(SUM(CASE WHEN COALESCE(tax_mode,'excl') = 'exempt'
                        THEN round(unit_price * qty, 2) ELSE 0 END), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'served'),
    COALESCE(bool_or(status IN ('preparing', 'ready', 'served')), false)
    INTO v_base, v_nontax, v_total_n, v_served_n, v_active
    FROM order_items WHERE order_id = p_order;

  v_sub := round(v_base + v_nontax, 2);
  v_tax := round(v_base * v_rate, 2);

  v_status := CASE
    WHEN v_total_n > 0 AND v_served_n = v_total_n THEN 'served'
    WHEN v_active THEN 'preparing'
    ELSE 'received' END;

  UPDATE orders
     SET subtotal      = v_sub,
         tax           = v_tax,
         total         = round(v_sub + v_tax, 2),
         taxable_base  = v_base,
         nontax_amount = v_nontax,
         status        = CASE WHEN status = 'cancelled' THEN status ELSE v_status END
   WHERE id = p_order;

  PERFORM lfh_sync_order_items_json(p_order); -- rebuild the KOT ticket from order_items
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

  SELECT
    COALESCE(SUM(CASE WHEN COALESCE(tax_mode,'excl') = 'exempt' THEN 0
                      WHEN COALESCE(tax_mode,'excl') = 'incl'
                        THEN round(unit_price * qty / (1 + v_rate), 2)
                      ELSE round(unit_price * qty, 2) END), 0),
    COALESCE(SUM(CASE WHEN COALESCE(tax_mode,'excl') = 'exempt'
                        THEN round(unit_price * qty, 2) ELSE 0 END), 0),
    COUNT(*)
    INTO v_base, v_nontax, v_left
    FROM order_items WHERE order_id = v_order.id;

  -- No dishes left → cancel the order so no empty ₹0 line lingers on the bill.
  IF v_left = 0 THEN
    UPDATE orders
       SET status = 'cancelled', subtotal = 0, tax = 0, total = 0,
           taxable_base = 0, nontax_amount = 0, items = '[]'::jsonb
     WHERE id = v_order.id;
    RETURN jsonb_build_object('ok', true, 'order_id', v_order.id,
                              'order_cancelled', true, 'items_left', 0, 'total', 0);
  END IF;

  v_sub   := round(v_base + v_nontax, 2);
  v_tax   := round(v_base * v_rate, 2);
  v_total := round(v_sub + v_tax, 2);
  UPDATE orders SET subtotal = v_sub, tax = v_tax, total = v_total,
                    taxable_base = v_base, nontax_amount = v_nontax
   WHERE id = v_order.id;
  PERFORM lfh_sync_order_items_json(v_order.id); -- rebuild ticket from the SURVIVORS

  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id,
                            'order_cancelled', false, 'items_left', v_left, 'total', v_total);
END; $$;

-- ── 7. THE DISCOUNT MAY NEVER EAT A LOCKED MRP LINE ──────────────────────────────────────
-- A whole-bill discount is a PRE-TAX rupee amount spread over orders.subtotal. With untaxed
-- MRP lines in the bill, the cap has to be the TAXABLE base, or a discount would silently
-- reduce a price that is legally final — and the `due = total − discount×(1+rate)` identity
-- every panel relies on would stop holding.
CREATE OR REPLACE FUNCTION lfh_order_discount_base(p_order uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(taxable_base, subtotal, 0) FROM orders WHERE id = p_order;
$$;

-- Staff-only helpers stay staff-only (mig 038's rule: a new function is PUBLIC-executable by
-- default, so every one of these has to be shut and re-granted deliberately).
REVOKE ALL ON FUNCTION lfh_resolve_tax_mode(text, uuid)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_split_items_tax(jsonb, uuid)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_order_discount_base(uuid)       FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_resolve_tax_mode(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION lfh_split_items_tax(jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION lfh_order_discount_base(uuid)    TO service_role;
-- lfh_price_order is called BY the guest place-order path, so it keeps its existing grants
-- (re-granted above). lfh_resolve_tax_mode is called from inside it, and lfh_price_order is
-- STABLE/INVOKER — so anon must be able to read `settings` and `menu_items`, which it already
-- can (both have public read policies). Nothing new is exposed.

NOTIFY pgrst, 'reload schema';
