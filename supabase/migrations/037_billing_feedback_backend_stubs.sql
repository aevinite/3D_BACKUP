-- Billing depth + guest feedback + the two BACKEND-ONLY systems (owner, 2026-06-13).
--
-- 1. BILLING: per-order discounts, GST-ready settings, year-long sequential
--    invoice numbers, and an atomic "shift table" (move a whole party).
-- 2. FEEDBACK: one rating+comment per ORDER (proof of visit = holding the order
--    id), readable by staff.
-- 3. BACKEND-ONLY (no UI anywhere, feature flags default OFF -- owner: "like
--    they are not there at all"): OTP verification plumbing and payment /
--    aggregator tables for the future Zomato-Swiggy + in-app payment work.
--    (Named verification_codes because an old otp_codes table already exists
--    with a different shape from an earlier experiment.)

-- 1a. discounts on orders (stored separately -- totals stay auditable)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_note TEXT;

-- 1b. GST-ready settings (dormant until the gst_invoice flag is turned on)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS gstin TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tax_rate NUMERIC;          -- e.g. 0.05
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN;     -- menu prices include tax?
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_prefix TEXT;       -- e.g. "LFH"

-- 1c. forever-sequential counters (invoice numbers must never reset daily)
CREATE TABLE IF NOT EXISTS seq_counters (key TEXT PRIMARY KEY, n INT NOT NULL DEFAULT 0);
CREATE OR REPLACE FUNCTION lfh_next_seq(p_key text)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_n int;
BEGIN
  INSERT INTO seq_counters(key, n) VALUES (p_key, 1)
    ON CONFLICT (key) DO UPDATE SET n = seq_counters.n + 1
    RETURNING n INTO v_n;
  RETURN v_n;
END; $$;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS invoice_no INT; -- assigned when a tax invoice is generated

-- 1d. shift a whole party to another table, atomically.
-- Moves the session + its orders + its open waiter calls in one transaction.
-- SERVICE-ROLE ONLY (no anon grant): staff panels call it via their server key.
CREATE OR REPLACE FUNCTION lfh_staff_shift_table(p_session uuid, p_to text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s sessions; v_from text;
BEGIN
  SELECT * INTO v_s FROM sessions WHERE id = p_session;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_session'); END IF;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF p_to !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'reason', 'bad_table'); END IF;
  IF p_to = v_s.table_number THEN RETURN json_build_object('ok', false, 'reason', 'same_table'); END IF;
  -- The destination must be empty: no open session may already live there.
  IF EXISTS (SELECT 1 FROM sessions WHERE table_number = p_to AND status = 'open') THEN
    RETURN json_build_object('ok', false, 'reason', 'target_occupied');
  END IF;
  v_from := v_s.table_number;
  UPDATE sessions     SET table_number = p_to, last_activity_at = NOW() WHERE id = p_session;
  UPDATE orders       SET table_number = p_to WHERE session_id = p_session;
  UPDATE waiter_calls SET table_number = p_to WHERE session_id = p_session AND NOT resolved;
  RETURN json_build_object('ok', true, 'from', v_from, 'to', p_to);
END; $$;

-- 2. guest feedback: one rating per ORDER (holding the id proves the visit)
CREATE TABLE IF NOT EXISTS feedback (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  table_number TEXT,
  rating       INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      TEXT,
  name         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- The guest-side door: validate the order really exists, upsert their feedback.
CREATE OR REPLACE FUNCTION lfh_leave_feedback(p_order uuid, p_rating int, p_comment text, p_name text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_o orders;
BEGIN
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN RETURN json_build_object('ok', false, 'reason', 'bad_rating'); END IF;
  SELECT * INTO v_o FROM orders WHERE id = p_order;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'unknown_order'); END IF;
  INSERT INTO feedback(order_id, table_number, rating, comment, name)
    VALUES (p_order, v_o.table_number, p_rating, NULLIF(trim(p_comment), ''), NULLIF(trim(p_name), ''))
    ON CONFLICT (order_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, name = EXCLUDED.name, created_at = NOW();
  RETURN json_build_object('ok', true);
END; $$;
GRANT EXECUTE ON FUNCTION lfh_leave_feedback(uuid, int, text, text) TO anon;

-- 3a. BACKEND-ONLY: OTP verification plumbing (feature flag 'verification',
--     default OFF -> the RPCs answer 'disabled' and no screen shows them)
CREATE TABLE IF NOT EXISTS verification_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact    TEXT NOT NULL,              -- phone number or email address
  channel    TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email')),
  code       TEXT NOT NULL,              -- the 6-digit code (hash later if needed)
  purpose    TEXT NOT NULL DEFAULT 'order',
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_verification_contact ON verification_codes(contact, used, expires_at);

-- Both RPCs check the feature switch FIRST: while it's off they refuse, so the
-- whole system behaves as if it doesn't exist (the owner's requirement).
CREATE OR REPLACE FUNCTION lfh_request_otp(p_contact text, p_channel text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_on boolean; v_code text;
BEGIN
  SELECT COALESCE((features->>'verification')::boolean, false) INTO v_on FROM settings WHERE id = 'site';
  IF NOT v_on THEN RETURN json_build_object('ok', false, 'reason', 'disabled'); END IF;
  IF p_channel NOT IN ('sms','whatsapp','email') THEN RETURN json_build_object('ok', false, 'reason', 'bad_channel'); END IF;
  IF length(trim(p_contact)) < 5 THEN RETURN json_build_object('ok', false, 'reason', 'bad_contact'); END IF;
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  INSERT INTO verification_codes(contact, channel, code, expires_at) VALUES (trim(p_contact), p_channel, v_code, NOW() + interval '10 minutes');
  -- NOTE: actually SENDING the code (SMS/WhatsApp/email provider) is the part
  -- that needs a paid provider -- deliberately left for the day the flag turns on.
  RETURN json_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION lfh_verify_otp(p_contact text, p_code text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_on boolean; v_row verification_codes;
BEGIN
  SELECT COALESCE((features->>'verification')::boolean, false) INTO v_on FROM settings WHERE id = 'site';
  IF NOT v_on THEN RETURN json_build_object('ok', false, 'reason', 'disabled'); END IF;
  SELECT * INTO v_row FROM verification_codes
    WHERE contact = trim(p_contact) AND code = p_code AND NOT used AND expires_at > NOW()
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'wrong_or_expired'); END IF;
  UPDATE verification_codes SET used = true WHERE id = v_row.id;
  RETURN json_build_object('ok', true);
END; $$;
GRANT EXECUTE ON FUNCTION lfh_request_otp(text, text) TO anon;
GRANT EXECUTE ON FUNCTION lfh_verify_otp(text, text)  TO anon;

-- 3b. BACKEND-ONLY: payment + aggregator landing tables (flags 'payments' /
--     'aggregators', default OFF; no endpoint or screen references them yet)
CREATE TABLE IF NOT EXISTS payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,
  session_id  UUID REFERENCES sessions(id) ON DELETE SET NULL,
  amount      NUMERIC NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'INR',
  method      TEXT,                      -- cash / card / upi / gateway-name
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded')),
  gateway_ref TEXT,                      -- the provider's payment id, when one exists
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

CREATE TABLE IF NOT EXISTS aggregator_orders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source      TEXT NOT NULL CHECK (source IN ('zomato','swiggy','other')),
  external_id TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb, -- the raw order as the platform sent it
  status      TEXT NOT NULL DEFAULT 'received',
  order_id    UUID REFERENCES orders(id) ON DELETE SET NULL, -- linked once converted to a real order
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, external_id)
);

NOTIFY pgrst, 'reload schema';
