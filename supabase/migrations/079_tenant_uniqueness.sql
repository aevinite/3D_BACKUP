-- 079_tenant_uniqueness.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Phase 1a: make natural keys unique PER RESTAURANT, so two restaurants can
-- each have a "burgers" category, a "table 1", the same dish slug, the same
-- returning customer phone, etc. The `restaurant_id` columns were added in 078
-- (NOT NULL, default #1). Safe on single-restaurant data — no duplicates exist,
-- so every key swap below succeeds without conflict.
--
-- Constraint names below were verified against the live schema (all Postgres
-- defaults). Each DROP is guarded so the migration is idempotent.
-- ─────────────────────────────────────────────────────────────────────────

-- menu_items: slug unique PER restaurant; `id` stays the global primary key.
ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_slug_key;
ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_restaurant_slug_key;
ALTER TABLE menu_items ADD  CONSTRAINT menu_items_restaurant_slug_key UNIQUE (restaurant_id, slug);

-- categories: primary key becomes (restaurant_id, slug).
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_pkey;
ALTER TABLE categories ADD  PRIMARY KEY (restaurant_id, slug);

-- filters: primary key becomes (restaurant_id, slug).
ALTER TABLE filters DROP CONSTRAINT IF EXISTS filters_pkey;
ALTER TABLE filters ADD  PRIMARY KEY (restaurant_id, slug);

-- customers: primary key becomes (restaurant_id, phone) — same phone can be a
-- returning guest at more than one restaurant, tracked independently.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_pkey;
ALTER TABLE customers ADD  PRIMARY KEY (restaurant_id, phone);

-- reviews: one review per (restaurant, dish, device).
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_item_slug_device_id_key;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_restaurant_item_device_key;
ALTER TABLE reviews ADD  CONSTRAINT reviews_restaurant_item_device_key UNIQUE (restaurant_id, item_slug, device_id);

-- aggregator_orders: external id unique per (restaurant, source).
ALTER TABLE aggregator_orders DROP CONSTRAINT IF EXISTS aggregator_orders_source_external_id_key;
ALTER TABLE aggregator_orders DROP CONSTRAINT IF EXISTS aggregator_orders_restaurant_source_ext_key;
ALTER TABLE aggregator_orders ADD  CONSTRAINT aggregator_orders_restaurant_source_ext_key UNIQUE (restaurant_id, source, external_id);

-- settings: exactly one settings row per restaurant. The `id` text PK (e.g.
-- 'site') stays for now; Phase 1b switches guest/staff reads from id='site' to a
-- restaurant_id-based lookup, and each new restaurant gets its own settings row.
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_restaurant_id_key;
ALTER TABLE settings ADD  CONSTRAINT settings_restaurant_id_key UNIQUE (restaurant_id);

NOTIFY pgrst, 'reload schema';
