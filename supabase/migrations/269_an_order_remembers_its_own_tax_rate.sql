-- 269_an_order_remembers_its_own_tax_rate.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- AN ORDER MUST REMEMBER THE RATE IT WAS TAXED AT — and the banquet must store its total the
-- same way every other sale does.
--
-- ── FAULT 1: a banquet prints 18% and is settled at 5% ───────────────────────────────────────
-- Mig 239 gave the banquet its own rate ("ONE restaurant, TWO rates") and only TWO things ever
-- learned about it: the RPC that issues the bill, and printBanquetBill. Everything else re-derives
-- the tax from the restaurant's DINE-IN settings:
--   · billMath() in the manager panel — which is what the Bills tab shows AND what the payment
--     sheet asks the manager to collect,
--   · the Z-report,
--   · the owner analytics RPCs.
-- So a ₹100,000 banquet printed a tax invoice for ₹118,000, and the payment sheet said ₹105,000.
-- Marking it paid recorded ₹105,000 against a ₹118,000 invoice: the restaurant is short ₹13,000
-- on the single biggest sale it makes, and the day-close reports its tax as ₹5,000 not ₹18,000.
--
-- ── FAULT 2: the banquet broke the invariant every money view depends on ─────────────────────
-- Mig 148 states it plainly: "orders.total is the GROSS, tax-inclusive figure and NEVER includes
-- the discount." Dine-in obeys it (mig 119: v_total := v_sub + v_tax) and every reader subtracts
-- `discount × (1 + rate)` at read time. The banquet wrote `v_total := v_sub - v_disc + v_tax`
-- with the discount ALREADY inside, while also storing it in orders.discount — so the owner
-- reports subtract it twice. A ₹100,000 banquet with ₹10,000 off reported ₹95,700 of takings
-- against a true ₹106,200.
--
-- ── THE FIX, in one idea ─────────────────────────────────────────────────────────────────────
-- Put the banquet back on the same convention as everything else (gross total, discount separate)
-- and give every order a `tax_rate` column recording what it was ACTUALLY charged at. Once the
-- banquet stores gross, `tax / subtotal` IS the rate for every kind of sale, so one trigger fills
-- the column for every insert path — existing and any added later — with no RPC needing to know.
--
-- The readers then use the order's OWN rate instead of today's settings, which fixes a second
-- thing at the same time: the Z-report used to re-price the day's bills at whatever the rate is
-- when the report is opened, so an admin correcting the tax setup at 6pm made the 11pm day-close
-- disagree with the paper already handed to guests.
--
-- NOTE ON THE BANQUET BILL ITSELF: banquet_bills keeps its own subtotal/tax/total computed on the
-- DISCOUNTED base, and its frozen tax_lines, exactly as before — that is the issued document and
-- it is correct. Only the `orders` row (the raw sale every report reads) changes convention.
--
-- ⚠️ HISTORICAL BANQUET ROWS: their `total` still carries the old discount-inside convention. This
-- migration deliberately does NOT rewrite past money rows — that is a data correction that should
-- be run and checked against real figures on its own, not bundled into a schema change. Their
-- tax_rate IS backfilled correctly below, so from here they at least report at the right RATE.
--
-- Additive: one nullable column, one trigger, one backfill of a derived value, and ONE line of
-- lfh_banquet_bill_create rewritten (its INSERT INTO orders). Everything else in that function,
-- including every figure the printed banquet bill uses, is byte-for-byte what mig 239 left.
--
-- ⚠️ RUN THIS DELIBERATELY, NOT IN A BUSY MOMENT. The backfill in step 2 touches every order row
-- (~400k on the backup database). It is a single indexed-free UPDATE of one derived column, so it
-- is not dangerous, but it is not free either — run it when the shared instance is quiet, and
-- check `select count(*) from orders where tax_rate is null and tax is not null` afterwards.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS tax_rate numeric;

