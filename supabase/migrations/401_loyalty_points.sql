-- 401_loyalty_points.sql — LOYALTY POINTS (owner, 2026-09-19)
--
-- Guests earn points on a bill and spend them as a discount on a later visit. There is NO
-- messaging of any kind in this feature and that is the design, not an omission: the points are
-- printed on the bill the guest is already holding and shown to the cashier at the till, which is
-- why it costs ₹0 a month to run. The costing that decided this against WhatsApp — and the parked
-- guest-screen version — are in docs/LOYALTY-PLAN.md.
--
-- OFF MUST MEAN NOTHING CHANGES (owner, 2026-09-19: "if it's on then only everything will change
-- otherwise everything will be as it is right now"). Two things make that true here:
--   · the switch is settings.modules.loyalty.allowed, and an ABSENT entry reads as OFF — so this
--     migration changes no restaurant's behaviour on the day it runs;
--   · every function below re-reads that switch itself and refuses when it is off. The routes
--     check the ladder too, but a route that forgets must not be able to write a point.
--
-- IDENTITY is (restaurant_id, phone) — the customers PK since mig 079 — and the unit of earning
-- is the SESSION, exactly like customer_visits since mig 212. One party = one session = one bill
-- = one earn row, so a merged party earns once, and un-paying a bill reverses precisely what it
-- granted. That is also why this is a LEDGER and not a counter on customers: a bare integer
-- cannot be audited and cannot be reversed. customers.points is a CACHE these functions maintain.

-- ── 1. the rules, per restaurant ─────────────────────────────────────────────
-- Its own table rather than columns on `settings`: that row is already 111 columns wide and a new
-- module adds none (mig 326). Every restaurant that switches loyalty on gets a row lazily.
CREATE TABLE IF NOT EXISTS loyalty_config (
  restaurant_id    uuid PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
  -- "5 points for every ₹100 spent" — whole points, rounded DOWN, on the bill total.
  earn_per_100     integer NOT NULL DEFAULT 5  CHECK (earn_per_100 BETWEEN 0 AND 1000),
  -- what ONE point is worth when spent, in paise. 100 = ₹1 a point.
  point_value_paise integer NOT NULL DEFAULT 100 CHECK (point_value_paise BETWEEN 1 AND 100000),
  -- the guest cannot spend a trickle; below this the Redeem button stays out of the way.
  min_redeem       integer NOT NULL DEFAULT 100 CHECK (min_redeem >= 0),
  -- points may never pay for more than this share of a bill (100 = the whole bill).
  max_redeem_pct   integer NOT NULL DEFAULT 100 CHECK (max_redeem_pct BETWEEN 1 AND 100),
  updated_at       timestamptz NOT NULL DEFAULT NOW()
);
ALTER TABLE loyalty_config ENABLE ROW LEVEL SECURITY;

-- ── 2. the ledger — the truth ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  phone         text NOT NULL,
  -- the bill this row belongs to. NULL only for a hand correction, which belongs to no bill.
  session_id    uuid,
  kind          text NOT NULL CHECK (kind IN ('earn','redeem','adjust')),
  -- SIGNED: earn is positive, redeem is negative, a correction is either. The balance is the SUM,
  -- so a reversal is a deletion of the exact row that granted it and can never drift.
  points        integer NOT NULL,
  -- what the bill came to when the points were earned — kept so a rate change cannot rewrite
  -- history, and so the audit can answer "why 27 points?" years later.
  bill_total    numeric(12,2),
  note          text,
  by_staff      text,
  at            timestamptz NOT NULL DEFAULT NOW()
);
ALTER TABLE loyalty_ledger ENABLE ROW LEVEL SECURITY;

-- ONE earn and ONE redeem per bill. A partial index so a hand correction (session_id NULL, and
-- several allowed per guest) is not caught by it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_ledger_bill
  ON loyalty_ledger(session_id, kind) WHERE session_id IS NOT NULL AND kind IN ('earn','redeem');
-- the balance read: every row for one guest at one restaurant.
CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_guest
  ON loyalty_ledger(restaurant_id, phone);
-- the owner's "points given this month" read — scoped and time-ordered, never a full scan.
CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_when
  ON loyalty_ledger(restaurant_id, at DESC);

-- ── 3. the cached balance on the customer row ────────────────────────────────
-- A CACHE, not the truth (see the header). It exists so the till can show a balance from the row
-- it is already reading, instead of summing the ledger on every keystroke.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS points integer NOT NULL DEFAULT 0;

