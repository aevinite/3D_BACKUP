-- ============================================================================
-- 211_customer_crm.sql — Customer CRM: capture name+number at bill time,
-- recognize repeat customers, link their device(s), forget devices after 12mo.
--
-- DPDP (India) shape baked in: nothing is stored without explicit consent
-- (p_consent), the guest greeting NEVER exposes the phone, device links are
-- pruned after 12 months (data minimisation), owner can erase a customer.
--
-- All changes are ADDITIVE (live-site safety). Extends the existing `customers`
-- table (PK (restaurant_id, phone), migs 014/079). Reuses the guest device_id
-- that the ban system already generates on session_members (mig 077) — we do
-- NOT invent a second fingerprint.
-- ============================================================================

-- ── 1. customers: real visit counter + consent ─────────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS visits     INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent    BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;

-- ── 2. customer_visits — idempotent, reversible visit ledger ────────────────
-- One row per settled bill (session). session_id UNIQUE ⇒ settling the same
-- bill twice can never double-count; deleting the row on un-pay reverses it.
-- No FK to sessions: pruning old sessions must NOT silently rewrite history.
CREATE TABLE IF NOT EXISTS customer_visits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  phone         text NOT NULL,
  session_id    uuid NOT NULL UNIQUE,
  at            timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_visits_cust ON customer_visits(restaurant_id, phone);
ALTER TABLE customer_visits ENABLE ROW LEVEL SECURITY;

-- ── 3. customer_devices — devices linked to a consented phone, with expiry ──
CREATE TABLE IF NOT EXISTS customer_devices (
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  phone         text NOT NULL,
  device_id     text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT NOW(),
  last_seen_at  timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (restaurant_id, phone, device_id)
);
-- the guest-greeting lookup path: by device within a restaurant, freshest first
CREATE INDEX IF NOT EXISTS idx_customer_devices_lookup
  ON customer_devices(restaurant_id, device_id, last_seen_at DESC);
ALTER TABLE customer_devices ENABLE ROW LEVEL SECURITY;

