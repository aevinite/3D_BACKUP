-- 256_parcel_printed.sql — remember whether a parcel's bill has been PRINTED.
--
-- WHY (owner, 2026-08-02): a parcel taken from ⚡ QO/P now shows as its own "Parcel N"
-- tile at the bottom of the live floor, and it must stay there until the job is really
-- finished — which the owner defines as "the print is done AND it is marked as paid".
-- `paid` was already tracked (mig 196); "printed" was not, and it cannot live on the
-- device that printed, because the tile has to disappear on EVERY panel, not just that
-- one. So it is a column, like paid.
--
-- Purely additive: one nullable timestamp. Nothing reads it unless it is set, so every
-- existing parcel and every delivery order behaves exactly as before.
ALTER TABLE public.aggregator_orders
  ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.aggregator_orders.printed_at IS
  'When this order''s customer bill was printed. NULL = not printed yet. Used with paid to decide when a Parcel tile leaves the live floor (owner rule, 2026-08-02).';
