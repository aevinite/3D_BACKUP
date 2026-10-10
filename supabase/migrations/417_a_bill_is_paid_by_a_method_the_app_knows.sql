-- 417 · a bill is paid by a method the app knows (sweep #10 T30 round 4, item 11, 2026-10-10)
--
-- WHY. orders.payment_method is free text in the database, and until now the ONLY thing stopping a
-- misspelling was the app: every route checks the method against lib/payments.ts PAYMENT_METHODS
-- (UPI, Cash, Card, Other), Pay in parts writes "Split" and a no-charge bill writes "On the house"
-- (lib/tableTags.ts ON_THE_HOUSE_METHOD). Two French House orders of 2026-08-05 still said "cash" in
-- lower case — written the morning the case-insensitive check landed — and a film seeder had paid
-- 1,857 dine-in bills by "Swiggy / Zomato / Website" (a platform sale is its own row in
-- aggregator_orders, never a way a table paid). The reports group by this column, so every stray
-- spelling is its own slice of the payment-mix chart. Both were repaired on dev on 2026-10-10.
--
-- WHAT. One CHECK, NOT VALID first (so it guards every new write at once and never fails on a
-- database that still holds an old spelling), then VALIDATED only when no row breaks it — the same
-- migration is therefore safe on any stack the release ritual carries it to.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_payment_method_is_known') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_payment_method_is_known
      CHECK (payment_method IS NULL OR payment_method IN ('UPI', 'Cash', 'Card', 'Other', 'Split', 'On the house'))
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
     WHERE payment_method IS NOT NULL
       AND payment_method NOT IN ('UPI', 'Cash', 'Card', 'Other', 'Split', 'On the house')
  ) THEN
    ALTER TABLE public.orders VALIDATE CONSTRAINT orders_payment_method_is_known;
  END IF;
END $$;

COMMENT ON CONSTRAINT orders_payment_method_is_known ON public.orders IS
  'A bill is paid by UPI, Cash, Card, Other, Split (Pay in parts) or On the house — lib/payments.ts PAYMENT_METHODS + the two the app writes itself. Mig 417.';

NOTIFY pgrst, 'reload schema';
