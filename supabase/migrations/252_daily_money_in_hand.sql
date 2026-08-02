-- 252_daily_money_in_hand.sql — WHAT'S LEFT IN HAND, PER DAY
-- ═════════════════════════════════════════════════════════════════════════════
-- Owner ask (2026-08-01): the daily report must finish the sentence it currently stops
-- half-way through. Today the day sheet ends at "Total collected". He wants it to carry
-- on: minus the GST that isn't his, minus everything the day COST him, and land on one
-- number — what he actually kept. And the cost line must be a single tappable
-- "Expenses" that opens and shows every part: money he paid out by hand, wages, the
-- stock the kitchen burned through, waste, and cancelled orders.
--
--        Item sales − discounts = Net sales + GST = TOTAL COLLECTED
--        − GST set aside  = his money
--        − Expenses       = LEFT IN HAND
--
-- Three of those parts had no per-day answer in the database. This migration adds them.
-- Nothing here writes; every function is read-only, service-role only, and returns
-- NOTHING (not zero) for a restaurant that doesn't run the module behind it — a zero
-- would read as "we checked and it cost you nothing", which is a lie.
--
-- ── A. lfh_expense_series — the hand-entered costs, per day ──────────────────
-- ── B. lfh_staff_pay_accrual — wages spread across the days they were earned ─
-- ── C. lfh_cancelled_consumption — the food a cancelled order already ate ────
-- ── D. settings.cancel_cost_mode — which way a cancelled order is charged ────
--
-- ── THE WINDOW RULE FOR DOCUMENT DATES ───────────────────────────────────────
-- Same rule as mig 227, for the same reason: p_to arrives EITHER as an exclusive IST
-- midnight (custom ranges) OR as the instant "now" (every named range). A bare
-- `date_col < p_to::date` is right for the first and silently drops everything dated
-- TODAY for the second. So document dates always end at
-- `<= ((p_to - 1 microsecond) AT TIME ZONE 'Asia/Kolkata')::date`. Never a bare `<`.
--
-- ── WHY CANCELLED ORDERS NEEDED THEIR OWN FUNCTION (the double-count trap) ───
-- mig 224 line 16 is deliberate: pending→cancelled never deducted stock, but
-- preparing→cancelled KEEPS the deduction, because that food really was cooking. So
-- the cost of a cooked-then-cancelled order is ALREADY inside lfh_inv_cost_series.used.
-- The owner's rule (2026-08-02) is one or the other, never both:
--   cancel_cost_mode = 'stock' → it stays inside "stock used"; the report only NAMES
--                                the lost sales beside it, and adds nothing.
--   cancel_cost_mode = 'bill'  → the whole menu price is charged as its own expense
--                                line, and C below is SUBTRACTED from "stock used" so
--                                that same food is not paid for twice.
-- Every rupee is counted exactly once under either setting. That is the whole point of
-- this function existing — do not "simplify" it away.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── A. hand-entered expenses, bucketed, with the category split ──────────────
-- The `expenses` table (mig 221 §G, "the broken-lamp ask") is already the right shape:
-- append-only, voided never deleted, one IST date per row. This just buckets it and
-- carries the per-category split in the same row, so the report's Expenses drawer costs
-- ONE call rather than one per category.
CREATE OR REPLACE FUNCTION lfh_expense_series(
  p_restaurant uuid, p_from timestamptz, p_to timestamptz, p_bucket text DEFAULT 'day'
) RETURNS TABLE (bucket text, amount numeric, entries integer, by_category jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH e AS (
    SELECT CASE WHEN p_bucket = 'month' THEN to_char(expense_date, 'YYYY-MM')
                ELSE to_char(expense_date, 'YYYY-MM-DD') END AS bk,
           category, amount
      FROM expenses
     WHERE restaurant_id = p_restaurant
       AND voided_at IS NULL
       AND expense_date >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
       AND expense_date <= ((p_to - interval '1 microsecond') AT TIME ZONE 'Asia/Kolkata')::date
  ), c AS (
    SELECT bk, category, SUM(amount) AS amt, COUNT(*)::int AS n
      FROM e GROUP BY bk, category
  )
  SELECT c.bk,
         SUM(c.amt),
         SUM(c.n)::int,
         jsonb_object_agg(c.category, round(c.amt, 2))
    FROM c GROUP BY c.bk ORDER BY 1;
$$;

-- ── B. wages, spread across the days they were earned ────────────────────────
-- Owner's choice (2026-08-02): a ₹30,000 monthly salary is ₹1,000 on each of the
-- month's days, NOT ₹30,000 on payday. Paying it all on the 1st makes one day look
-- catastrophic and the other thirty look better than they were, and the whole purpose
-- of this report is comparing one day with another.
--
-- What can honestly be spread, and what cannot:
--   monthly    → (rate + allowances − deductions) ÷ days in THAT month, only for the
--                days the person was actually employed (joined_on / left_on prorate
--                themselves by simply not matching).
--   daily      → the full day rate on each day that isn't one of their weekly offs.
--   hourly     → NOT DERIVABLE. There is no attendance/clock-in table in this app.
--   per_shift  → NOT DERIVABLE, same reason.
-- Rather than invent a number for the last two, they are counted in `excluded` so the
-- screen can say "2 people paid by the hour aren't included — the app doesn't record
-- their hours yet". An invented wage would quietly corrupt every profit figure.
--
-- `paid` rides along in the same row: the CASH that actually left on that day
-- (staff_payments.paid_on). The report shows it as information; the number it
-- SUBTRACTS is `accrued`.
CREATE OR REPLACE FUNCTION lfh_staff_pay_accrual(
  p_restaurant uuid, p_from timestamptz, p_to timestamptz, p_bucket text DEFAULT 'day'
) RETURNS TABLE (bucket text, accrued numeric, people integer, excluded integer, paid numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH bounds AS (
    SELECT (p_from AT TIME ZONE 'Asia/Kolkata')::date AS d0,
           ((p_to - interval '1 microsecond') AT TIME ZONE 'Asia/Kolkata')::date AS d1
  ), days AS (
    SELECT d::date AS day FROM bounds, generate_series(bounds.d0, bounds.d1, interval '1 day') d
  ), staff AS (
    SELECT id, pay_type, COALESCE(pay_amount, 0) AS rate, joined_on, left_on,
           COALESCE(weekly_off, '{}') AS offs,
           COALESCE((
             SELECT SUM(CASE WHEN x->>'kind' = 'deduction' THEN -COALESCE((x->>'amount')::numeric, 0)
                             ELSE COALESCE((x->>'amount')::numeric, 0) END)
               FROM jsonb_array_elements(CASE WHEN jsonb_typeof(pay_extras) = 'array'
                                              THEN pay_extras ELSE '[]'::jsonb END) x
           ), 0) AS extras
      FROM staff_users
     WHERE restaurant_id = p_restaurant
       AND in_payroll IS TRUE
       AND deleted_at IS NULL
  ), grid AS (
    SELECT days.day,
           s.id,
           s.pay_type,
           CASE
             -- ÷ days in the day's OWN month, so February isn't charged at January's rate
             WHEN s.pay_type = 'monthly' THEN
               (s.rate + s.extras) / date_part('days', (date_trunc('month', days.day) + interval '1 month - 1 day'))::numeric
             WHEN s.pay_type = 'daily' AND NOT (lower(to_char(days.day, 'Dy')) = ANY (s.offs)) THEN
               s.rate
             ELSE 0
           END AS day_cost
      FROM days
      JOIN staff s
        ON (s.joined_on IS NULL OR s.joined_on <= days.day)
       AND (s.left_on   IS NULL OR s.left_on   >= days.day)
  ), acc AS (
    SELECT CASE WHEN p_bucket = 'month' THEN to_char(day, 'YYYY-MM')
                ELSE to_char(day, 'YYYY-MM-DD') END AS bk,
           SUM(day_cost) AS accrued,
           COUNT(DISTINCT id) FILTER (WHERE pay_type IN ('monthly','daily'))::int   AS people,
           COUNT(DISTINCT id) FILTER (WHERE pay_type IN ('hourly','per_shift'))::int AS excluded
      FROM grid GROUP BY 1
  ), cash AS (
    SELECT CASE WHEN p_bucket = 'month' THEN to_char(paid_on, 'YYYY-MM')
                ELSE to_char(paid_on, 'YYYY-MM-DD') END AS bk,
           SUM(amount) AS paid
      FROM staff_payments
     WHERE restaurant_id = p_restaurant
       AND voided_at IS NULL
       AND kind <> 'deduction'
       AND paid_on >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
       AND paid_on <= ((p_to - interval '1 microsecond') AT TIME ZONE 'Asia/Kolkata')::date
     GROUP BY 1
  )
  SELECT k.bk,
         round(COALESCE(a.accrued, 0), 2),
         COALESCE(a.people, 0),
         COALESCE(a.excluded, 0),
         round(COALESCE(c.paid, 0), 2)
    FROM (SELECT bk FROM acc UNION SELECT bk FROM cash) k
    LEFT JOIN acc  a ON a.bk = k.bk
    LEFT JOIN cash c ON c.bk = k.bk
   ORDER BY 1;
$$;

-- ── C. the food a cancelled order already ate ────────────────────────────────
-- Bucketed by the MOVEMENT's own date, not the cancellation's — because that is how
-- lfh_inv_cost_series buckets `used`, and the only job of this number is to be
-- subtractable from that one. A dish fired at 23:50 and cancelled at 00:10 belongs to
-- the day it was cooked in both places, so the two always line up.
CREATE OR REPLACE FUNCTION lfh_cancelled_consumption(
  p_restaurant uuid, p_from timestamptz, p_to timestamptz, p_bucket text DEFAULT 'day'
) RETURNS TABLE (bucket text, cost numeric, orders integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN p_bucket = 'month'
              THEN to_char(date_trunc('month', m.created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM')
              ELSE to_char((m.created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') END,
         round(-SUM(m.qty_base * m.unit_cost), 2),
         COUNT(DISTINCT m.ref_id)::int
    FROM inv_movements m
    JOIN orders o
      ON o.id = m.ref_id::uuid
     AND o.restaurant_id = m.restaurant_id
     AND o.status = 'cancelled'
   WHERE m.restaurant_id = p_restaurant
     AND m.ref_type = 'order'
     AND m.kind IN ('consumption','consumption_reversal')
     AND m.created_at >= p_from
     AND m.created_at <  p_to
   GROUP BY 1 ORDER BY 1;
$$;

-- The join above filters on ref_type/ref_id, which no existing index covers.
CREATE INDEX IF NOT EXISTS idx_inv_movements_order_ref
  ON inv_movements (restaurant_id, ref_id)
  WHERE ref_type = 'order';

-- ── D. which way a cancelled order is charged ────────────────────────────────
-- The owner's toggle, per restaurant (2026-08-02): "whenever the inventory is on it
-- will cut from inventory; if the inventory is off it will cut from total bill".
-- 'stock' is the default because it is the accurate one — you only really lost the
-- food, not the sale price you never received. A restaurant with no inventory module
-- has no stock to take it from, so the reader treats it as 'bill' regardless of what
-- is stored here; storing it anyway means switching the module on later restores the
-- owner's own choice instead of silently changing his numbers.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS cancel_cost_mode TEXT NOT NULL DEFAULT 'stock';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settings_cancel_cost_mode_chk'
  ) THEN
    ALTER TABLE settings
      ADD CONSTRAINT settings_cancel_cost_mode_chk
      CHECK (cancel_cost_mode IN ('stock','bill'));
  END IF;
END $$;

-- Service-role only, like every other lfh_* report function (mig 038's rule: a new
-- function is PUBLIC-executable until told otherwise).
REVOKE EXECUTE ON FUNCTION lfh_expense_series(uuid, timestamptz, timestamptz, text)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION lfh_staff_pay_accrual(uuid, timestamptz, timestamptz, text)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION lfh_cancelled_consumption(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_expense_series(uuid, timestamptz, timestamptz, text)        TO service_role;
GRANT  EXECUTE ON FUNCTION lfh_staff_pay_accrual(uuid, timestamptz, timestamptz, text)     TO service_role;
GRANT  EXECUTE ON FUNCTION lfh_cancelled_consumption(uuid, timestamptz, timestamptz, text) TO service_role;

NOTIFY pgrst, 'reload schema';
