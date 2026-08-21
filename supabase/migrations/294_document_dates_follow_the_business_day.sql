-- 294_document_dates_follow_the_business_day.sql
-- (Header renumbered 290 → 294 by sweep T23, 2026-08-21: the file has always been 294 — it was
--  written as 290 and renumbered on merge — but the first line still said 290, which points a
--  reader at 290_the_blocked_guest_must_be_told.sql, a completely unrelated migration. Comment
--  only; not one statement changes.)
--
-- An inventory report for "Yesterday" must cover ONE day, not two
--
-- Purchases, waste and expenses carry a DATE (bill_date / waste_date / expense_date), not an
-- instant, so mig 227 turns the window of instants into a first/last calendar date. Its rule for
-- the LAST date is `((p_to - interval '1 microsecond') AT TIME ZONE 'Asia/Kolkata')::date`, and
-- its own header explains why: `p_to` is "now" for a named range and an exclusive IST MIDNIGHT
-- for a custom one, so stepping back a hair lands on the last real day.
--
-- THE HOLE: a window that ends on a BUSINESS-DAY boundary ends at 05:00 IST, not midnight.
-- `range=yesterday` runs [yesterday 05:00 IST, today 05:00 IST), so `p_to - 1µs` is
-- 04:59:59.999999 TODAY and `::date` is TODAY. Measured on the backup demo, 4 Aug 2026:
-- the low bound came out 2026-08-03 and the high bound 2026-08-04 — a one-day report reading
-- TWO calendar days. Everything dated today was counted in "Yesterday" as well as in "Today",
-- so yesterday's stock spend looked bigger than it was and the same supplier bill appeared in
-- both views (owner-panel sweep, 2026-08-04). The route's own list queries had the identical
-- rule, so the hero band and the detail list agreed with each other and BOTH over-included —
-- nothing on screen contradicted itself, which is why it went unnoticed.
--
-- THE FIX: step back the 5-hour business-day offset BEFORE taking the date. One helper, used
-- everywhere, so the SQL and `app/api/owner/reports/route.ts` (docDateHi) can never drift:
--
--   ends at 05:00 IST today (yesterday / one business day) → yesterday   ← was today
--   ends "now"          (today, 7d, 30d, week, month, 12m, fy, all)      → today (unchanged)
--   ends at IST midnight (custom, lastmonth)                            → last real day (unchanged)
--
-- Only the three functions that filter on a document date are recreated; their bodies are
-- otherwise VERBATIM from mig 227 (`CREATE OR REPLACE` keeps existing grants, and the grants
-- are re-asserted at the end anyway per the project's public-executable gotcha).

-- ── the one rule ──────────────────────────────────────────────────────────────────────────
-- IMMUTABLE is safe: it is pure arithmetic on its argument (the AT TIME ZONE uses a FIXED
-- zone, and Asia/Kolkata has no DST), so it may be used inside an index expression later.
CREATE OR REPLACE FUNCTION lfh_doc_date_hi(p_to timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT ((p_to - interval '5 hours' - interval '1 microsecond') AT TIME ZONE 'Asia/Kolkata')::date;
$$;
COMMENT ON FUNCTION lfh_doc_date_hi(timestamptz) IS
  'Last document DATE (bill/waste/expense) inside a report window ending at p_to, honouring the 05:00-IST business day. Mirrored by docDateHi() in app/api/owner/reports/route.ts.';

-- ── A. the hero band ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lfh_inv_report_summary(
  p_restaurant uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE (
  stock_value      numeric,
  stock_items      integer,
  low_count        integer,
  negative_count   integer,
  purchases_amt    numeric,
  purchases_count  integer,
  consumed_val     numeric,
  wasted_val       numeric,
  waste_count      integer,
  expenses_amt     numeric,
  adjust_val       numeric,
  production_val   numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE((SELECT SUM(qty_base * avg_cost) FROM inv_items
               WHERE restaurant_id = p_restaurant AND active
                 AND track_level <> 'EXPENSE' AND qty_base > 0), 0),
    (SELECT COUNT(*)::int FROM inv_items WHERE restaurant_id = p_restaurant AND active),
    (SELECT COUNT(*)::int FROM inv_items WHERE restaurant_id = p_restaurant AND active
              AND par_qty IS NOT NULL AND qty_base < par_qty),
    (SELECT COUNT(*)::int FROM inv_items WHERE restaurant_id = p_restaurant AND active AND qty_base < 0),
    COALESCE((SELECT SUM(total) FROM inv_purchases
               WHERE restaurant_id = p_restaurant AND voided_at IS NULL
                 AND bill_date >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
                 AND bill_date <= lfh_doc_date_hi(p_to)), 0),
    (SELECT COUNT(*)::int FROM inv_purchases
              WHERE restaurant_id = p_restaurant AND voided_at IS NULL
                AND bill_date >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
                AND bill_date <= lfh_doc_date_hi(p_to)),
    COALESCE((SELECT -SUM(qty_base * unit_cost) FROM inv_movements
               WHERE restaurant_id = p_restaurant AND kind IN ('consumption','consumption_reversal')
                 AND created_at >= p_from AND created_at < p_to), 0),
    COALESCE((SELECT -SUM(qty_base * unit_cost) FROM inv_movements
               WHERE restaurant_id = p_restaurant AND kind IN ('waste','waste_void')
                 AND created_at >= p_from AND created_at < p_to), 0),
    (SELECT COUNT(*)::int FROM inv_waste_entries
              WHERE restaurant_id = p_restaurant AND voided_at IS NULL
                AND waste_date >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
                AND waste_date <= lfh_doc_date_hi(p_to)),
    COALESCE((SELECT SUM(amount) FROM expenses
               WHERE restaurant_id = p_restaurant AND voided_at IS NULL
                 AND expense_date >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
                 AND expense_date <= lfh_doc_date_hi(p_to)), 0),
    COALESCE((SELECT SUM(qty_base * unit_cost) FROM inv_movements
               WHERE restaurant_id = p_restaurant AND kind = 'count_adjust'
                 AND created_at >= p_from AND created_at < p_to), 0),
    COALESCE((SELECT SUM(qty_base * unit_cost) FROM inv_movements
               WHERE restaurant_id = p_restaurant AND kind = 'production'
                 AND created_at >= p_from AND created_at < p_to), 0);
$$;

-- ── C. purchases by vendor ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lfh_inv_report_vendors(
  p_restaurant uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE (vendor text, bills integer, amount numeric, is_cash boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(TRIM(vendor_name), ''),
                  CASE WHEN kind = 'cash' THEN 'Cash / market' ELSE 'Unnamed supplier' END),
         COUNT(*)::int, COALESCE(SUM(total), 0), BOOL_AND(kind = 'cash')
    FROM inv_purchases
   WHERE restaurant_id = p_restaurant AND voided_at IS NULL
     AND bill_date >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
     AND bill_date <= lfh_doc_date_hi(p_to)
   GROUP BY 1
   ORDER BY 3 DESC;
$$;

-- ── D. bucketed cost series ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lfh_inv_cost_series(
  p_restaurant uuid, p_from timestamptz, p_to timestamptz, p_bucket text DEFAULT 'day'
) RETURNS TABLE (bucket text, purchased numeric, used numeric, wasted numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH b AS (
    SELECT CASE WHEN p_bucket = 'month'
                THEN to_char(date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM')
                ELSE to_char((created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') END AS bk,
           kind, qty_base, unit_cost
      FROM inv_movements
     WHERE restaurant_id = p_restaurant AND created_at >= p_from AND created_at < p_to
  ), p AS (
    SELECT CASE WHEN p_bucket = 'month' THEN to_char(bill_date, 'YYYY-MM')
                ELSE to_char(bill_date, 'YYYY-MM-DD') END AS bk,
           total
      FROM inv_purchases
     WHERE restaurant_id = p_restaurant AND voided_at IS NULL
       AND bill_date >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
       AND bill_date <= lfh_doc_date_hi(p_to)
  )
  SELECT k.bk,
         COALESCE((SELECT SUM(total) FROM p WHERE p.bk = k.bk), 0),
         COALESCE((SELECT -SUM(qty_base * unit_cost) FROM b
                    WHERE b.bk = k.bk AND b.kind IN ('consumption','consumption_reversal')), 0),
         COALESCE((SELECT -SUM(qty_base * unit_cost) FROM b
                    WHERE b.bk = k.bk AND b.kind IN ('waste','waste_void')), 0)
    FROM (SELECT bk FROM b UNION SELECT bk FROM p) k
   ORDER BY 1;
$$;

-- ── grants (new Postgres functions are PUBLIC-executable by default — mig 038/267) ────────
REVOKE EXECUTE ON FUNCTION lfh_doc_date_hi(timestamptz)                              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION lfh_inv_report_summary(uuid, timestamptz, timestamptz)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION lfh_inv_report_vendors(uuid, timestamptz, timestamptz)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION lfh_inv_cost_series(uuid, timestamptz, timestamptz, text)  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_doc_date_hi(timestamptz)                              TO service_role;
GRANT  EXECUTE ON FUNCTION lfh_inv_report_summary(uuid, timestamptz, timestamptz)     TO service_role;
GRANT  EXECUTE ON FUNCTION lfh_inv_report_vendors(uuid, timestamptz, timestamptz)     TO service_role;
GRANT  EXECUTE ON FUNCTION lfh_inv_cost_series(uuid, timestamptz, timestamptz, text)  TO service_role;
