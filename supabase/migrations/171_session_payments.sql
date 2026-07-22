-- 171_session_payments.sql
-- SPLIT BILL at settle time (KOT ▾ menu, PetPooja-style): one bill can be collected as
-- several payment LEGS (equal N-way / custom amounts / by-dish shares computed client-
-- side). The bill itself stays ONE bill on ONE session — no second session, no invoice
-- weirdness; the orders are marked paid once with payment_method 'Split' and the legs
-- live here for the money trail (per-method analytics can read this later).
CREATE TABLE IF NOT EXISTS session_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL,
  amount        numeric NOT NULL CHECK (amount > 0),
  method        text NOT NULL CHECK (char_length(method) <= 20),
  note          text CHECK (char_length(note) <= 200),
  created_at    timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_session_payments_session ON session_payments(session_id);
CREATE INDEX IF NOT EXISTS idx_session_payments_rid     ON session_payments(restaurant_id, created_at);

-- Service-role only (staff routes write it; guests never see it): RLS on, NO policies.
ALTER TABLE session_payments ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
