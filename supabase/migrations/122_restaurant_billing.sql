-- 122_restaurant_billing.sql — SaaS billing (what each restaurant PAYS US), admin-only.
-- [was titled 118_ until 2026-08-06 — 118 is price_order_tenant_scope]
--
-- NOT restaurant food revenue (that stays owner-panel-only, CLAUDE.md hard rule).
-- This is platform income: plan, subscription status, amount/cycle, next-due date,
-- and a payment ledger the admin enters BY HAND (owner has no payment gateway yet).
-- ADDITIVE ONLY — two new tables, nothing existing touched.
--
-- Locked exactly like other sensitive tables (e.g. staff_users, migration 054):
-- RLS enabled, NO policies ⇒ anon/authenticated get zero access; the admin API
-- uses the service-role key (bypasses RLS) behind the staff-cookie admin gate.

CREATE TABLE IF NOT EXISTS restaurant_billing (
  restaurant_id uuid PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
  plan          text,
  status        text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','paused','cancelled')),
  amount        numeric,
  currency      text NOT NULL DEFAULT 'INR',
  cycle         text NOT NULL DEFAULT 'yearly' CHECK (cycle IN ('monthly','yearly')),
  started_on    date,
  next_due_on   date,
  notes         text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS restaurant_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  amount        numeric NOT NULL,
  paid_on       date NOT NULL,
  method        text,
  period_label  text,   -- e.g. "2026 yearly"
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The admin's two hot filters: "this restaurant's payment history" (restaurant_id,
-- paid_on) and "how much did we collect this year" (paid_on alone, for the
-- platform-wide yearly total). Both covered by the one composite index.
CREATE INDEX IF NOT EXISTS idx_restaurant_payments_rid_paid ON restaurant_payments (restaurant_id, paid_on);

ALTER TABLE restaurant_billing  ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_payments ENABLE ROW LEVEL SECURITY;
-- No policies on purpose (service role bypasses RLS); revoke direct grants too.
REVOKE ALL ON restaurant_billing  FROM anon, authenticated;
REVOKE ALL ON restaurant_payments FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