-- ── 4. is loyalty switched on for this restaurant? ───────────────────────────
-- The SAME question lib/tableTags.ts loyaltyLadder() answers, asked in SQL so a route that forgets
-- to check cannot write a point. Absent bag entry ⇒ false ⇒ the feature does not exist here.
CREATE OR REPLACE FUNCTION lfh_loyalty_on(p_restaurant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (s.modules -> 'loyalty' ->> 'allowed')::boolean
      AND COALESCE((s.modules -> 'loyalty' ->> 'enabled')::boolean, true),
    false)
  FROM settings s WHERE s.restaurant_id = p_restaurant_id;
$$;

-- ── 5. the rules for one restaurant, with the defaults filled in ─────────────
CREATE OR REPLACE FUNCTION lfh_loyalty_rules(p_restaurant_id uuid)
RETURNS loyalty_config LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r loyalty_config;
BEGIN
  SELECT * INTO r FROM loyalty_config WHERE restaurant_id = p_restaurant_id;
  IF NOT FOUND THEN
    r.restaurant_id := p_restaurant_id; r.earn_per_100 := 5; r.point_value_paise := 100;
    r.min_redeem := 100; r.max_redeem_pct := 100; r.updated_at := NOW();
  END IF;
  RETURN r;
END; $$;

-- ── 6. EARN — rides the settle, idempotent per bill ──────────────────────────
-- Called right after lfh_capture_customer on the same settle. Resolves the bill's session the
-- same way capture does, so the two can never disagree about which bill this was.
DROP FUNCTION IF EXISTS lfh_loyalty_earn(uuid, text, text, numeric);
DROP FUNCTION IF EXISTS lfh_loyalty_earn(uuid, text, text, numeric, uuid);
CREATE OR REPLACE FUNCTION lfh_loyalty_earn(
  p_restaurant_id uuid,
  p_table         text,
  p_phone         text,
  p_total         numeric,
  p_session       uuid DEFAULT NULL      -- the session of the BILL being settled (mig 233 rule)
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone text := NULLIF(regexp_replace(COALESCE(p_phone,''), '[^0-9]', '', 'g'), '');
  v_rules loyalty_config;
  v_sid   uuid;
  v_pts   integer;
  v_ins   int;
BEGIN
  IF NOT lfh_loyalty_on(p_restaurant_id) THEN
    RETURN json_build_object('ok', false, 'reason', 'loyalty_off');
  END IF;
  IF v_phone IS NULL OR COALESCE(p_total, 0) <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_phone_or_total');
  END IF;
  -- Never invent a guest. Points attach to a customer the till already captured WITH consent
  -- (DPDP, mig 212): no consent, no row here, no points.
  IF NOT EXISTS (SELECT 1 FROM customers
                  WHERE restaurant_id = p_restaurant_id AND phone = v_phone AND consent = true) THEN
    RETURN json_build_object('ok', false, 'reason', 'no_consented_customer');
  END IF;

  v_rules := lfh_loyalty_rules(p_restaurant_id);
  -- Rounded DOWN, on a NUMERIC — never a float. ₹555.55 ÷ a rate has bitten this codebase before.
  v_pts := floor(p_total * v_rules.earn_per_100 / 100.0)::integer;
  IF v_pts <= 0 THEN RETURN json_build_object('ok', true, 'earned', 0); END IF;

  -- WHOSE BILL. The SAME resolution lfh_capture_customer has used since mig 233, and for the same
  -- reason: "the latest session at this table" is the party seated NEXT, so points landed on the
  -- wrong guest the moment a table turned over. The id arrives from a panel, so it is checked
  -- against this restaurant before it is trusted; with none given, the table's OPEN party first
  -- and only then the most recent one ever seated.
  IF p_session IS NOT NULL THEN
    SELECT id INTO v_sid FROM sessions WHERE id = p_session AND restaurant_id = p_restaurant_id;
  END IF;
  IF v_sid IS NULL THEN
    SELECT id INTO v_sid FROM sessions
      WHERE restaurant_id = p_restaurant_id AND table_number = p_table AND status = 'open'
      ORDER BY last_activity_at DESC LIMIT 1;
  END IF;
  IF v_sid IS NULL THEN
    SELECT id INTO v_sid FROM sessions
      WHERE restaurant_id = p_restaurant_id AND table_number = p_table
      ORDER BY opened_at DESC LIMIT 1;
  END IF;
  IF v_sid IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'no_session'); END IF;

  INSERT INTO loyalty_ledger(restaurant_id, phone, session_id, kind, points, bill_total)
    VALUES (p_restaurant_id, v_phone, v_sid, 'earn', v_pts, p_total)
  ON CONFLICT (session_id, kind) WHERE session_id IS NOT NULL AND kind IN ('earn','redeem') DO NOTHING;
  GET DIAGNOSTICS v_ins = ROW_COUNT;
  IF v_ins = 1 THEN
    UPDATE customers SET points = points + v_pts
      WHERE restaurant_id = p_restaurant_id AND phone = v_phone;
  END IF;

  RETURN (SELECT json_build_object('ok', true, 'earned', CASE WHEN v_ins = 1 THEN v_pts ELSE 0 END,
                                   'balance', points)
            FROM customers WHERE restaurant_id = p_restaurant_id AND phone = v_phone);
