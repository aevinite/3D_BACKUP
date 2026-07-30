-- 233_customer_visit_follows_the_bill.sql
--
-- SAME ROOT AS mig 232, A DIFFERENT SURFACE. The owner asked for the whole class to be hunted
-- down after a freshly-opened table showed the previous party's food. This is the other place
-- that decided "whose is this?" by TABLE NUMBER instead of by the party:
--
--   lfh_capture_customer / lfh_uncapture_customer (mig 212) resolved the bill's session as
--     "SELECT id FROM sessions WHERE table_number = p_table ORDER BY opened_at DESC LIMIT 1"
--
-- i.e. the LATEST party ever seated at that table — not the party whose bill is in front of
-- the person tapping. Reproduced on the dev DB (scripts/verify-two-parties.mjs, which fails on
-- the old code and passes on this one):
--
--   • Party A pays at T29 and gives a phone number. A leaves, party B is seated. Saving A's
--     customer now books the visit on **B's session** and links **B's guests' devices** to A's
--     phone number: the wrong guest gets the loyalty visit, and one person's number ends up
--     attached to another person's phone (DPDP-relevant, not just untidy).
--   • Reverting A's payment (allowed for 30 minutes) calls uncapture → it DELETED the visit row
--     of whatever party is at the table NOW (B's), and left A's visit standing. So the refunded
--     guest kept their visit and an innocent party lost theirs.
--
-- FIX: both functions take the bill's session id and use it. The session must belong to the
-- acting restaurant (never trust a client-supplied id). p_session stays OPTIONAL and last, so
-- (a) old 5-arg / 2-arg callers keep working during a deploy — no failure window — and
-- (b) a sessions-OFF restaurant, which has no session at all, still behaves as before.
-- When p_session is NULL we now prefer the table's *currently OPEN* session and only fall back
-- to "latest ever" if there is none — strictly closer to "the party being billed" than before.

DROP FUNCTION IF EXISTS lfh_capture_customer(uuid, text, text, text, boolean);
CREATE OR REPLACE FUNCTION lfh_capture_customer(
  p_restaurant_id uuid,
  p_table         text,
  p_phone         text,
  p_name          text,
  p_consent       boolean,
  p_session       uuid DEFAULT NULL      -- the session of the BILL being settled
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

  -- WHOSE BILL IS THIS? The caller's session wins, but only if it really is this
  -- restaurant's session (the id arrives from a panel, so it is never trusted blindly).
  IF p_session IS NOT NULL THEN
    SELECT id INTO v_sid FROM sessions WHERE id = p_session AND restaurant_id = v_rid;
  END IF;
  -- No session given (old caller, or a sessions-off restaurant): the table's OPEN party
  -- first — that is who is being billed — and only then the most recent one ever seated.
  IF v_sid IS NULL THEN
    SELECT id INTO v_sid FROM sessions
      WHERE restaurant_id = v_rid AND table_number = p_table AND status = 'open'
      ORDER BY last_activity_at DESC LIMIT 1;
  END IF;
  IF v_sid IS NULL THEN
    SELECT id INTO v_sid FROM sessions
      WHERE restaurant_id = v_rid AND table_number = p_table
      ORDER BY opened_at DESC LIMIT 1;
  END IF;

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

    -- Link the devices the guests used in THIS session (best-effort).
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

DROP FUNCTION IF EXISTS lfh_uncapture_customer(uuid, text);
CREATE OR REPLACE FUNCTION lfh_uncapture_customer(
  p_restaurant_id uuid,
  p_table         text,
  p_session       uuid DEFAULT NULL      -- the session of the BILL being un-paid
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid   uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_sid   uuid;
  v_phone text;
BEGIN
  -- Reversing a payment must reverse THAT bill's visit. Resolving by table number is what
  -- deleted an innocent party's visit row when the table had already been re-seated.
  IF p_session IS NOT NULL THEN
    SELECT id INTO v_sid FROM sessions WHERE id = p_session AND restaurant_id = v_rid;
  END IF;
  IF v_sid IS NULL THEN
    SELECT id INTO v_sid FROM sessions
      WHERE restaurant_id = v_rid AND table_number = p_table AND status = 'open'
      ORDER BY last_activity_at DESC LIMIT 1;
  END IF;
  IF v_sid IS NULL THEN
    SELECT id INTO v_sid FROM sessions
      WHERE restaurant_id = v_rid AND table_number = p_table
      ORDER BY opened_at DESC LIMIT 1;
  END IF;
  IF v_sid IS NULL THEN RETURN json_build_object('ok', true, 'reversed', false); END IF;

  DELETE FROM customer_visits WHERE session_id = v_sid RETURNING phone INTO v_phone;
  IF v_phone IS NULL THEN RETURN json_build_object('ok', true, 'reversed', false); END IF;

  -- Never below zero. Devices stay linked (the person still owns them).
  UPDATE customers SET visits = GREATEST(visits - 1, 0)
    WHERE restaurant_id = v_rid AND phone = v_phone;
  RETURN json_build_object('ok', true, 'reversed', true);
END; $$;

-- Staff-only, as in mig 212 (new functions are PUBLIC-executable by default — mig 038's rule).
REVOKE ALL ON FUNCTION lfh_capture_customer(uuid, text, text, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_capture_customer(uuid, text, text, text, boolean, uuid) TO service_role;
REVOKE ALL ON FUNCTION lfh_uncapture_customer(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_uncapture_customer(uuid, text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
