-- 078_tenancy_core.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Phase 0: multi-tenant FOUNDATION — stamp every row with its restaurant.
--
-- PURELY ADDITIVE & NON-BREAKING. Every `restaurant_id` defaults to restaurant
-- #1 (the existing "My Little French House"), so the live app behaves byte-for-
-- byte identically after this runs — it just becomes *capable* of more.
--
-- DELIBERATELY NOT here (moved to Phase 1, where a 2nd restaurant is actually
-- served and these can be tested end-to-end):
--   • per-restaurant uniqueness on slugs/PKs (categories, filters, menu_items…)
--   • per-restaurant counters (KOT / bill / invoice) + their 6 caller functions
--   • scoping the guest/staff RPCs and the realtime topics by restaurant_id
-- In Phase 0 only restaurant #1 exists, so global counters / unscoped reads are
-- still correct, and leaving them untouched keeps this migration risk-free.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Tenant root table ------------------------------------------------------
CREATE TABLE IF NOT EXISTS restaurants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,
  name          text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  subdomain     text UNIQUE,         -- reserved for Phase 1+ subdomain routing
  custom_domain text UNIQUE,         -- reserved for white-label domains
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_read_restaurants ON restaurants;
CREATE POLICY public_read_restaurants ON restaurants FOR SELECT USING (true);

-- Seed restaurant #1 with a FIXED id so every DEFAULT below resolves to it.
INSERT INTO restaurants (id, slug, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'french-house', 'My Little French House')
ON CONFLICT (id) DO NOTHING;

-- 2) restaurant_id on every tenant-scoped table -----------------------------
--    NOT NULL DEFAULT #1 backfills existing rows AND lets every current
--    INSERT / RPC keep working unchanged (they implicitly write #1).
--    The loop is idempotent (only adds what's missing) and skips tables that
--    don't exist on this database.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'menu_items','categories','filters','settings','orders','order_items',
    'sessions','session_members','waiter_calls','requests','blocklist',
    'customers','reviews','feedback','otp_codes','verification_codes',
    'payments','aggregator_orders','staff_users','staff_actions',
    'realtime_events','daily_counters','seq_counters'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    -- Only touch real BASE TABLES that exist (skip views / missing tables).
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t AND table_type = 'BASE TABLE'
    ) THEN
      -- a) the column (constant default → fast, no table rewrite on PG 11+)
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS restaurant_id uuid '
        || 'NOT NULL DEFAULT ''00000000-0000-0000-0000-000000000001''', t);

      -- b) the foreign key (guarded so re-runs don't duplicate it)
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = t || '_restaurant_fk'
      ) THEN
        EXECUTE format(
          'ALTER TABLE public.%I ADD CONSTRAINT %I '
          || 'FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)',
          t, t || '_restaurant_fk');
      END IF;

      -- c) an index leading with restaurant_id (every tenant query filters on it)
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (restaurant_id)',
        'idx_' || t || '_restaurant', t);
    END IF;
  END LOOP;
END $$;

-- PostgREST caches the schema; nudge it so the JS client sees the new column.
NOTIFY pgrst, 'reload schema';
