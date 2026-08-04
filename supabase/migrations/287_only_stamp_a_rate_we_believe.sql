-- 287_only_stamp_a_rate_we_believe.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- A DERIVED RATE MUST ONLY BE STORED WHEN IT IS CREDIBLE.
--
-- Mig 284 gave every order a `tax_rate` derived as `tax / COALESCE(taxable_base, subtotal)`, and the
-- readers (billMath, the Z-report, paySplit) now trust it over the restaurant's settings. Driving the
-- deployed site turned up rates that are not rates:
--
--     0.050000  → 30,155 rows   ✓ the real dine-in rate
--     0.000000  →      43 rows   ✓ genuinely untaxed
--     0.045000  →      10 rows   ✗ = 0.05 × (1 − 50/500): the stored tax had been computed on the
--                                   DISCOUNTED base, so dividing by the full base under-reads it
--     0.025836  →       5 rows   ✗ tax and base simply disagree on these rows (legacy / hand-made)
--
-- 15 rows out of 30,203 — but each one would make `billMath` quote a wrong total for that bill, and
-- billMath is what the payment sheet asks the manager to collect. A derived figure that is trusted
-- absolutely has to be able to say "I don't know".
--
-- THE RULE: stamp the rate only when it matches one the restaurant could actually be on — its
-- effective dine-in rate, its banquet rate (mig 239), or zero. Anything else is left NULL, and NULL
-- falls back to the settings, which is exactly the behaviour before mig 284. So a row we cannot
-- explain is no worse off than it was, and a row we CAN explain is now right.
--
-- (The discount case is why the tolerance is not simply "any positive number": an order discounted
-- after its tax was stored genuinely cannot have its rate recovered from the row, and pretending
-- otherwise is how a ₹500 bill quietly starts asking for a different total.)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Is this a rate the restaurant could be on? ────────────────────────────
CREATE OR REPLACE FUNCTION lfh_plausible_tax_rate(p_rid uuid, p_rate numeric)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dine numeric; v_bq numeric;
BEGIN
  IF p_rate IS NULL THEN RETURN false; END IF;
  IF p_rate = 0 THEN RETURN true; END IF;                 -- composition / fully untaxed: real
  IF p_rate < 0 OR p_rate > 0.5 THEN RETURN false; END IF; -- nothing sane is above 50%
  v_dine := lfh_effective_tax_rate(p_rid);
  BEGIN v_bq := lfh_banquet_tax_rate(p_rid); EXCEPTION WHEN undefined_function THEN v_bq := NULL; END;
  -- A hair of tolerance for the 6-decimal rounding the stamp uses.
  RETURN (v_dine IS NOT NULL AND abs(p_rate - v_dine) < 0.0005)
      OR (v_bq   IS NOT NULL AND abs(p_rate - v_bq)   < 0.0005);
END $$;
REVOKE ALL ON FUNCTION lfh_plausible_tax_rate(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_plausible_tax_rate(uuid, numeric) TO service_role;

-- ── 2. The stamp only writes what it believes ────────────────────────────────
-- Body as mig 284, plus the credibility test. A rate it cannot vouch for is left NULL rather than
-- written, so the reader falls back to the settings instead of trusting a number nobody charged.
CREATE OR REPLACE FUNCTION lfh_stamp_order_tax_rate() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_base numeric; v_rate numeric;
BEGIN
  IF NEW.tax_rate IS NULL AND NEW.tax IS NOT NULL THEN
    v_base := COALESCE(NEW.taxable_base, NEW.subtotal);   -- the base the tax was charged ON
    IF COALESCE(v_base, 0) > 0 THEN
      v_rate := round(NEW.tax::numeric / v_base::numeric, 6);
    ELSIF NEW.tax = 0 THEN
      v_rate := 0;
    END IF;
    IF v_rate IS NOT NULL
       AND lfh_plausible_tax_rate(COALESCE(NEW.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid), v_rate)
    THEN
      NEW.tax_rate := v_rate;
    END IF;   -- otherwise leave NULL: the reader falls back to the restaurant's settings
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION lfh_stamp_order_tax_rate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stamp_order_tax_rate ON orders;
CREATE TRIGGER trg_stamp_order_tax_rate BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION lfh_stamp_order_tax_rate();

-- ── 3. Un-stamp the rates already written that we do not believe ─────────────
-- Nothing is lost: these rows return to falling back on the restaurant's settings, which is what
-- they did before mig 284 landed.
UPDATE orders o SET tax_rate = NULL
 WHERE o.tax_rate IS NOT NULL
   AND NOT lfh_plausible_tax_rate(COALESCE(o.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid), o.tax_rate);

-- Afterwards every stamped rate should be one the restaurant is actually on:
--   select tax_rate, count(*) from orders where tax_rate is not null group by 1 order by 2 desc;

NOTIFY pgrst, 'reload schema';
