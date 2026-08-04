-- 268_no_tax_restaurant.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- A restaurant that charges NO tax — and the reason it could not exist until now.
--
-- THE FAULT. `lfh_effective_tax_rate` (mig 119), `effectiveTaxRate` (lib/tax.ts) and
-- `taxModel()` (the manager panel) all agree on one rule: named components, else the fallback
-- `tax_rate`, else 5%. All three treat 0 as "not configured" and substitute 5%
-- (`COALESCE(NULLIF(tax_rate, 0), 0.05)` here, `Number(tax_rate) || 0.05` there).
--
-- Meanwhile the admin screen REMOVED the fallback-rate input on 2026-08-01, so the only way an
-- admin can say "we don't add tax" is to delete every row under "Tax lines on the print". That
-- writes `tax_components: []` and leaves `tax_rate` null — which is exactly the state the rule
-- reads as 5%. The card showed "Total tax: 0%" in bold and the printer added CGST 2.5% + SGST
-- 2.5% regardless: a ₹1,530 bill handed over as ₹1,607, every guest charged a tax the restaurant
-- never configured.
--
-- It also made a whole class of client impossible to serve correctly: a COMPOSITION-SCHEME
-- restaurant (turnover ≤ ₹1.5 cr, flat 5% paid by the restaurant, no input credit) may NOT pass
-- GST to the diner and its bill must carry no tax line at all — docs/COMPLIANCE-GUARDRAILS.md.
--
-- WHY A FLAG AND NOT "MAKE 0 MEAN 0". Making the existing 0 mean zero would change behaviour for
-- every restaurant already sitting on `tax_rate = 0` — today they are charging 5% and they would
-- silently drop to charging nothing the moment this shipped. That is the wrong way round for
-- money. This is an explicit opt-in instead: nothing changes for anybody until an admin ticks it.
--
-- Additive: one boolean defaulting to false, and the rate function taught to honour it. Every
-- existing restaurant keeps the exact rate it has today.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS tax_exempt boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN settings.tax_exempt IS
  'TRUE = this restaurant adds no tax to a diner bill and prints no tax line (composition scheme, or simply not registered). Deliberately explicit: a blank/zero tax_rate still means "not configured" and falls back to 5%, exactly as before.';

-- ── the rate, with the exemption honoured FIRST ──────────────────────────────
-- Body otherwise identical to mig 119: named components sum to the rate; else the fallback
-- tax_rate; else 5%. Only the leading exemption test is new.
CREATE OR REPLACE FUNCTION lfh_effective_tax_rate(p_restaurant_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT tax_components, tax_rate, tax_exempt FROM settings WHERE restaurant_id = p_restaurant_id
  ),
  comps AS (
    SELECT COALESCE(SUM((c->>'rate')::numeric), 0) AS pct
    FROM s
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s.tax_components) = 'array' THEN s.tax_components ELSE '[]'::jsonb END) c
    WHERE COALESCE(NULLIF(trim(c->>'label'), ''), '') <> ''
      AND COALESCE((c->>'rate')::numeric, 0) > 0
  )
  SELECT CASE
    WHEN COALESCE((SELECT tax_exempt FROM s), false) THEN 0
    WHEN COALESCE((SELECT pct FROM comps), 0) > 0 THEN (SELECT pct FROM comps) / 100.0
    ELSE COALESCE(NULLIF((SELECT tax_rate FROM s), 0), 0.05)
  END;
$$;
GRANT EXECUTE ON FUNCTION lfh_effective_tax_rate(uuid) TO anon, authenticated, service_role;

-- The BANQUET rate (mig 239) falls back to the dine-in one, so an exempt restaurant's banquet
-- is exempt too unless it has its own banquet components — which is the right default: the
-- exemption is a property of the business, not of one kind of sale.

NOTIFY pgrst, 'reload schema';
