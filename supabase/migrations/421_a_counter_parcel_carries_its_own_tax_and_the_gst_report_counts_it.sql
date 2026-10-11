-- 421 · a counter parcel carries its own tax, and the GST report counts it (owner, 2026-10-11)
--
-- WHY. Owner: "do parcel one" — put counter parcels in the GST report. A parcel lives in
-- aggregator_orders (mig 071), a table neither GST report read, and its row kept ONE money figure —
-- `total` — so the tax inside it was never on record. Both doors that make a parcel (manager QO/P,
-- waiter tablet) price it with lib/tax.ts splitBill(); the figures were simply thrown away. A parcel
-- is a taxable sale the restaurant itself owes GST on (unlike a Zomato/Swiggy order, which the app
-- pays under CGST §9(5) — see docs/COMPLIANCE-GUARDRAILS.md §5), so it belongs in the filing.
--
-- WHAT.
--   1. The same split a dine-in order carries, as columns (additive, nullable): subtotal, discount,
--      taxable_base, nontax_amount, mrp_amount, tax_rate, tax. Written at the moment the parcel is
--      made, from the very splitBill() that set its `total` — so record and paper cannot disagree.
--   2. `tax_basis` says where those figures came from:
--        'at_sale'       — written when the parcel was made (every parcel from this migration on);
--        'repriced'      — an older parcel whose own lines, priced with lib/tax.ts, give back its
--                          stored total to the paisa (so the rate is proven, not assumed);
--        'none_recorded' — an older parcel saved WITHOUT its tax (before the 2026-08-02 fix the row
--                          held the pre-tax subtotal while the bill charged tax on top) — the tax that
--                          was collected is not on record anywhere, so none is invented;
--        'unmatched'     — an older parcel whose lines do not reproduce its total.
--      NULL = not looked at yet (a platform row, or a parcel the backfill has not reached).
--      The backfill of older parcels is scripts/backfill-parcel-tax.mjs, not this file: the split
--      lives in ONE place (lib/tax.ts), and a SQL copy of it would drift.
--   3. lfh_owner_parcel_tax(): per bucket, the paid, not-cancelled parcels — the same basis the
--      dine-in tax figure uses (lfh_owner_sales_report: paid AND status <> 'cancelled', bucketed by
--      created_at in IST). Parcels WITH a known tax are summed; those without are counted and their
--      value shown, never dropped — a sale can never disappear from a tax report (COMPLIANCE §3.0).
--
-- Nothing in `total`, `paid`, the numbers or the status of any row is changed. service_role only.

ALTER TABLE public.aggregator_orders
  ADD COLUMN IF NOT EXISTS subtotal      numeric(12,2),
  ADD COLUMN IF NOT EXISTS discount      numeric(12,2),
  ADD COLUMN IF NOT EXISTS taxable_base  numeric(12,2),
  ADD COLUMN IF NOT EXISTS nontax_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS mrp_amount    numeric(12,2),
  ADD COLUMN IF NOT EXISTS tax_rate      numeric(6,4),
  ADD COLUMN IF NOT EXISTS tax           numeric(12,2),
  ADD COLUMN IF NOT EXISTS tax_basis     text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aggregator_orders_tax_basis_is_known') THEN
    ALTER TABLE public.aggregator_orders ADD CONSTRAINT aggregator_orders_tax_basis_is_known
      CHECK (tax_basis IS NULL OR tax_basis IN ('at_sale', 'repriced', 'none_recorded', 'unmatched'));
  END IF;
  -- A KNOWN basis carries its figures; an unknown one carries none (no half-written split).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aggregator_orders_tax_figures_match_basis') THEN
    ALTER TABLE public.aggregator_orders ADD CONSTRAINT aggregator_orders_tax_figures_match_basis
      CHECK (CASE WHEN tax_basis IN ('at_sale', 'repriced')
                  THEN tax IS NOT NULL AND tax_rate IS NOT NULL AND subtotal IS NOT NULL AND taxable_base IS NOT NULL
                  ELSE tax IS NULL END);
  END IF;