END; $$;

-- ── 7. REVERSE — un-paying a bill takes back exactly what that bill gave ─────
-- Deletes the earn row for the session, not "some points": if the rate changed in between, the
-- guest still loses precisely the points that bill granted. A redeem is NOT reversed here — the
-- money came off a bill that is being reopened, so the points stay spent until the bill is
-- settled again or an admin corrects it by hand, which is the audited route.
DROP FUNCTION IF EXISTS lfh_loyalty_reverse(uuid, text);
DROP FUNCTION IF EXISTS lfh_loyalty_reverse(uuid, text, uuid);
CREATE OR REPLACE FUNCTION lfh_loyalty_reverse(
  p_restaurant_id uuid,
  p_table         text,
  p_session       uuid DEFAULT NULL      -- the session of the BILL being un-paid (mig 233 rule)
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sid uuid; v_phone text; v_pts integer;
BEGIN
  -- WHOSE BILL. The SAME resolution lfh_capture_customer has used since mig 233, and for the same
  -- reason: "the latest session at this table" is the party seated NEXT, so points landed on the
  -- wrong guest the moment a table turned over. The id arrives from a panel, so it is checked
  -- against this restaurant before it is trusted; with none given, the table's OPEN party first
  -- and only then the most recent one ever seated.
  IF p_session IS NOT NULL THEN
    SELECT id INTO v_sid FROM sessions WHERE id = p_session AND restaurant_id = p_restaurant_id;
  END IF;
  IF v_sid IS NULL THEN
    SELECT id INTO v_sid FROM sessions
      WHERE restaurant_id = p_restaurant_id AND table_number = p_table AND status = 'open'
      ORDER BY last_activity_at DESC LIMIT 1;
  END IF;
  IF v_sid IS NULL THEN
    SELECT id INTO v_sid FROM sessions
      WHERE restaurant_id = p_restaurant_id AND table_number = p_table
      ORDER BY opened_at DESC LIMIT 1;
  END IF;
  IF v_sid IS NULL THEN RETURN json_build_object('ok', true, 'reversed', 0); END IF;

  DELETE FROM loyalty_ledger
    WHERE restaurant_id = p_restaurant_id AND session_id = v_sid AND kind = 'earn'
    RETURNING phone, points INTO v_phone, v_pts;
  IF v_phone IS NULL THEN RETURN json_build_object('ok', true, 'reversed', 0); END IF;

  UPDATE customers SET points = GREATEST(0, points - v_pts)
    WHERE restaurant_id = p_restaurant_id AND phone = v_phone;
  RETURN json_build_object('ok', true, 'reversed', v_pts);
END; $$;

-- ── 8. REDEEM — turning points into money off the bill in front of the guest ─
-- Returns the DISCOUNT IN RUPEES the till should apply. It does not touch the bill itself: the
-- money is applied through the panel's existing discount path, which already gets tax order and
-- the audit row right. Two tills cannot spend the same balance twice — the row is locked, the
-- balance re-read inside the lock, and one earn/redeem per bill is a unique index besides.
DROP FUNCTION IF EXISTS lfh_loyalty_redeem(uuid, text, text, integer, text);
DROP FUNCTION IF EXISTS lfh_loyalty_redeem(uuid, text, text, integer, text, uuid);
CREATE OR REPLACE FUNCTION lfh_loyalty_redeem(
  p_restaurant_id uuid,
  p_table         text,
  p_phone         text,
  p_points        integer,
  p_by            text,
  p_session       uuid DEFAULT NULL      -- the session of the BILL being settled (mig 233 rule)
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone text := NULLIF(regexp_replace(COALESCE(p_phone,''), '[^0-9]', '', 'g'), '');
  v_rules loyalty_config;
  v_sid   uuid;
  v_bal   integer;
  v_rupees numeric(12,2);
BEGIN
  IF NOT lfh_loyalty_on(p_restaurant_id) THEN
    RETURN json_build_object('ok', false, 'reason', 'loyalty_off');
  END IF;
  IF v_phone IS NULL OR COALESCE(p_points, 0) <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'nothing_to_spend');
  END IF;

  v_rules := lfh_loyalty_rules(p_restaurant_id);
  IF p_points < v_rules.min_redeem THEN
    RETURN json_build_object('ok', false, 'reason', 'below_minimum', 'min', v_rules.min_redeem);
  END IF;

  -- LOCK the customer row, then read the balance from inside the lock. Without this the second
  -- till reads the same balance as the first and both are "allowed" to spend it.
  SELECT points INTO v_bal FROM customers
    WHERE restaurant_id = p_restaurant_id AND phone = v_phone FOR UPDATE;
  IF v_bal IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'unknown_guest'); END IF;
  IF v_bal < p_points THEN
    RETURN json_build_object('ok', false, 'reason', 'not_enough_points', 'balance', v_bal);
  END IF;

  -- WHOSE BILL. The SAME resolution lfh_capture_customer has used since mig 233, and for the same
  -- reason: "the latest session at this table" is the party seated NEXT, so points landed on the
  -- wrong guest the moment a table turned over. The id arrives from a panel, so it is checked
  -- against this restaurant before it is trusted; with none given, the table's OPEN party first
  -- and only then the most recent one ever seated.
  IF p_session IS NOT NULL THEN
    SELECT id INTO v_sid FROM sessions WHERE id = p_session AND restaurant_id = p_restaurant_id;
  END IF;
  IF v_sid IS NULL THEN
    SELECT id INTO v_sid FROM sessions
      WHERE restaurant_id = p_restaurant_id AND table_number = p_table AND status = 'open'
      ORDER BY last_activity_at DESC LIMIT 1;
  END IF;
  IF v_sid IS NULL THEN
    SELECT id INTO v_sid FROM sessions
      WHERE restaurant_id = p_restaurant_id AND table_number = p_table
      ORDER BY opened_at DESC LIMIT 1;
  END IF;
  IF v_sid IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'no_session'); END IF;

  INSERT INTO loyalty_ledger(restaurant_id, phone, session_id, kind, points, by_staff)
    VALUES (p_restaurant_id, v_phone, v_sid, 'redeem', -p_points, NULLIF(trim(COALESCE(p_by,'')), ''));

  UPDATE customers SET points = points - p_points
    WHERE restaurant_id = p_restaurant_id AND phone = v_phone;

  v_rupees := ROUND(p_points * v_rules.point_value_paise / 100.0, 2);
  RETURN json_build_object('ok', true, 'spent', p_points, 'rupees', v_rupees, 'balance', v_bal - p_points);
