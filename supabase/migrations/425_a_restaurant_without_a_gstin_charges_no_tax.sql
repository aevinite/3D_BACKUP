-- 425 — A RESTAURANT WITH NO GSTIN CHARGES NO TAX (owner, 2026-10-16 — sweep #10 T14 item 12, option c)
--
-- The question put to him: a restaurant whose Billing card has no GSTIN printed "Bill" at the top (since
-- sweep #7) and still ADDED and named CGST/SGST rows underneath. Three answers were offered — keep the
-- rows, show one plain "Tax" line, or do not charge tax at all — and he chose the third: "for 12th do c
-- option". It is also the honest one: a business that is not registered for GST may not collect GST
-- from a diner, which is exactly why a composition-scheme restaurant's rate is 0 (mig 272).
--
-- ═══ WHAT CHANGES ═══
--   1. lfh_effective_tax_rate(): no GSTIN → 0, right after the composition rule. Every SQL path that
--      prices an order (and stamps orders.tax_rate, mig 284) asks this function, so a new order at such
--      a restaurant is stamped 0 and charged nothing. Orders already taken keep the rate they were
--      charged at — a stamped rate is never re-priced (mig 284/288) — so no old bill changes by a paisa.
--   2. lfh_banquet_tax_rate(): the same two rules come FIRST. It used to return the banquet's own lines
--      even for a composition-scheme restaurant, which may not charge GST on anything; now composition
--      → 0 and no GSTIN → 0, and only then the banquet lines or the dine-in rate.
--   3. lfh_guest_settings(): hands the guest menu a plain yes/no `gst_registered`. The GSTIN itself stays
--      on the denylist (it is not menu data); without this flag the guest's cart would go on quoting 5%
--      while the bill charged 0.
--
-- ═══ ITS TWINS — change together, or the cart, the screen and the paper disagree ═══
--   lib/tax.ts effectiveTaxRate() (TAX_SETTINGS_COLUMNS now carries gstin) · public/panels/billdoc.js
--   taxModel()/bqTaxModel() · public/panels/tablet/app.js effRate()/banquetRate() fallbacks.
--   verify:print-helper runs the SQL and the TypeScript over the same set-ups and fails if they differ.
--
-- CREATE OR REPLACE keeps each function's existing grants (same signatures). No data is rewritten, so a
-- re-seed running this again changes nothing.

CREATE OR REPLACE FUNCTION public.lfh_effective_tax_rate(p_restaurant_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH s AS (
    SELECT tax_rate, tax_components, price_tax_mode, gstin
      FROM settings WHERE restaurant_id = p_restaurant_id
  ), comps AS (
    SELECT COALESCE(SUM((c->>'rate')::numeric), 0) AS pct
      FROM s, jsonb_array_elements(
             CASE WHEN jsonb_typeof(s.tax_components) = 'array' THEN s.tax_components
                  ELSE '[]'::jsonb END) c
     WHERE COALESCE(NULLIF(TRIM(c->>'label'), ''), '') <> ''
       AND COALESCE((c->>'rate')::numeric, 0) > 0
  )
  SELECT CASE
    WHEN (SELECT price_tax_mode FROM s) = 'composition' THEN 0
    -- 425: not registered for GST → may not collect it. (No settings row at all keeps the old answer.)
    WHEN EXISTS (SELECT 1 FROM s) AND COALESCE(TRIM((SELECT gstin FROM s)), '') = '' THEN 0
    WHEN COALESCE((SELECT pct FROM comps), 0) > 0 THEN (SELECT pct FROM comps) / 100.0
    ELSE COALESCE(NULLIF((SELECT tax_rate FROM s), 0), 0.05)
  END;
$function$;

CREATE OR REPLACE FUNCTION public.lfh_banquet_tax_rate(p_restaurant_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH s AS (SELECT banquet_tax_components AS bc, price_tax_mode, gstin FROM settings WHERE restaurant_id = p_restaurant_id),
  comps AS (
    SELECT COALESCE(SUM((c->>'rate')::numeric), 0) AS pct
    FROM s CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s.bc) = 'array' THEN s.bc ELSE '[]'::jsonb END) c
    WHERE COALESCE(NULLIF(trim(c->>'label'), ''), '') <> ''
      AND COALESCE((c->>'rate')::numeric, 0) > 0
  )
  SELECT CASE
    -- 425: the two rules that say "this business may not collect GST" come before the banquet's lines.
    WHEN (SELECT price_tax_mode FROM s) = 'composition' THEN 0
    WHEN EXISTS (SELECT 1 FROM s) AND COALESCE(TRIM((SELECT gstin FROM s)), '') = '' THEN 0
    WHEN COALESCE((SELECT pct FROM comps), 0) > 0 THEN (SELECT pct FROM comps) / 100
    ELSE lfh_effective_tax_rate(p_restaurant_id)
  END;
$function$;

CREATE OR REPLACE FUNCTION public.lfh_guest_settings(p_restaurant_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (to_jsonb(s) - ARRAY[
    -- the business's own tax identity + contact block, printed on bills, not menu data
    'gstin', 'restaurant_phone', 'restaurant_address', 'restaurant_name',
    'invoice_prefix', 'bill_footer',
    -- staff-facing money/print config
    'tax_inclusive', 'tax_label', 'auto_print_kot', 'auto_print_kot_allowed',
    'platform_channels', 'kitchen_can_accept_platform', 'platform_in_bills',
    -- which panels a restaurant has, and its floor/table layout: staff shape, not guest shape
    'enabled_panels', 'table_names', 'table_seats', 'floor_per_row', 'floor_layout_mode',
    -- log retention + the retired auto-close column
    'oplog_retention_days', 'custlog_retention_days', 'auto_table_action',
    -- the banquet paper/bill block (a dozen columns, all print setup)
    'banquet_fields', 'banquet_bill_prefix', 'banquet_bill_style', 'banquet_bill_next',
    'banquet_paper', 'banquet_paper_size', 'banquet_paper_top', 'banquet_paper_bot',
    'banquet_paper_side', 'banquet_paper_foot', 'banquet_paper_sign', 'banquet_paper_fill',
    'banquet_tax_components'
  ])
  -- 425: whether the restaurant may charge GST at all — a yes/no, never the GSTIN itself.
  || jsonb_build_object('gst_registered', COALESCE(TRIM(s.gstin), '') <> '')
  FROM settings s
  WHERE s.restaurant_id = p_restaurant_id
  LIMIT 1;
$function$;

-- ═══ GRANTS — restated exactly as they stood, never narrowed (mig 038/267: state them every time) ═══
-- The banquet rate is server-only, as mig 239 made it.
REVOKE ALL ON FUNCTION lfh_banquet_tax_rate(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_banquet_tax_rate(uuid) TO service_role;
-- These two were already callable with the browser's keys — the guest menu reads lfh_guest_settings with
-- the public key (mig 282), and the rate is no secret (it is printed on every bill). Restated, not narrowed:
-- narrowing a grant the code depends on is how a screen goes blank (see the grants memory).
REVOKE ALL ON FUNCTION lfh_effective_tax_rate(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lfh_effective_tax_rate(uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION lfh_guest_settings(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lfh_guest_settings(uuid) TO anon, authenticated, service_role;
