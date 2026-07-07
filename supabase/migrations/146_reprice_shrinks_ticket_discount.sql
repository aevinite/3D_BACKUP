-- 146_reprice_shrinks_ticket_discount.sql
-- Keep a PER-TICKET discount honest when the order is later re-priced.
--
-- Bug (2026-07-07 tablet audit): a per-order discount is stored as an absolute ₹ amount on
-- `orders.discount`. Every money view shows the bill as `total − discount×(1+rate)` (discount
-- BEFORE tax; `orders.total` is the GROSS, tax-inclusive figure and never includes the
-- discount). The re-price RPCs (delete-item / edit-qty / add-item) recompute subtotal/tax/
-- total but NEVER touch `discount`. So a "50% off" on a ₹1000 order stays ₹500 after a dish is
-- removed → on a now-₹500 order the due computes to ₹0 and the guest pays nothing (or, if a
-- dish is ADDED, the discount is now too small and the guest is over-charged).
--
-- The whole-BILL discount (mig 143) already re-splits on every subtotal change via
-- trg_resplit_bill_discount, so it was already safe. This migration extends that SAME trigger
-- to also handle the per-ticket case (a session with NO bill discount, or an order with no
-- session): when an order's pre-tax subtotal changes, scale its own `discount` by the same
-- ratio, clamped to [0, new subtotal]. Because `orders.total` is gross (discount applied only
-- at read time), rescaling `discount` alone keeps EVERY money view consistent — no other edits.
--
-- No recursion: the trigger watches only (subtotal, status, payment_status); the UPDATE below
-- touches only `discount`, so it cannot re-fire the trigger (same guarantee mig 143 relies on).
-- ADDITIVE + idempotent (CREATE OR REPLACE of the existing trigger function).

CREATE OR REPLACE FUNCTION lfh_resplit_bill_discount() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess   uuid;
  v_disc   numeric;
  v_old    numeric;   -- OLD pre-tax subtotal
  v_new    numeric;   -- NEW pre-tax subtotal
  v_od     numeric;   -- this order's current discount
  v_scaled numeric;
BEGIN
  v_sess := COALESCE(NEW.session_id, OLD.session_id);

  -- Whole-bill discount active on this session → let the proportional split own every
  -- ticket's discount (unchanged behaviour from mig 143).
  IF v_sess IS NOT NULL THEN
    SELECT COALESCE(discount, 0) INTO v_disc FROM sessions WHERE id = v_sess;
    IF COALESCE(v_disc, 0) > 0 THEN
      PERFORM lfh_split_bill_discount(v_sess);
      RETURN NULL;
    END IF;
  END IF;

  -- No whole-bill discount: keep a PER-TICKET discount in proportion to the (changed) pre-tax
  -- subtotal, so removing/reducing a dish shrinks the comp instead of driving the bill to zero
  -- or negative. Only meaningful on an UPDATE that actually moved the subtotal.
  IF TG_OP = 'UPDATE' AND NEW.id IS NOT NULL THEN
    v_od := COALESCE(NEW.discount, 0);
    IF v_od > 0 THEN
      v_old := COALESCE(OLD.subtotal, 0);
      v_new := COALESCE(NEW.subtotal, 0);
      IF v_new <= 0 THEN
        v_scaled := 0;                                   -- no food left → no discount
      ELSIF v_old > 0 AND v_new <> v_old THEN
        v_scaled := round(v_od * v_new / v_old, 2);      -- same ratio on the new base
      ELSE
        v_scaled := v_od;                                -- subtotal unchanged → leave it
      END IF;
      IF v_scaled > v_new THEN v_scaled := v_new; END IF; -- never exceed the food's own base
      IF v_scaled < 0    THEN v_scaled := 0;    END IF;
      IF v_scaled <> v_od THEN
        UPDATE orders SET discount = v_scaled WHERE id = NEW.id;
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION lfh_resplit_bill_discount() FROM PUBLIC, anon, authenticated;