END; $$;

-- ── 9. STATE — what the till shows when a number is typed in ─────────────────
-- ONE row, explicit columns, no scan. Returns the rules alongside so the panel can work out what
-- the Redeem button should offer without a second call.
DROP FUNCTION IF EXISTS lfh_loyalty_state(uuid, text);
CREATE OR REPLACE FUNCTION lfh_loyalty_state(p_restaurant_id uuid, p_phone text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone text := NULLIF(regexp_replace(COALESCE(p_phone,''), '[^0-9]', '', 'g'), '');
  v_rules loyalty_config;
  v_bal   integer;
BEGIN
  IF NOT lfh_loyalty_on(p_restaurant_id) THEN
    RETURN json_build_object('on', false);
  END IF;
  v_rules := lfh_loyalty_rules(p_restaurant_id);
  SELECT points INTO v_bal FROM customers
    WHERE restaurant_id = p_restaurant_id AND phone = COALESCE(v_phone, '');
  RETURN json_build_object(
    'on', true,
    'balance', COALESCE(v_bal, 0),
    'earn_per_100', v_rules.earn_per_100,
    'point_value_paise', v_rules.point_value_paise,
    'min_redeem', v_rules.min_redeem,
    'max_redeem_pct', v_rules.max_redeem_pct);
END; $$;

-- ── 10. GRANTS — a new function is PUBLIC-executable by default ──────────────
-- The mig 038/267 lesson. Every one of these is staff-only and reached through a route that has
-- already checked who is asking; none may be callable by anon or a signed-in guest.
-- Guarded by `npm run verify:grants`.
REVOKE ALL ON FUNCTION lfh_loyalty_on(uuid)                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_loyalty_rules(uuid)                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_loyalty_earn(uuid, text, text, numeric, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_loyalty_reverse(uuid, text, uuid)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_loyalty_redeem(uuid, text, text, integer, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_loyalty_state(uuid, text)                     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_loyalty_on(uuid)                              TO service_role;
GRANT EXECUTE ON FUNCTION lfh_loyalty_rules(uuid)                           TO service_role;
GRANT EXECUTE ON FUNCTION lfh_loyalty_earn(uuid, text, text, numeric, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION lfh_loyalty_reverse(uuid, text, uuid)             TO service_role;
GRANT EXECUTE ON FUNCTION lfh_loyalty_redeem(uuid, text, text, integer, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION lfh_loyalty_state(uuid, text)                     TO service_role;
