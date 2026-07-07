-- 143_bill_discount.sql
-- WHOLE-BILL (session-level) DISCOUNT for the tablet / waiter panel.
--
-- Design: the bill discount is stored on the SESSION, but APPLIED by splitting it
-- proportionally across the table's UNPAID, non-cancelled orders' existing
-- `orders.discount` column. Every money view in the app (tile due, printed bill, and all
-- owner/admin analytics) already reads `orders.discount` with the discount-BEFORE-tax rule,
-- so splitting keeps ALL of them correct with ZERO edits. Per-ticket discount and whole-bill
-- discount are mutually exclusive per session (enforced in the tablet route), so nothing
-- double-counts.
--
-- Partial-payment safe: the split spends only the discount NOT already settled on paid
-- orders (remaining = session.discount − Σ discount on paid orders), spread over the unpaid
-- orders — so paying part of a bill can never over-discount what's left.
--
-- ADDITIVE + idempotent. New functions are PUBLIC-executable by default, so both entry
-- functions are REVOKEd from PUBLIC/anon/authenticated and GRANTed only to service_role
-- (project gotcha, see migration 038).

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS discount      NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_note TEXT;

-- ── re-split core ────────────────────────────────────────────────────────────
-- Spread the session's REMAINING bill discount across its unpaid, non-cancelled orders in
-- proportion to each order's pre-tax subtotal, so Σ(unpaid order.discount) == the clamped
-- remaining discount EXACTLY (the last order absorbs the rounding remainder). Paid/cancelled
-- orders are never touched — their discount is already settled.
CREATE OR REPLACE FUNCTION lfh_split_bill_discount(p_session uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_D         numeric;      -- bill discount stored on the session
  v_paid      numeric;      -- discount already settled on PAID orders of this session
  v_remaining numeric;      -- discount still to spread over unpaid orders
  v_S         numeric;      -- Σ pre-tax subtotal of the UNPAID, non-cancelled orders
  v_clamp     numeric;      -- remaining clamped to [0, v_S]
  v_n         int;          -- count of unpaid, non-cancelled orders
  v_i         int := 0;
  v_acc       numeric := 0; -- running assigned total (for the remainder)
  v_share     numeric;
  r           record;
BEGIN
  IF p_session IS NULL THEN RETURN; END IF;

  SELECT COALESCE(discount, 0) INTO v_D FROM sessions WHERE id = p_session;
  IF v_D IS NULL THEN v_D := 0; END IF;

  SELECT COALESCE(SUM(COALESCE(discount, 0)), 0) INTO v_paid
    FROM orders
   WHERE session_id = p_session
     AND status <> 'cancelled'
     AND payment_status = 'paid';

  v_remaining := GREATEST(v_D - COALESCE(v_paid, 0), 0);

  SELECT COALESCE(SUM(COALESCE(subtotal, 0)), 0), COUNT(*)
    INTO v_S, v_n
    FROM orders
   WHERE session_id = p_session
     AND status <> 'cancelled'
     AND payment_status <> 'paid';

  v_clamp := LEAST(v_remaining, COALESCE(v_S, 0));

  -- Nothing to spread → zero every unpaid order's discount (so removing/using up a bill
  -- discount clears the tickets too).
  IF v_S IS NULL OR v_S <= 0 OR v_clamp <= 0 THEN
    UPDATE orders SET discount = 0
     WHERE session_id = p_session
       AND status <> 'cancelled'
       AND payment_status <> 'paid'
       AND COALESCE(discount, 0) <> 0;
    RETURN;
  END IF;

  FOR r IN
    SELECT id, COALESCE(subtotal, 0) AS sub
      FROM orders
     WHERE session_id = p_session
       AND status <> 'cancelled'
       AND payment_status <> 'paid'
     ORDER BY created_at, id
  LOOP
    v_i := v_i + 1;
    IF v_i = v_n THEN
      v_share := round(v_clamp - v_acc, 2);          -- last order takes the remainder
    ELSE
      v_share := round(v_clamp * r.sub / v_S, 2);
    END IF;
    IF v_share < 0      THEN v_share := 0;     END IF;
    IF v_share > r.sub  THEN v_share := r.sub; END IF; -- never exceed the order's own base
    v_acc := v_acc + v_share;
    UPDATE orders SET discount = v_share WHERE id = r.id;
  END LOOP;
END;
$$;

-- ── write entrypoint (called by the tablet route) ────────────────────────────
CREATE OR REPLACE FUNCTION lfh_staff_bill_discount(p_session uuid, p_amount numeric, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_paid numeric; v_S numeric; v_remaining numeric; v_clamp numeric;
BEGIN
  IF p_session IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_session'); END IF;

  UPDATE sessions
     SET discount      = GREATEST(COALESCE(p_amount, 0), 0),
         discount_note = NULLIF(p_note, '')
   WHERE id = p_session;

  PERFORM lfh_split_bill_discount(p_session);

  -- Report the effective (clamped, remaining) discount back to the caller.
  SELECT COALESCE(SUM(COALESCE(discount, 0)), 0) INTO v_paid
    FROM orders WHERE session_id = p_session AND status <> 'cancelled' AND payment_status = 'paid';
  SELECT COALESCE(SUM(COALESCE(subtotal, 0)), 0) INTO v_S
    FROM orders WHERE session_id = p_session AND status <> 'cancelled' AND payment_status <> 'paid';
  v_remaining := GREATEST(GREATEST(COALESCE(p_amount, 0), 0) - COALESCE(v_paid, 0), 0);
  v_clamp := LEAST(v_remaining, COALESCE(v_S, 0));
  RETURN jsonb_build_object('ok', true, 'discount', v_clamp);
END;
$$;

-- ── keep the split correct as the bill changes ───────────────────────────────
-- When an order is added/removed, or its subtotal/status/payment changes, on a session that
-- HAS a bill discount, re-split. The trigger deliberately does NOT watch `discount`, so the
-- split's own UPDATE of discount cannot re-fire it (no recursion). Cheap no-op for the common
-- case (session with no bill discount): one indexed lookup, then return.
CREATE OR REPLACE FUNCTION lfh_resplit_bill_discount() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_sess uuid; v_disc numeric;
BEGIN
  v_sess := COALESCE(NEW.session_id, OLD.session_id);
  IF v_sess IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(discount, 0) INTO v_disc FROM sessions WHERE id = v_sess;
  IF COALESCE(v_disc, 0) > 0 THEN
    PERFORM lfh_split_bill_discount(v_sess);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_resplit_bill_discount ON orders;
CREATE TRIGGER trg_resplit_bill_discount
  AFTER INSERT OR DELETE OR UPDATE OF subtotal, status, payment_status ON orders
  FOR EACH ROW EXECUTE FUNCTION lfh_resplit_bill_discount();

REVOKE ALL ON FUNCTION lfh_split_bill_discount(uuid)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_staff_bill_discount(uuid, numeric, text)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_resplit_bill_discount()                    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_split_bill_discount(uuid)                TO service_role;
GRANT EXECUTE ON FUNCTION lfh_staff_bill_discount(uuid, numeric, text) TO service_role;
