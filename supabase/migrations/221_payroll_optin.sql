-- 221_payroll_optin.sql — BEING ON THE PAY LIST IS OPT-IN, PER PERSON
-- ═════════════════════════════════════════════════════════════════════════════
-- Owner 2026-07-30: "everyone will not be added to pay — only set one will be there".
-- Having a profile ≠ being on payroll. The owner adds a person to the pay list deliberately;
-- only those people get a rate, can have a payment recorded, and count as an EXPENSE in the
-- reports and in the main profit figure.
--
-- LIVE-SAFE: `in_payroll` defaults FALSE, but every person who ALREADY has a pay rate or a
-- recorded payment is backfilled to true — so nothing that was already being paid silently
-- falls off the books the moment this ships.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS in_payroll boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payroll_added_at timestamptz,
  ADD COLUMN IF NOT EXISTS payroll_added_by text;

-- Backfill: anyone already set up with pay, or already paid, is on the list.
--
-- ⚠️ ONCE ONLY — and this guard is why (sweep #6 terminal 22, 2026-08-21).
-- A re-seed re-runs every migration in this folder with no ledger of its own. This UPDATE is not
-- safe to repeat: it puts a person back on the pay list whenever they still carry a pay rate or
-- have any payment history — which is exactly true of somebody the OWNER has since deliberately
-- taken OFF the list. Their pay would silently reappear in the monthly cost and in the profit
-- figure, and `payroll_added_by` would blame 'migration 221' for a decision the owner reversed.
-- On the first run (a genuinely fresh database) it must still happen, so nothing that was already
-- being paid falls off the books.
--
-- The test is the guard function migration 307 creates. Reaching 307 can only have happened on an
-- EARLIER pass of the seeder, and that pass necessarily ran this file too — so if the function is
-- here at all, the backfill is already done. On a fresh database it does not exist yet at file
-- 221, and the backfill runs exactly once, as intended.
DO $payroll_optin_once$
DECLARE v_applied boolean := false; v_n int;
BEGIN
  -- The guard function only exists from migration 307 onwards, so seeing it at file 221 means an
  -- earlier pass got that far — and that pass ran this backfill. Either the key is already in the
  -- ledger, or it belongs there; both answers are "do not run it again".
  IF to_regprocedure('public.lfh_already_applied(text)') IS NOT NULL THEN
    v_applied := true;
    IF to_regclass('public.lfh_applied_once') IS NOT NULL THEN
      INSERT INTO lfh_applied_once (key, note) VALUES
        ('221_payroll_optin_backfill',
         'the one-time pay-list backfill. A second run puts anyone the owner has since taken OFF the pay list back on it, because they still hold a rate or a payment history.')
      ON CONFLICT (key) DO NOTHING;
    END IF;
  END IF;
  IF v_applied THEN
    RAISE NOTICE '221: the pay-list backfill has already run once — skipped (nobody is put back on the list)';
    RETURN;
  END IF;

  UPDATE staff_users s SET in_payroll = true, payroll_added_at = now(), payroll_added_by = 'migration 221'
   WHERE s.in_payroll = false
     AND (
       (s.pay_type IS NOT NULL AND s.pay_amount IS NOT NULL)
       OR EXISTS (SELECT 1 FROM staff_payments p WHERE p.staff_id = s.id)
     );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '221: % person(s) who already had a pay rate or a payment were put on the pay list', v_n;
END $payroll_optin_once$;

-- The reports read "who is on the pay list" constantly; keep it a cheap indexed answer.
CREATE INDEX IF NOT EXISTS idx_staff_users_payroll
  ON staff_users (restaurant_id) WHERE in_payroll AND deleted_at IS NULL;

-- ── F1 · per-person money summary — pay-list members only ───────────────────
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
     AND s.in_payroll                                   -- pay list only (mig 221)
   GROUP BY s.id, a.outstanding;
$$;

-- ── F3 · monthly COST — only what the pay list is worth ─────────────────────
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
           COALESCE(SUM(
             CASE WHEN s.pay_type = 'monthly' AND s.pay_amount IS NOT NULL THEN
               (s.pay_amount + COALESCE((
                  SELECT SUM(CASE WHEN x->>'kind' = 'deduction'
                                  THEN -1 * COALESCE((x->>'amount')::numeric, 0)
                                  ELSE      COALESCE((x->>'amount')::numeric, 0) END)
                    FROM jsonb_array_elements(s.pay_extras) x
               ), 0))
               * (
                   GREATEST(0, (
                     LEAST(mo.m + interval '1 month' - interval '1 day',
                           COALESCE(s.left_on, mo.m + interval '1 month'))::date
                   - GREATEST(mo.m, COALESCE(s.joined_on, mo.m))::date + 1
                   ))::numeric
                   / EXTRACT(DAY FROM (mo.m + interval '1 month' - interval '1 day'))::numeric
                 )
             ELSE 0 END
           ), 0) AS expected,
           COUNT(*) FILTER (WHERE s.pay_type IS NOT NULL AND s.pay_amount IS NOT NULL)::int AS people,
           COUNT(*) FILTER (WHERE s.pay_type IS NOT NULL AND s.pay_type <> 'monthly')::int AS est_excluded
      FROM months mo
      LEFT JOIN staff_users s
             ON s.restaurant_id = p_restaurant
            AND s.deleted_at IS NULL
            AND s.in_payroll                             -- pay list only (mig 221)
            AND COALESCE(s.joined_on, mo.m) <= (mo.m + interval '1 month' - interval '1 day')::date
            AND COALESCE(s.left_on, mo.m + interval '1 month') >= mo.m
     GROUP BY mo.m
  ), paid_for AS (
    SELECT date_trunc('month', COALESCE(for_period, paid_on))::date AS m,
           COALESCE(SUM(CASE WHEN kind = 'deduction' THEN -amount ELSE amount END), 0) AS paid
      FROM staff_payments
     WHERE restaurant_id = p_restaurant AND voided_at IS NULL
     GROUP BY 1
  )
  SELECT pm.m,
         ROUND(pm.expected, 2),
         COALESCE(pf.paid, 0),
         ROUND(GREATEST(pm.expected - COALESCE(pf.paid, 0), 0), 2),
         pm.people,
         pm.est_excluded
    FROM per_month pm
    LEFT JOIN paid_for pf ON pf.m = pm.m
   ORDER BY pm.m;
$$;

-- ── NEW · one number for the DASHBOARD: staff pay as an expense in a window ──
-- The owner's main profit figure subtracts this (owner 2026-07-30: "it should also reduce
-- main profit because it all counts as expense"). Cash truth — money that actually left,
-- on the day it left. One indexed sum, safe to call on every dashboard open.
CREATE OR REPLACE FUNCTION lfh_staff_pay_expense(
  p_restaurant uuid, p_from date, p_to date, p_ids uuid[] DEFAULT NULL
) RETURNS TABLE (paid_out numeric, people integer, entries integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(amount), 0)            AS paid_out,
         COUNT(DISTINCT staff_id)::int       AS people,
         COUNT(*)::int                       AS entries
    FROM staff_payments
   WHERE voided_at IS NULL
     AND kind <> 'deduction'
     AND paid_on >= p_from AND paid_on <= p_to
     AND (
       (p_restaurant IS NOT NULL AND restaurant_id = p_restaurant)
       OR (p_restaurant IS NULL AND p_ids IS NOT NULL AND restaurant_id = ANY (p_ids))
     );
$$;

REVOKE EXECUTE ON FUNCTION lfh_staff_pay_expense(uuid, date, date, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_staff_pay_expense(uuid, date, date, uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
