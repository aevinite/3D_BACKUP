-- 284_an_order_remembers_its_own_tax_rate.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- A BANQUET PRINTS 18% AND THE PAYMENT SHEET ASKS FOR THE 5% AMOUNT.
--
-- Migration 239 gave the banquet its own rate ("ONE restaurant, TWO rates") and exactly two things
-- ever learned about it: the RPC that issues the bill, and printBanquetBill. Everything else
-- re-derives the tax from the restaurant's DINE-IN settings — including billMath(), which is what
-- the Bills tab shows AND what the payment sheet asks the manager to collect. So a ₹100,000 banquet
-- printed a tax invoice for ₹118,000 and the payment sheet said ₹105,000: the restaurant is short
-- ₹13,000 on the single biggest sale it makes, and the day-close reports its tax as ₹5,000.
--
-- The same fault, in a second shape: every report re-derived tax from the rate configured RIGHT
-- NOW, so correcting the tax setup at 6pm made the 11pm day-close disagree with every bill already
-- handed to a guest, and editing a rate silently moved past months' figures.
--
-- THE FIX: the order remembers what it was charged. One column, one trigger, and the readers use it.
--
-- ⚠️ THIS MIGRATION ALSO REPAIRS A DRIFT I CAUSED. An earlier draft of this work was applied to the
-- dev/backup database and then the branch was rebuilt on a much-changed main WITHOUT those migration
-- files — so the database carried `orders.tax_rate`, a stamp trigger, `settings.tax_exempt` and a
-- rewritten lfh_banquet_bill_create that NO migration in the repo described. That is precisely the
-- "never let the two schemas fork" rule broken. Everything below is written to be safe to run on a
-- database that already has some of it (IF NOT EXISTS / CREATE OR REPLACE) and on one that has none
-- (AV live), so from here the repo is the single source of truth again.
--
-- ── why the rate cannot be read off `subtotal` any more ──────────────────────
-- Migrations 270/272 added `taxable_base`, `nontax_amount` and `mrp_amount`: a bill can now carry
-- untaxed MRP lines, or prices that already contain the tax. The tax is charged on the TAXABLE BASE,
-- not on the subtotal, so `tax / subtotal` is wrong the moment either is in play. The rate is
-- `tax / COALESCE(taxable_base, subtotal)` — correct for a plain bill (taxable_base is null → the
-- subtotal), for MRP (the taxed part only), for tax-inclusive (the extracted net), and for a
-- banquet (which writes a gross order row, mig 239 + the rewrite below).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS tax_rate numeric;

COMMENT ON COLUMN orders.tax_rate IS
  'The tax rate this order was ACTUALLY charged at, as a decimal (0.05 / 0.18 / 0 for composition). Stamped on insert from tax / COALESCE(taxable_base, subtotal). Reports read THIS instead of the restaurant''s current setting, so a later rate change cannot re-price a sale that already happened, and a banquet (its own rate, mig 239) is never re-taxed at the dine-in rate.';

-- ── 1. Stamp it on the way in ────────────────────────────────────────────────
-- Every insert path already writes the tax alongside its base, so the rate is derivable without any
-- caller changing — which is the point: a new insert path added later is covered without being told.
-- Only fills a NULL, so an importer that already knows its rate keeps it.
CREATE OR REPLACE FUNCTION lfh_stamp_order_tax_rate() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_base numeric;
BEGIN
  IF NEW.tax_rate IS NULL AND NEW.tax IS NOT NULL THEN
    -- The base the tax was charged ON — not the subtotal (see the header).
    v_base := COALESCE(NEW.taxable_base, NEW.subtotal);
    IF COALESCE(v_base, 0) > 0 THEN
      NEW.tax_rate := round(NEW.tax::numeric / v_base::numeric, 6);
    ELSIF NEW.tax = 0 THEN
      NEW.tax_rate := 0;          -- a composition / fully-MRP bill genuinely charged nothing
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION lfh_stamp_order_tax_rate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stamp_order_tax_rate ON orders;
CREATE TRIGGER trg_stamp_order_tax_rate BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION lfh_stamp_order_tax_rate();