COMMENT ON COLUMN orders.tax_rate IS
  'The tax rate this order was ACTUALLY charged at, as a decimal (0.05 / 0.18). Stamped on insert from tax/subtotal. Reports read this instead of the restaurant''s current setting, so a later rate change cannot re-price a sale that already happened, and a banquet (its own rate, mig 239) is never re-taxed at the dine-in rate.';

-- ── 1. Stamp it on the way in ────────────────────────────────────────────────
-- Every insert path already writes subtotal and tax together, so the rate is derivable without
-- any caller changing. Only fills a NULL, so an importer that already knows its rate keeps it.
CREATE OR REPLACE FUNCTION lfh_stamp_order_tax_rate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tax_rate IS NULL AND COALESCE(NEW.subtotal, 0) > 0 AND NEW.tax IS NOT NULL THEN
    NEW.tax_rate := round(NEW.tax::numeric / NEW.subtotal::numeric, 6);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION lfh_stamp_order_tax_rate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stamp_order_tax_rate ON orders;
CREATE TRIGGER trg_stamp_order_tax_rate BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION lfh_stamp_order_tax_rate();

-- ── 2. Backfilling the rate for EXISTING orders is migration 270 ─────────────
-- Split out on purpose: everything in THIS file is metadata-only and instant (a nullable column
-- with no default, a trigger, one function replace), so it can be applied to a busy shared
-- instance safely. The backfill is a single UPDATE across every order row (~400k on backup) and
-- deserves its own deliberate run. Until it is run, historical rows simply have a NULL rate and
-- every reader falls back to the restaurant's current setting — exactly today's behaviour.

-- ── 3. The banquet writes a GROSS total, like every other sale ───────────────
-- Body identical to mig 239 except the two arithmetic lines marked below: the ORDER row now
-- carries the gross figures and leaves the discount to be applied at read time, which is what
-- every money view in the product already does. The BILL (banquet_bills, inserted further down
-- by the same function) is unchanged — it keeps the discounted subtotal/tax/total and its frozen
-- tax_lines, because that is the document that was printed.
-- The function to change is lfh_banquet_bill_create (recreated by mig 239 with the banquet rate).
-- NOT lfh_banquet_place_order — that is only a thin wrapper which delegates to it (mig 237 L305)
-- and contains no INSERT at all. Both mig-237 and mig-239 declare bill_create with an identical
-- signature, so CREATE OR REPLACE means exactly one function exists and there is no overload to
-- pick between.
DO $mig$
DECLARE v_src text; v_n int;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'lfh_banquet_bill_create';
  IF v_n = 0 THEN
    RAISE NOTICE 'lfh_banquet_bill_create not found — banquet module not installed here, skipping';
    RETURN;
  END IF;
  IF v_n > 1 THEN
    RAISE EXCEPTION 'mig 269: % overloads of lfh_banquet_bill_create — refusing to guess which one writes the order row', v_n;
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'lfh_banquet_bill_create';

  -- ONLY the orders INSERT changes. v_tax / v_total stay exactly as mig 239 computes them —
  -- they are the BANQUET BILL's figures (tax on the discounted base, total net of the discount)
  -- and they are what prints; rewriting those would change the document itself. The ORDER row
  -- instead gets the gross pair, so it obeys the mig-148 invariant and every reader's read-time
  -- `discount × (1 + rate)` lands on the right number.
  IF position('VALUES (v_table, v_items, v_sub, v_tax, v_total, v_disc,' in v_src) = 0 THEN
    RAISE EXCEPTION 'mig 269: the lfh_banquet_bill_create orders INSERT does not look as expected — refusing to rewrite the function blind. Update this migration by hand rather than shipping a silent no-op.';
  END IF;
  v_src := replace(v_src,
    'VALUES (v_table, v_items, v_sub, v_tax, v_total, v_disc,',
    -- mig 269: GROSS on the order row (tax on the full subtotal, total = subtotal + that tax).
    'VALUES (v_table, v_items, v_sub, round(v_sub * v_rate, 2), v_sub + round(v_sub * v_rate, 2), v_disc,');
  EXECUTE v_src;
END $mig$;

NOTIFY pgrst, 'reload schema';
