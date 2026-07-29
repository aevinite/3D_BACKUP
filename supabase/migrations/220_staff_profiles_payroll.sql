-- 220_staff_profiles_payroll.sql — STAFF PROFILES + PAY RECORDS + PERFORMANCE
-- ═════════════════════════════════════════════════════════════════════════════
-- Owner ask (2026-07-29): every person (owner, manager, waiter — NOT kitchen, his
-- explicit call) gets a real PROFILE they can fill a bit at a time, plus a record of
-- what they have been PAID, which must show up in Reports as money going out, plus a
-- PERFORMANCE report. This migration is the whole data foundation for that; nothing
-- here changes existing behaviour (every column is additive with a default, and the
-- module rung defaults OFF so no restaurant sees the feature until the admin grants it).
--
-- Contents
--   A. staff_users        — profile / job / pay-setup columns (all nullable = fill later)
--   B. staff_payments     — the append-only pay ledger (void with a reason, never delete)
--   C. orders             — placed_by_id / placed_by so a bill can be attributed to a person
--   D. settings           — payroll_allowed / _owner_control / _enabled (the module ladder)
--   E. staff_actions      — index so "what did this person do" is cheap
--   F. RPCs               — pay summary, cash-out (day book), monthly cost, performance
--
-- LIVE-SAFE: additive only. No NOT NULL without a default, no data rewritten, no
-- existing function replaced.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── A. staff_users: the profile ──────────────────────────────────────────────
-- Soft personal details live in ONE jsonb (`profile`) so adding a field later needs no
-- migration; anything a query FILTERS or SUMS (pay amount, joined_on) is a real column.
-- profile keys: full_name, alt_phone, email, dob, blood_group, language, address, city,
--   pincode, emg_name, emg_relation, emg_phone, id_type, id_last4, id_verified,
--   upi_id, bank_last4, notes
ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS profile          jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS joined_on        date,
  ADD COLUMN IF NOT EXISTS left_on          date,          -- set = ex-staff (kept for the record)
  ADD COLUMN IF NOT EXISTS designation      text,
  ADD COLUMN IF NOT EXISTS employment_type  text,          -- full_time | part_time | trial | casual
  ADD COLUMN IF NOT EXISTS shift_label      text,
  ADD COLUMN IF NOT EXISTS weekly_off       text[],        -- {'tue'} — lowercase 3-letter days
  ADD COLUMN IF NOT EXISTS pay_type         text,          -- monthly | daily | hourly | per_shift
  ADD COLUMN IF NOT EXISTS pay_amount       numeric(12,2), -- in the pay_type's unit
  ADD COLUMN IF NOT EXISTS pay_day          text,          -- free text: "1st", "7th", "Every Monday"
  ADD COLUMN IF NOT EXISTS pay_mode         text,          -- cash | upi | bank
  -- recurring allowances / deductions: [{label, kind:'allowance'|'deduction', amount}]
  ADD COLUMN IF NOT EXISTS pay_extras       jsonb   NOT NULL DEFAULT '[]'::jsonb,
  -- may this person see their OWN salary + payments in their panel? (owner's per-person
  -- switch; ON by default — it's their own money and it settles "you didn't pay me")
  ADD COLUMN IF NOT EXISTS can_see_own_pay  boolean NOT NULL DEFAULT true;

-- Guard rails: a typo'd enum should fail loudly at write time, not silently skew a report.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_users_pay_type_check') THEN
    ALTER TABLE staff_users ADD CONSTRAINT staff_users_pay_type_check
      CHECK (pay_type IS NULL OR pay_type IN ('monthly','daily','hourly','per_shift'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_users_employment_type_check') THEN
    ALTER TABLE staff_users ADD CONSTRAINT staff_users_employment_type_check
      CHECK (employment_type IS NULL OR employment_type IN ('full_time','part_time','trial','casual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_users_pay_amount_check') THEN
    ALTER TABLE staff_users ADD CONSTRAINT staff_users_pay_amount_check
      CHECK (pay_amount IS NULL OR pay_amount >= 0);
  END IF;
END $$;

-- ── B. staff_payments: the pay ledger ────────────────────────────────────────
-- APPEND-ONLY on purpose. A wrong entry is VOIDED with a reason and stays visible
-- struck-through, so the record always adds up and nobody can quietly rewrite what a
-- person was paid. (Same discipline as bills — see docs/COMPLIANCE-GUARDRAILS.md.)
CREATE TABLE IF NOT EXISTS staff_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  staff_id        uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('salary','advance','bonus','overtime','reimbursement','deduction')),
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  -- the month this money is FOR (first day of that month), NULL = not tied to a month
  -- (an advance, a reimbursement). Drives the "cost truth" monthly view.
  for_period      date,
  mode            text NOT NULL DEFAULT 'cash' CHECK (mode IN ('cash','upi','bank')),
  -- the day the money actually left the owner's hand — drives the "cash truth" day book.
  paid_on         date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  note            text,
  recorded_by     text,          -- display label ("Rohit (manager)")
  recorded_by_id  uuid,          -- staff_users.id when a logged-in person recorded it
  created_at      timestamptz NOT NULL DEFAULT now(),
  voided_at       timestamptz,
  void_reason     text,
  voided_by       text,
  voided_by_id    uuid
);

-- Reports read by restaurant + date (cash view) and by restaurant + month (cost view);
-- a profile reads one person's history. Partial indexes skip voided rows — the common case.
CREATE INDEX IF NOT EXISTS idx_staff_payments_rest_paid
  ON staff_payments (restaurant_id, paid_on DESC) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_payments_rest_period
  ON staff_payments (restaurant_id, for_period) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_payments_staff
  ON staff_payments (staff_id, paid_on DESC);

-- RLS ON with NO policy ⇒ anon/authenticated denied outright; only the service-role API
-- (which bypasses RLS) can read or write. Same lockdown as staff_users itself.
ALTER TABLE staff_payments ENABLE ROW LEVEL SECURITY;

-- ── C. orders: who punched this order ────────────────────────────────────────
-- `orders` had NO staff attribution at all, so "how many bills did this waiter handle"
-- was unanswerable. NULL keeps its meaning: the GUEST ordered it themselves.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS placed_by_id uuid,
  ADD COLUMN IF NOT EXISTS placed_by    text;

-- The performance report groups a restaurant's orders by person over a date window.
CREATE INDEX IF NOT EXISTS idx_orders_placed_by
  ON orders (restaurant_id, placed_by_id, created_at DESC) WHERE placed_by_id IS NOT NULL;

-- ── D. settings: the module ladder (brand-new feature ⇒ every rung starts OFF) ─
--   payroll_allowed       — admin switch: does this restaurant get staff profiles & pay at all
--   payroll_owner_control — admin hands the on/off to the owner
--   payroll_enabled       — the owner's own toggle (consulted only once transferred)
-- Manager reach rides restaurants.manager_permissions.{see_staff_pay,record_staff_payment,
-- edit_staff_profiles} + owner_entitlements.power_<flag>, exactly like every other power.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS payroll_allowed       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payroll_owner_control BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payroll_enabled       BOOLEAN NOT NULL DEFAULT true;

-- ── E. staff_actions: "what did this person do" must be cheap ────────────────
CREATE INDEX IF NOT EXISTS idx_staff_actions_actor
  ON staff_actions (restaurant_id, actor_id, created_at DESC) WHERE actor_id IS NOT NULL;

-- ═════════════════════════════════════════════════════════════════════════════
-- F. READ RPCs. Aggregates only (writes stay in the scoped route handlers), so a
--    report never scans a whole table from the client. Every one is service-role only.
-- ═════════════════════════════════════════════════════════════════════════════

-- F1. Per-person money summary for a window + all-time advance still outstanding.
--     `advance_outstanding` = advances taken − 'deduction' rows (a deduction row is how
--     an advance gets recovered from a later salary), all-time, never negative.
CREATE OR REPLACE FUNCTION lfh_staff_pay_summary(
  p_restaurant uuid, p_from date, p_to date
) RETURNS TABLE (
  staff_id uuid, paid numeric, salary_paid numeric, advance_paid numeric,
  bonus_paid numeric, overtime_paid numeric, other_paid numeric,
  entries integer, last_paid_on date, advance_outstanding numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH win AS (
    SELECT staff_id, kind, amount, paid_on
      FROM staff_payments
     WHERE restaurant_id = p_restaurant AND voided_at IS NULL
       AND paid_on >= p_from AND paid_on <= p_to
  ), alltime AS (
    SELECT staff_id,
           COALESCE(SUM(amount) FILTER (WHERE kind = 'advance'), 0)
         - COALESCE(SUM(amount) FILTER (WHERE kind = 'deduction'), 0) AS outstanding
      FROM staff_payments
     WHERE restaurant_id = p_restaurant AND voided_at IS NULL
     GROUP BY staff_id
  )
  SELECT s.id,
         COALESCE(SUM(w.amount) FILTER (WHERE w.kind <> 'deduction'), 0)              AS paid,
         COALESCE(SUM(w.amount) FILTER (WHERE w.kind = 'salary'), 0)                  AS salary_paid,
         COALESCE(SUM(w.amount) FILTER (WHERE w.kind = 'advance'), 0)                 AS advance_paid,
         COALESCE(SUM(w.amount) FILTER (WHERE w.kind = 'bonus'), 0)                   AS bonus_paid,
         COALESCE(SUM(w.amount) FILTER (WHERE w.kind = 'overtime'), 0)                AS overtime_paid,
         COALESCE(SUM(w.amount) FILTER (WHERE w.kind = 'reimbursement'), 0)           AS other_paid,
         COUNT(w.amount)::int                                                         AS entries,
         MAX(w.paid_on)                                                               AS last_paid_on,
         GREATEST(COALESCE(a.outstanding, 0), 0)                                      AS advance_outstanding
    FROM staff_users s
    LEFT JOIN win     w ON w.staff_id = s.id
    LEFT JOIN alltime a ON a.staff_id = s.id
   WHERE s.restaurant_id = p_restaurant AND s.deleted_at IS NULL
   GROUP BY s.id, a.outstanding;
$$;

-- F2. CASH TRUTH — money that actually left the till/account, bucketed for the day book.
--     p_bucket: 'day' | 'month'. One row per bucket that HAS a payment (no empty rows).
CREATE OR REPLACE FUNCTION lfh_staff_pay_cashflow(
  p_restaurant uuid, p_from date, p_to date, p_bucket text DEFAULT 'day'
) RETURNS TABLE (bucket date, paid_out numeric, people integer, entries integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT date_trunc(CASE WHEN p_bucket = 'month' THEN 'month' ELSE 'day' END, paid_on)::date AS bucket,
         COALESCE(SUM(amount) FILTER (WHERE kind <> 'deduction'), 0)                          AS paid_out,
         COUNT(DISTINCT staff_id)::int                                                        AS people,
         COUNT(*)::int                                                                        AS entries
    FROM staff_payments
   WHERE restaurant_id = p_restaurant AND voided_at IS NULL
     AND paid_on >= p_from AND paid_on <= p_to
     AND kind <> 'deduction'
   GROUP BY 1
   ORDER BY 1;
$$;

-- F3. COST TRUTH — per month: what the team SHOULD cost vs what was actually paid for
--     that month, so the owner sees "₹1,42,000 paid, ₹44,000 still owed".
--     `expected` covers MONTHLY-paid people only, prorated by joined_on / left_on inside
--     the month; people on a daily/hourly/per-shift rate can't be predicted without
--     attendance, so they're COUNTED in `est_excluded` and honestly left out of expected.
CREATE OR REPLACE FUNCTION lfh_staff_pay_monthly_cost(
  p_restaurant uuid, p_from date, p_to date
) RETURNS TABLE (
  bucket date, expected numeric, paid numeric, owed numeric,
  people integer, est_excluded integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH months AS (
    SELECT generate_series(date_trunc('month', p_from)::date,
                           date_trunc('month', p_to)::date,
                           interval '1 month')::date AS m
  ), per_month AS (
    SELECT mo.m,
           -- monthly-rate people, prorated by the days their employment covered
           COALESCE(SUM(
             CASE WHEN s.pay_type = 'monthly' AND s.pay_amount IS NOT NULL THEN
               (s.pay_amount + COALESCE((
                  SELECT SUM(CASE WHEN x->>'kind' = 'deduction'
                                  THEN -1 * COALESCE((x->>'amount')::numeric, 0)
                                  ELSE      COALESCE((x->>'amount')::numeric, 0) END)
                    FROM jsonb_array_elements(s.pay_extras) x
               ), 0))
               * (
                   -- days of this month covered by their employment ÷ days in month
                   GREATEST(0, (
                     LEAST(mo.m + interval '1 month' - interval '1 day',
                           COALESCE(s.left_on, mo.m + interval '1 month'))::date
                   - GREATEST(mo.m, COALESCE(s.joined_on, mo.m))::date + 1
                   ))::numeric
                   / EXTRACT(DAY FROM (mo.m + interval '1 month' - interval '1 day'))::numeric
                 )
             ELSE 0 END
           ), 0) AS expected,
           -- people this month's cost actually covers = those with a pay rate set. Counting
           -- every staff row here read as "10 people cost ₹50,500" when only 2 had a rate.
           COUNT(*) FILTER (WHERE s.pay_type IS NOT NULL AND s.pay_amount IS NOT NULL)::int AS people,
           COUNT(*) FILTER (WHERE s.pay_type IS NOT NULL AND s.pay_type <> 'monthly')::int AS est_excluded
      FROM months mo
      LEFT JOIN staff_users s
             ON s.restaurant_id = p_restaurant
            AND s.deleted_at IS NULL
            AND COALESCE(s.joined_on, mo.m) <= (mo.m + interval '1 month' - interval '1 day')::date
            AND COALESCE(s.left_on, mo.m + interval '1 month') >= mo.m
     GROUP BY mo.m
  ), paid_for AS (
    -- money attributed to the month it is FOR (falls back to the month it was paid in
    -- when the recorder didn't tie it to a period, e.g. an advance).
    -- A 'deduction' row is how an advance gets recovered out of a later salary, so here —
    -- unlike the cash view — it SUBTRACTS. Without this, an advance counted as paid and its
    -- recovery counted as nothing, so the month showed more paid than ever changed hands.
    SELECT date_trunc('month', COALESCE(for_period, paid_on))::date AS m,
           COALESCE(SUM(CASE WHEN kind = 'deduction' THEN -amount ELSE amount END), 0) AS paid
      FROM staff_payments
     WHERE restaurant_id = p_restaurant AND voided_at IS NULL
     GROUP BY 1
  )
  SELECT pm.m,
         ROUND(pm.expected, 2)                                            AS expected,
         COALESCE(pf.paid, 0)                                             AS paid,
         ROUND(GREATEST(pm.expected - COALESCE(pf.paid, 0), 0), 2)        AS owed,
         pm.people,
         pm.est_excluded
    FROM per_month pm
    LEFT JOIN paid_for pf ON pf.m = pm.m
   ORDER BY pm.m;
$$;

-- F4. PERFORMANCE — one row per person for a window. Owner-only report.
--     Attribution sources, all honest about what the app actually records:
--       • days/hours active, actions → staff_actions.actor_id (stamped from the login)
--       • orders punched, value, tables, guests, discount → orders.placed_by_id
--       • ratings → feedback joined to those orders
--       • paid → the pay ledger
--     `hours_active` = per day, last action minus first action (a shift's span).
CREATE OR REPLACE FUNCTION lfh_staff_performance(
  p_restaurant uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE (
  staff_id uuid, days_active integer, hours_active numeric, actions integer,
  orders_punched integer, value_punched numeric, tables_served integer,
  guests_served integer, discount_given numeric, ratings integer,
  avg_rating numeric, paid numeric, first_seen timestamptz, last_seen timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH act AS (
    SELECT actor_id AS sid,
           (created_at AT TIME ZONE 'Asia/Kolkata')::date AS d,
           created_at
      FROM staff_actions
     WHERE restaurant_id = p_restaurant AND actor_id IS NOT NULL
       AND created_at >= p_from AND created_at < p_to
  ), per_day AS (
    SELECT sid, d, MAX(created_at) - MIN(created_at) AS span, COUNT(*) AS n
      FROM act GROUP BY sid, d
  ), act_agg AS (
    SELECT sid,
           COUNT(*)::int                                                   AS days_active,
           ROUND(SUM(EXTRACT(EPOCH FROM span)) / 3600.0, 2)                AS hours_active,
           SUM(n)::int                                                     AS actions
      FROM per_day GROUP BY sid
  ), seen AS (
    SELECT sid, MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
      FROM act GROUP BY sid
  ), ord AS (
    SELECT placed_by_id AS sid,
           COUNT(*)::int                                                   AS orders_punched,
           COALESCE(SUM(total), 0)                                         AS value_punched,
           COUNT(DISTINCT table_number)::int                               AS tables_served,
           COUNT(DISTINCT session_id)::int                                 AS guests_served,
           COALESCE(SUM(discount), 0)                                      AS discount_given
      FROM orders
     WHERE restaurant_id = p_restaurant AND placed_by_id IS NOT NULL
       AND created_at >= p_from AND created_at < p_to
       AND deleted_at IS NULL AND cancelled_at IS NULL
     GROUP BY placed_by_id
  ), rate AS (
    SELECT o.placed_by_id AS sid, COUNT(*)::int AS ratings, ROUND(AVG(f.rating)::numeric, 2) AS avg_rating
      FROM feedback f
      JOIN orders o ON o.id = f.order_id
     WHERE o.restaurant_id = p_restaurant AND o.placed_by_id IS NOT NULL
       AND f.created_at >= p_from AND f.created_at < p_to
     GROUP BY o.placed_by_id
  ), pay AS (
    SELECT staff_id AS sid, COALESCE(SUM(amount) FILTER (WHERE kind <> 'deduction'), 0) AS paid
      FROM staff_payments
     WHERE restaurant_id = p_restaurant AND voided_at IS NULL
       AND paid_on >= (p_from AT TIME ZONE 'Asia/Kolkata')::date
       AND paid_on <= (p_to   AT TIME ZONE 'Asia/Kolkata')::date
     GROUP BY staff_id
  )
  SELECT s.id,
         COALESCE(a.days_active, 0), COALESCE(a.hours_active, 0), COALESCE(a.actions, 0),
         COALESCE(o.orders_punched, 0), COALESCE(o.value_punched, 0),
         COALESCE(o.tables_served, 0), COALESCE(o.guests_served, 0),
         COALESCE(o.discount_given, 0),
         COALESCE(r.ratings, 0), r.avg_rating,
         COALESCE(p.paid, 0),
         sn.first_seen, sn.last_seen
    FROM staff_users s
    LEFT JOIN act_agg a ON a.sid = s.id
    LEFT JOIN seen    sn ON sn.sid = s.id
    LEFT JOIN ord     o ON o.sid = s.id
    LEFT JOIN rate    r ON r.sid = s.id
    LEFT JOIN pay     p ON p.sid = s.id
   WHERE s.restaurant_id = p_restaurant AND s.deleted_at IS NULL;
$$;

-- ── Lock every new function down (CLAUDE.md gotcha: new functions are PUBLIC-executable
--    by default; a staff-only read must never be callable with the guest anon key) ─────
REVOKE EXECUTE ON FUNCTION lfh_staff_pay_summary(uuid, date, date)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION lfh_staff_pay_cashflow(uuid, date, date, text)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION lfh_staff_pay_monthly_cost(uuid, date, date)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION lfh_staff_performance(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_staff_pay_summary(uuid, date, date)              TO service_role;
GRANT  EXECUTE ON FUNCTION lfh_staff_pay_cashflow(uuid, date, date, text)       TO service_role;
GRANT  EXECUTE ON FUNCTION lfh_staff_pay_monthly_cost(uuid, date, date)         TO service_role;
GRANT  EXECUTE ON FUNCTION lfh_staff_performance(uuid, timestamptz, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';
