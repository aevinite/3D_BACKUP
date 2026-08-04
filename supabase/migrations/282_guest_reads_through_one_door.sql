-- 282_guest_reads_through_one_door.sql
--
-- THE GUEST KEY STOPS BEING ABLE TO READ EVERY RESTAURANT'S WHOLE CONFIG ROW — second attempt,
-- with the failure mode inverted so it cannot repeat what happened the first time.
--
-- ── WHAT IS WRONG (sweep F9) ────────────────────────────────────────────────────────────────
-- `settings` and `restaurants` each carry a `USING (true)` public read policy plus a table-level
-- SELECT grant, so the anon key that ships in every guest's browser can read EVERY restaurant's
-- row WHOLE. Measured with the real key: `settings.gstin` readable; `restaurants.access_config`
-- returned 5,140 bytes of permission tree.
--
-- ── WHY THE FIRST ATTEMPT (mig 280, reverted by 274) TOOK EVERY GUEST MENU DOWN ──────────────
-- It narrowed anon's SELECT to a COLUMN LIST. A column grant enumerates what is allowed, so it
-- has to stay in lockstep with the column list in lib/menu.ts — and code and migrations do not
-- deploy together. Mig 270 had added three columns to that read (price_tax_mode,
-- item_tax_modes_allowed, mrp_tax_treatment); the grant still listed the older set; PostgREST
-- answered 42501 and lib/menu.ts threw "Failed to load settings". Every guest menu 500'd.
--
-- A VIEW would fail the SAME way, for the same reason: a view also enumerates its columns, so a
-- column the code asks for and the view lacks is an error, not a gap. That is why this is not a
-- view.
--
-- ── THE APPROACH: ONE DOOR, AND A DENYLIST RATHER THAN AN ALLOW-LIST ─────────────────────────
-- Two SECURITY DEFINER functions return the guest's payload as ONE jsonb object built from
-- `to_jsonb(row) - <sensitive keys>`. Two properties make this safe where the other shapes are not:
--
--   1. **A missing key is `undefined`, not an error.** The client reads keys off a plain object,
--      so if it ever asks for something the function does not return it falls through to the
--      default the mapping code already has (`data ? data.x !== false : true`). It degrades; it
--      cannot 500.
--   2. **A DENYLIST, so forgetting to update this function is harmless.** A column added to
--      `settings` next month flows through to the guest automatically. The failure mode of
--      forgetting is "a new, non-secret field is visible" — not "every restaurant's menu is
--      down". The first attempt had that backwards.
--
-- The denylist is deliberately SHORT and made of things that are stable and genuinely not the
-- guest's business. The ~60 module flags (`*_allowed` / `*_enabled`) are NOT on it: they describe
-- which features a restaurant has, which its own menu already shows, and listing 60 names here
-- would be exactly the rotting list this design exists to avoid.
--
-- Additive only. This migration grants nothing new to anon and takes nothing away — the base
-- tables stay exactly as mig 274 left them. Revoking the table read is a SEPARATE, later
-- migration that may only run once the code below is deployed and verified live, because a
-- revoke before the deploy is precisely the outage described above.

-- ── the guest's settings, minus what is not theirs ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION lfh_guest_settings(p_restaurant_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(s) - ARRAY[
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
  ]
  FROM settings s
  WHERE s.restaurant_id = p_restaurant_id
  LIMIT 1;
$$;
COMMENT ON FUNCTION lfh_guest_settings(uuid) IS
  'The guest menu''s settings, as ONE jsonb object. Built as to_jsonb(row) MINUS a denylist, so a '
  'column added later reaches the guest automatically and forgetting to update this function can '
  'only expose a harmless new field — never take a menu down. See mig 282 for why this is not a '
  'view or a column grant (mig 280 tried that and 500''d every guest menu).';

-- ── the tenant row a slug resolves to, minus the permission/ownership block ──────────────────
CREATE OR REPLACE FUNCTION lfh_guest_restaurant(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(r) - ARRAY[
    -- the entire Access & permissions tree, and who owns the restaurant
    'access_config', 'manager_permissions', 'owner_entitlements', 'owner_user_id',
    -- why/by whom it was binned (that it IS binned stays: the resolver hides those rows)
    'delete_reason', 'deleted_by',
    -- routing config the guest never uses
    'subdomain', 'custom_domain', 'created_at'
  ]
  FROM restaurants r
  WHERE r.slug = p_slug
  LIMIT 1;
$$;
COMMENT ON FUNCTION lfh_guest_restaurant(text) IS
  'Resolve a restaurant from its slug for a guest, as ONE jsonb object minus the permission and '
  'ownership block. `deleted_at` is deliberately still included — lib/tenant.ts uses it to hide a '
  'binned restaurant. Same denylist reasoning as lfh_guest_settings (mig 282).';

-- Both are the guest's own door: anon must be able to open it. They are SECURITY DEFINER and
-- take a restaurant id / slug, both of which are already public (the slug is in the URL), and
-- they return strictly LESS than the table grant anon holds today — so this widens nothing.
REVOKE ALL ON FUNCTION lfh_guest_settings(uuid)   FROM PUBLIC;
REVOKE ALL ON FUNCTION lfh_guest_restaurant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lfh_guest_settings(uuid)   TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION lfh_guest_restaurant(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
