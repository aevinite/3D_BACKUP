-- 403_loyalty_rules_and_corrections.sql — the two things mig 401 deliberately left (owner, 2026-09-20)
--
-- 401 shipped loyalty with the rules HARD-CODED to their defaults (5 points per ₹100, 1 point = ₹1,
-- minimum 100) and with `loyalty_ledger.kind = 'adjust'` defined but written by nothing. So a
-- restaurant could not choose how generous its scheme was, and a balance that went wrong could only
-- be fixed by editing the database by hand. Both are closed here.
--
-- STILL GATED THE SAME WAY. Both functions call lfh_loyalty_on() first, so with the module off they
-- refuse exactly as every other loyalty function does — the owner's rule from 2026-09-19 ("if it's
-- on then only everything will change otherwise everything will be as it is right now") holds for
-- these two as well.

-- ── 1. SET THE RULES ─────────────────────────────────────────────────────────
-- Upsert, so a restaurant that has never opened the screen has no row and reads the defaults out of
-- lfh_loyalty_rules(). The bounds are the table's own CHECK constraints restated as plain refusals:
-- a CHECK violation reaches a person as a Postgres string, and this screen is the owner's.
DROP FUNCTION IF EXISTS lfh_loyalty_set_rules(uuid, integer, integer, integer, integer);
CREATE OR REPLACE FUNCTION lfh_loyalty_set_rules(
  p_restaurant_id    uuid,
  p_earn_per_100     integer,
  p_point_value_paise integer,
  p_min_redeem       integer,
  p_max_redeem_pct   integer
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT lfh_loyalty_on(p_restaurant_id) THEN
    RETURN json_build_object('ok', false, 'reason', 'loyalty_off');
  END IF;
  IF p_earn_per_100 IS NULL OR p_earn_per_100 < 0 OR p_earn_per_100 > 1000
     OR p_point_value_paise IS NULL OR p_point_value_paise < 1 OR p_point_value_paise > 100000
     OR p_min_redeem IS NULL OR p_min_redeem < 0
     OR p_max_redeem_pct IS NULL OR p_max_redeem_pct < 1 OR p_max_redeem_pct > 100 THEN
    RETURN json_build_object('ok', false, 'reason', 'out_of_range');
  END IF;

  INSERT INTO loyalty_config(restaurant_id, earn_per_100, point_value_paise, min_redeem, max_redeem_pct, updated_at)
    VALUES (p_restaurant_id, p_earn_per_100, p_point_value_paise, p_min_redeem, p_max_redeem_pct, NOW())
  ON CONFLICT (restaurant_id) DO UPDATE SET
    earn_per_100      = EXCLUDED.earn_per_100,
    point_value_paise = EXCLUDED.point_value_paise,
    min_redeem        = EXCLUDED.min_redeem,
    max_redeem_pct    = EXCLUDED.max_redeem_pct,
    updated_at        = NOW();

  RETURN json_build_object('ok', true);
END; $$;

-- ── 2. CORRECT A BALANCE BY HAND ─────────────────────────────────────────────
-- A LEDGER ROW, NOT AN EDIT. The whole reason 401 stores a ledger is that a balance must be able to
-- explain itself; a correction that quietly moved `customers.points` would be the one entry in a
-- guest's history with no row behind it. `session_id` is NULL because a correction belongs to no
-- bill — which is exactly why the unique index that keeps one earn and one redeem per bill does not
-- catch it, and a guest may be corrected as many times as needed.
--
-- THE FLOOR IS DELIBERATE. A negative delta larger than the balance takes it to 0 and the ledger
-- records what was ACTUALLY taken, not what was asked for, so the rows still sum to the balance.
-- A ledger that does not foot to the cache is worse than no ledger.
DROP FUNCTION IF EXISTS lfh_loyalty_adjust(uuid, text, integer, text, text);
CREATE OR REPLACE FUNCTION lfh_loyalty_adjust(
  p_restaurant_id uuid,
  p_phone         text,
  p_delta         integer,
  p_note          text,
  p_by            text
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone text := NULLIF(regexp_replace(COALESCE(p_phone,''), '[^0-9]', '', 'g'), '');
  v_bal   integer;
  v_move  integer;
BEGIN
  IF NOT lfh_loyalty_on(p_restaurant_id) THEN
    RETURN json_build_object('ok', false, 'reason', 'loyalty_off');
  END IF;
  IF v_phone IS NULL OR COALESCE(p_delta, 0) = 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'nothing_to_change');
  END IF;
  -- A correction has to say WHY. It is the only way points move without a bill behind them, so the
  -- reason is the whole audit trail.
  IF NULLIF(trim(COALESCE(p_note,'')), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'reason_required');
  END IF;

  -- Lock the row, then read from inside the lock — the same discipline the redeem uses, so a
  -- correction and a redeem happening together cannot both act on the same stale balance.
  SELECT points INTO v_bal FROM customers
    WHERE restaurant_id = p_restaurant_id AND phone = v_phone FOR UPDATE;
  IF v_bal IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'unknown_guest'); END IF;

  v_move := GREATEST(p_delta, -v_bal);          -- never below zero; record what really moved
  IF v_move = 0 THEN
    RETURN json_build_object('ok', true, 'moved', 0, 'balance', v_bal);
  END IF;

  INSERT INTO loyalty_ledger(restaurant_id, phone, session_id, kind, points, note, by_staff)
    VALUES (p_restaurant_id, v_phone, NULL, 'adjust', v_move,
            left(trim(p_note), 200), NULLIF(trim(COALESCE(p_by,'')), ''));

  UPDATE customers SET points = points + v_move
    WHERE restaurant_id = p_restaurant_id AND phone = v_phone;

  RETURN json_build_object('ok', true, 'moved', v_move, 'balance', v_bal + v_move);
END; $$;

-- ── 3. A GUEST'S OWN POINTS HISTORY ──────────────────────────────────────────
-- So a correction can be justified to the guest standing there. Scoped, column-listed and capped —
-- never "every row for this restaurant then filter in code".
DROP FUNCTION IF EXISTS lfh_loyalty_history(uuid, text, integer);
CREATE OR REPLACE FUNCTION lfh_loyalty_history(p_restaurant_id uuid, p_phone text, p_limit integer DEFAULT 20)
RETURNS TABLE(kind text, points integer, bill_total numeric, note text, by_staff text, at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.kind, l.points, l.bill_total, l.note, l.by_staff, l.at
    FROM loyalty_ledger l
   WHERE l.restaurant_id = p_restaurant_id
     AND l.phone = NULLIF(regexp_replace(COALESCE(p_phone,''), '[^0-9]', '', 'g'), '')
   ORDER BY l.at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
$$;

-- ── 4. GRANTS — a new function is PUBLIC-executable by default (mig 038/267) ──
REVOKE ALL ON FUNCTION lfh_loyalty_set_rules(uuid, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_loyalty_adjust(uuid, text, integer, text, text)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_loyalty_history(uuid, text, integer)                         FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_loyalty_set_rules(uuid, integer, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION lfh_loyalty_adjust(uuid, text, integer, text, text)              TO service_role;
GRANT EXECUTE ON FUNCTION lfh_loyalty_history(uuid, text, integer)                         TO service_role;