-- ── 4a. capture — called once after a bill settles (staff, service_role) ────
-- Resolves the table's most-recent session, upserts the customer (only with
-- consent), records ONE visit (idempotent per session), links that session's
-- guest devices, and lazily prunes this phone's device links older than 12mo.
DROP FUNCTION IF EXISTS lfh_capture_customer(uuid, text, text, text, boolean);
CREATE OR REPLACE FUNCTION lfh_capture_customer(
  p_restaurant_id uuid,
  p_table         text,
  p_phone         text,
  p_name          text,
  p_consent       boolean
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid   uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_phone text := NULLIF(regexp_replace(COALESCE(p_phone,''), '[^0-9]', '', 'g'), '');
  v_name  text := NULLIF(trim(COALESCE(p_name,'')), '');
  v_sid   uuid;
  v_ins   int;
BEGIN
  -- No consent or no number ⇒ store nothing (DPDP: opt-in only).
  IF NOT COALESCE(p_consent, false) OR v_phone IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_consent_or_phone');
  END IF;

  -- The bill's session (latest for this table — may already be closed post-settle).
  SELECT id INTO v_sid FROM sessions
    WHERE restaurant_id = v_rid AND table_number = p_table
    ORDER BY opened_at DESC LIMIT 1;

  -- Upsert the customer directory row.
  INSERT INTO customers(phone, name, restaurant_id, consent, consent_at, last_seen_at)
    VALUES (v_phone, v_name, v_rid, true, NOW(), NOW())
  ON CONFLICT (restaurant_id, phone) DO UPDATE SET
    name         = COALESCE(EXCLUDED.name, customers.name),
    consent      = true,
    consent_at   = COALESCE(customers.consent_at, NOW()),
    last_seen_at = NOW();

  -- One visit per session, idempotent. Only bump the counter on a NEW ledger row.
  IF v_sid IS NOT NULL THEN
    INSERT INTO customer_visits(restaurant_id, phone, session_id)
      VALUES (v_rid, v_phone, v_sid)
    ON CONFLICT (session_id) DO NOTHING;
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins = 1 THEN
      UPDATE customers SET visits = visits + 1
        WHERE restaurant_id = v_rid AND phone = v_phone;
    END IF;

    -- Link the devices the guests used in this session (best-effort).
    INSERT INTO customer_devices(restaurant_id, phone, device_id)
      SELECT DISTINCT v_rid, v_phone, m.device_id
        FROM session_members m
       WHERE m.session_id = v_sid AND m.device_id IS NOT NULL AND m.device_id <> ''
    ON CONFLICT (restaurant_id, phone, device_id)
      DO UPDATE SET last_seen_at = NOW();
  END IF;

  -- Retention: forget this phone's stale device links (data minimisation).
  DELETE FROM customer_devices
    WHERE restaurant_id = v_rid AND phone = v_phone
      AND last_seen_at < NOW() - interval '12 months';

  RETURN (SELECT json_build_object('ok', true, 'visits', visits, 'name', name)
            FROM customers WHERE restaurant_id = v_rid AND phone = v_phone);
END; $$;

-- ── 4b. uncapture — called when a settled bill is un-paid (reverses a visit) ─
DROP FUNCTION IF EXISTS lfh_uncapture_customer(uuid, text);
CREATE OR REPLACE FUNCTION lfh_uncapture_customer(
  p_restaurant_id uuid,
  p_table         text
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid   uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_sid   uuid;
  v_phone text;
BEGIN
  SELECT id INTO v_sid FROM sessions
    WHERE restaurant_id = v_rid AND table_number = p_table
    ORDER BY opened_at DESC LIMIT 1;
  IF v_sid IS NULL THEN RETURN json_build_object('ok', true, 'reversed', false); END IF;

  DELETE FROM customer_visits WHERE session_id = v_sid RETURNING phone INTO v_phone;
  IF v_phone IS NULL THEN RETURN json_build_object('ok', true, 'reversed', false); END IF;

  -- Never below zero. Devices stay linked (the person still owns them).
  UPDATE customers SET visits = GREATEST(visits - 1, 0)
    WHERE restaurant_id = v_rid AND phone = v_phone;
  RETURN json_build_object('ok', true, 'reversed', true);
END; $$;

-- ── 4c. greet — anon-callable guest-menu recognition BY DEVICE ──────────────
-- Returns the name + visit count for a returning device, ONLY if that customer
-- consented and isn't blocked. NEVER returns the phone number.
DROP FUNCTION IF EXISTS lfh_greet_device(uuid, text);
CREATE OR REPLACE FUNCTION lfh_greet_device(
  p_restaurant_id uuid,
  p_device_id     text
)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT json_build_object('known', true, 'name', c.name, 'visits', c.visits)
       FROM customer_devices d
       JOIN customers c
         ON c.restaurant_id = d.restaurant_id AND c.phone = d.phone
      WHERE d.restaurant_id = COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid)
        AND d.device_id = p_device_id
        AND d.last_seen_at > NOW() - interval '12 months'
        AND c.consent AND NOT c.blocked
        AND c.name IS NOT NULL
      ORDER BY d.last_seen_at DESC
      LIMIT 1),
    json_build_object('known', false));
$$;

-- ── 4d. extend recognize to also return the visit count ─────────────────────
-- (Edit the HIGHEST-numbered definition — mig 083 — to avoid a stale recreate
-- silently dropping this. Adds `visits`; keeps known/name/blocked shape.)
DROP FUNCTION IF EXISTS lfh_recognize_customer(text, uuid);
CREATE OR REPLACE FUNCTION lfh_recognize_customer(
  p_phone text,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT json_build_object('known', true, 'name', name, 'blocked', blocked, 'visits', visits)
       FROM customers
      WHERE phone = regexp_replace(COALESCE(p_phone,''), '[^0-9]', '', 'g')
        AND restaurant_id = COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid)),
    json_build_object('known', false));
$$;

-- ── 5. Permissions (mig-038 gotcha: new funcs are PUBLIC by default) ────────
REVOKE ALL ON FUNCTION lfh_capture_customer(uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_capture_customer(uuid, text, text, text, boolean) TO service_role;

REVOKE ALL ON FUNCTION lfh_uncapture_customer(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_uncapture_customer(uuid, text) TO service_role;

-- recognize is used by staff endpoints (service_role) AND by the existing guest
-- join flow (anon) — keep it anon-callable as before, plus service_role.
GRANT  EXECUTE ON FUNCTION lfh_recognize_customer(text, uuid) TO anon, authenticated, service_role;

-- greet is the ONE new anon-callable RPC (guest menu). It never exposes a phone.
GRANT  EXECUTE ON FUNCTION lfh_greet_device(uuid, text) TO anon, authenticated, service_role;