END $$;

COMMENT ON COLUMN public.aggregator_orders.tax_basis IS
  'Where this row''s tax figures came from: at_sale (written when the parcel was made) · repriced (an older parcel whose lines reproduce its total) · none_recorded (saved without its tax, before 2026-08-02) · unmatched. NULL = not a parcel / not looked at. Mig 421.';

CREATE OR REPLACE FUNCTION public.lfh_owner_parcel_tax(
  p_restaurant_id uuid, p_from timestamptz, p_to timestamptz, p_bucket text DEFAULT 'day', p_ids uuid[] DEFAULT NULL::uuid[])
RETURNS TABLE(bucket timestamptz, parcels bigint, subtotal numeric, discount numeric, taxable numeric, tax numeric, total numeric,
              untaxed_parcels bigint, untaxed_total numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT date_trunc(COALESCE(NULLIF(p_bucket, ''), 'day'), a.created_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS bucket,
         COUNT(*) FILTER (WHERE a.tax_basis IN ('at_sale', 'repriced'))                                          AS parcels,
         COALESCE(SUM(a.subtotal) FILTER (WHERE a.tax_basis IN ('at_sale', 'repriced')), 0)::numeric(14,2)     AS subtotal,
         COALESCE(SUM(a.discount) FILTER (WHERE a.tax_basis IN ('at_sale', 'repriced')), 0)::numeric(14,2)     AS discount,
         -- the taxable VALUE: what tax was charged on (the taxable part, less the discount when taxed)
         COALESCE(SUM(CASE WHEN a.tax_rate > 0 THEN a.taxable_base - COALESCE(a.discount, 0) ELSE a.taxable_base END)
                  FILTER (WHERE a.tax_basis IN ('at_sale', 'repriced')), 0)::numeric(14,2)                      AS taxable,
         COALESCE(SUM(a.tax) FILTER (WHERE a.tax_basis IN ('at_sale', 'repriced')), 0)::numeric(14,2)          AS tax,
         COALESCE(SUM(a.total) FILTER (WHERE a.tax_basis IN ('at_sale', 'repriced')), 0)::numeric(14,2)        AS total,
         COUNT(*) FILTER (WHERE a.tax_basis IS DISTINCT FROM 'at_sale' AND a.tax_basis IS DISTINCT FROM 'repriced') AS untaxed_parcels,
         COALESCE(SUM(a.total) FILTER (WHERE a.tax_basis IS DISTINCT FROM 'at_sale' AND a.tax_basis IS DISTINCT FROM 'repriced'), 0)::numeric(14,2) AS untaxed_total
    FROM aggregator_orders a
   WHERE (p_restaurant_id IS NOT NULL OR p_ids IS NOT NULL)          -- never the whole platform by accident
     AND (p_restaurant_id IS NULL OR a.restaurant_id = p_restaurant_id)
     AND (p_ids IS NULL OR a.restaurant_id = ANY (p_ids))
     AND a.source = 'parcel'
     AND a.paid = true
     AND a.status NOT IN ('cancelled', 'rejected')
     AND a.created_at >= p_from AND a.created_at < p_to
   GROUP BY 1
   ORDER BY 1;
$function$;

COMMENT ON FUNCTION public.lfh_owner_parcel_tax(uuid, timestamptz, timestamptz, text, uuid[]) IS
  'GST reports: paid, not-cancelled counter parcels per bucket — taxable value, tax and total for those with a known tax (tax_basis at_sale/repriced); the rest counted with their value, never dropped. Same basis as the dine-in tax figure. Mig 421.';

REVOKE ALL ON FUNCTION public.lfh_owner_parcel_tax(uuid, timestamptz, timestamptz, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_parcel_tax(uuid, timestamptz, timestamptz, text, uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
