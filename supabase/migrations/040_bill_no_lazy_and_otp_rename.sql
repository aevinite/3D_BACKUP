-- Two clean-ups caught by the code review (2026-06-13).
--
-- 1. BILL NUMBER GAPS. Migration 036 assigned sessions.bill_no on every session
--    INSERT — but a session is created the instant a guest taps a table, even if
--    they never order and it auto-closes. That burned a bill number per tap, so
--    the day's real bills had large unexplained gaps. Fix: assign bill_no lazily
--    when the table's FIRST order lands, so numbers track actual billed tables.
--
-- 2. verify_otp NAME COLLISION. Migration 015 already has lfh_verify_otp(token,
--    phone,code) — the live session OTP path (lib/session.ts calls it). Migration
--    037 added a SECOND overload lfh_verify_otp(contact,code) for the dormant
--    backend-only verification system. Two overloads with one name is a footgun
--    (an unqualified DROP/REVOKE errors as "not unique"). Rename the backend-only
--    pair to lfh_request_verification / lfh_check_verification so the name is
--    unique and its purpose is obvious.

-- ── 1. bill_no assigned on first order, not on session open ─────────────────
DROP TRIGGER IF EXISTS trg_assign_bill ON sessions;
-- (the lfh_assign_bill function is now unused; leave it, harmless, in case an
--  old migration re-run expects it.)

CREATE OR REPLACE FUNCTION lfh_assign_bill_on_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- First order for this table's session gets the bill number; later orders
  -- on the same session keep it (the WHERE bill_no IS NULL no-ops).
  IF NEW.session_id IS NOT NULL THEN
    UPDATE sessions SET bill_no = lfh_next_counter('bill')
      WHERE id = NEW.session_id AND bill_no IS NULL;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_assign_bill_on_order ON orders;
-- AFTER INSERT so the order row already exists; runs inside the order RPCs
-- (SECURITY DEFINER), so it can update sessions regardless of RLS.
CREATE TRIGGER trg_assign_bill_on_order AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION lfh_assign_bill_on_order();

-- ── 2. rename the backend-only verification pair (drops the colliding overload) ─
DROP FUNCTION IF EXISTS lfh_request_otp(text, text);
DROP FUNCTION IF EXISTS lfh_verify_otp(text, text);   -- the 2-arg overload ONLY; the 3-arg session one is untouched

CREATE OR REPLACE FUNCTION lfh_request_verification(p_contact text, p_channel text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_on boolean; v_code text;
BEGIN
  SELECT COALESCE((features->>'verification')::boolean, false) INTO v_on FROM settings WHERE id = 'site';
  IF NOT v_on THEN RETURN json_build_object('ok', false, 'reason', 'disabled'); END IF;
  IF p_channel NOT IN ('sms','whatsapp','email') THEN RETURN json_build_object('ok', false, 'reason', 'bad_channel'); END IF;
  IF length(trim(p_contact)) < 5 THEN RETURN json_build_object('ok', false, 'reason', 'bad_contact'); END IF;
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  INSERT INTO verification_codes(contact, channel, code, expires_at) VALUES (trim(p_contact), p_channel, v_code, NOW() + interval '10 minutes');
  RETURN json_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION lfh_check_verification(p_contact text, p_code text)
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

GRANT EXECUTE ON FUNCTION lfh_request_verification(text, text) TO anon;
GRANT EXECUTE ON FUNCTION lfh_check_verification(text, text)  TO anon;

NOTIFY pgrst, 'reload schema';