-- ── 2. The banquet writes a GROSS order row, like every other sale ───────────
-- mig 148 states the invariant: "orders.total is the GROSS, tax-inclusive figure and NEVER includes
-- the discount." Dine-in obeys it; the banquet wrote `v_sub - v_disc + v_tax` with the discount
-- already inside while ALSO storing it in orders.discount — so the owner reports subtracted it
-- twice (a ₹100,000 banquet with ₹10,000 off reported ₹95,700 against a true ₹106,200).
--
-- ONLY the orders INSERT changes. v_tax / v_total stay exactly as mig 239 computes them — they are
-- the BANQUET BILL's own figures (tax on the discounted base, total net of it) and they are what
-- prints; rewriting those would change the document itself.
DO $mig$
DECLARE v_src text; v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'lfh_banquet_bill_create';
  IF v_n = 0 THEN
    RAISE NOTICE 'lfh_banquet_bill_create not found — banquet module not installed here, skipping';
    RETURN;
  END IF;
  IF v_n > 1 THEN
    RAISE EXCEPTION 'mig 284: % overloads of lfh_banquet_bill_create — refusing to guess which writes the order row', v_n;
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'lfh_banquet_bill_create';

  -- Already rewritten (the drift described in the header) → nothing to do, and say so.
  IF position('v_sub + round(v_sub * v_rate, 2)' in v_src) > 0 THEN
    RAISE NOTICE 'mig 284: the banquet order row already writes a gross total — leaving it';
    RETURN;
  END IF;
  IF position('VALUES (v_table, v_items, v_sub, v_tax, v_total, v_disc,' in v_src) = 0 THEN
    RAISE EXCEPTION 'mig 284: the lfh_banquet_bill_create orders INSERT does not look as expected — refusing to rewrite the function blind. Update this migration by hand rather than shipping a silent no-op.';
  END IF;
  v_src := replace(v_src,
    'VALUES (v_table, v_items, v_sub, v_tax, v_total, v_disc,',
    'VALUES (v_table, v_items, v_sub, round(v_sub * v_rate, 2), v_sub + round(v_sub * v_rate, 2), v_disc,');
  EXECUTE v_src;
END $mig$;

-- ── 3. Drop the dead no-tax flag ─────────────────────────────────────────────
-- `settings.tax_exempt` was the drift's other half: it says the same thing as `price_tax_mode =
-- 'composition'` (mig 272), which is richer and is what every reader actually consults. Two ways to
-- express one setting is the drift this codebase keeps learning about, so the unread one goes.
-- Guarded: only dropped if nothing anywhere is relying on it being true.
DO $tx$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'settings' AND column_name = 'tax_exempt') THEN
    IF EXISTS (SELECT 1 FROM settings WHERE tax_exempt IS TRUE) THEN
      RAISE NOTICE 'mig 284: settings.tax_exempt is TRUE somewhere — leaving the column, set price_tax_mode=''composition'' on those restaurants first';
    ELSE
      ALTER TABLE settings DROP COLUMN tax_exempt;
      RAISE NOTICE 'mig 284: dropped the unread settings.tax_exempt (price_tax_mode covers it)';
    END IF;
  END IF;
END $tx$;

-- ── 4. Backfill what every existing order was charged ────────────────────────
-- Derived only — no money column is touched. Two cases, because a banquet issued BEFORE the rewrite
-- above computed its tax on the DISCOUNTED base while every other sale used the gross.
WITH bq AS (SELECT DISTINCT order_id FROM banquet_bills WHERE order_id IS NOT NULL)
UPDATE orders o SET tax_rate = round(
  o.tax::numeric / NULLIF(
    CASE WHEN EXISTS (SELECT 1 FROM bq WHERE bq.order_id = o.id)
         THEN COALESCE(o.taxable_base, o.subtotal)::numeric - COALESCE(o.discount, 0)::numeric
         ELSE COALESCE(o.taxable_base, o.subtotal)::numeric END, 0), 6)
WHERE o.tax_rate IS NULL AND o.tax IS NOT NULL
  AND COALESCE(o.taxable_base, o.subtotal) > 0;

-- A zero-tax order genuinely has a zero rate; the divide above skips it.
UPDATE orders SET tax_rate = 0 WHERE tax_rate IS NULL AND tax = 0;

-- Afterwards this should be 0 (only rows with no tax figure at all remain NULL):
--   select count(*) from orders where tax_rate is null and tax is not null
--     and coalesce(taxable_base, subtotal) > 0;

NOTIFY pgrst, 'reload schema';
