-- 261_parcel_platform_bill_numbers.sql
-- ONE numbering series for every sale — dine-in, parcel, Zomato, Swiggy, the website.
--
-- WHY (owner, 2026-08-02): "make sure it is continuing — if it is parcel or any kind of Zomato,
-- Swiggy, everywhere it will continue the invoice number and all that, to keep the track; it will
-- also continue the bill number."
--
-- He is right and this was a real hole. A dine-in bill has both numbers: `bill_no` (the day's
-- running count, from the shared daily counter) and `invoice_no` (the forever-sequential tax
-- invoice number). A parcel and a delivery order had NEITHER — they live in aggregator_orders,
-- which only ever carried `kot_no`. So the parcel receipt printed with a blank Invoice line and
-- no Bill no at all, and nothing tied that piece of paper to a numbered record. Two consequences:
--   · a guest could be handed a bill with no invoice number on it, and
--   · the restaurant's invoice series had silent holes in it — the one thing a tax invoice
--     series may not have (see docs/COMPLIANCE-GUARDRAILS.md).
--
-- HOW: the numbers come from the SAME two counters dine-in already uses, so the series is one
-- series and not three —
--   · bill_no    ← lfh_next_counter(restaurant_id, 'bill')  — resets daily, per restaurant
--   · invoice_no ← lfh_next_seq(restaurant_id, 'invoice')   — never resets, per restaurant
-- and they are stamped by a TRIGGER on insert, not by a caller, so every path gets them: the
-- manager's ⚡ QO/P parcel, the waiter tablet's parcel, the demo/simulated order, a real
-- aggregator webhook, and anything added later.
--
-- WHY AT INSERT and not at print time. Assigning the invoice number when the bill is printed
-- would keep the series perfectly gap-free, but the bill can be printed while the tablet is
-- offline, and a bill handed to a customer with no number on it is worse than a gap. An order
-- that is later cancelled therefore leaves a gap in the series — exactly as a VOIDED dine-in
-- invoice already does (073: "the number stays on the record, never reused"), and a cancelled
-- order is a visible, auditable row, so the gap is always explainable.
--
-- Additive and safe: three nullable columns and one BEFORE INSERT trigger. Existing rows keep
-- NULL and print exactly as they do today, except for the ones still live on the floor right
-- now, which are numbered at the bottom so no open parcel prints a blank number tonight.

ALTER TABLE public.aggregator_orders
  ADD COLUMN IF NOT EXISTS bill_no    INT,
  ADD COLUMN IF NOT EXISTS invoice_no INT,
  ADD COLUMN IF NOT EXISTS invoice_at TIMESTAMPTZ;

COMMENT ON COLUMN public.aggregator_orders.bill_no IS
  'The day''s running bill number, from the SAME per-restaurant daily counter dine-in sessions use — so the day''s bills are one continuous series across dine-in, parcel and delivery (owner, 2026-08-02).';
COMMENT ON COLUMN public.aggregator_orders.invoice_no IS
  'The tax invoice number, from the SAME per-restaurant forever-sequential counter dine-in sessions use. Assigned once, on insert, and never rewritten.';
COMMENT ON COLUMN public.aggregator_orders.invoice_at IS
  'When invoice_no was assigned — the financial year the printed invoice number is formatted against.';

-- Stamp both numbers as the row is born. Written so it can never renumber an existing row:
-- it only fills a NULL, so a re-run, a restore from the recycle bin, or an import that already
-- carries its numbers keeps them.
CREATE OR REPLACE FUNCTION lfh_assign_aggregator_numbers()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rid uuid := COALESCE(NEW.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
BEGIN
  IF NEW.bill_no IS NULL THEN
    NEW.bill_no := lfh_next_counter(v_rid, 'bill');
  END IF;
  IF NEW.invoice_no IS NULL THEN
    NEW.invoice_no := lfh_next_seq(v_rid, 'invoice');
    NEW.invoice_at := COALESCE(NEW.invoice_at, NOW());
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_aggregator_numbers ON public.aggregator_orders;
CREATE TRIGGER trg_aggregator_numbers
  BEFORE INSERT ON public.aggregator_orders
  FOR EACH ROW EXECUTE FUNCTION lfh_assign_aggregator_numbers();

REVOKE ALL ON FUNCTION lfh_assign_aggregator_numbers() FROM PUBLIC, anon, authenticated;

-- Number the orders that are STILL LIVE on a floor right now, oldest first, so a parcel taken
-- five minutes before this migration does not print a blank Invoice line tonight. Anything
-- already finished (printed and paid, or cancelled) is left exactly as it was — back-numbering
-- settled history would put numbers on paper that was handed over without them.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id, restaurant_id FROM public.aggregator_orders
     WHERE invoice_no IS NULL
       AND status <> 'cancelled'
       AND NOT (paid IS TRUE AND printed_at IS NOT NULL)
       AND created_at > NOW() - INTERVAL '2 days'
     ORDER BY created_at
  LOOP
    UPDATE public.aggregator_orders
       SET bill_no    = COALESCE(bill_no, lfh_next_counter(COALESCE(r.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid), 'bill')),
           invoice_no = lfh_next_seq(COALESCE(r.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid), 'invoice'),
           invoice_at = NOW()
     WHERE id = r.id;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
