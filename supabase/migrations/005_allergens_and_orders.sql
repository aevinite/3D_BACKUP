-- Allergens per dish + an orders table for the billing flow.

-- 1) Allergens on each dish (e.g. {"gluten","dairy"}). Shown on the dish page
--    and used to warn at checkout.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS allergens TEXT[] NOT NULL DEFAULT '{}';

-- 2) Orders placed from the menu (frontend writes directly; no payment backend).
CREATE TABLE IF NOT EXISTS orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number TEXT,
  items        JSONB NOT NULL,                 -- [{id,title,price,qty}]
  subtotal     NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax          NUMERIC(10,2) NOT NULL DEFAULT 0,
  total        NUMERIC(10,2) NOT NULL DEFAULT 0,
  allergies    TEXT[] NOT NULL DEFAULT '{}',   -- allergens the customer flagged
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
-- Anyone (the public menu, anon key) may PLACE an order, but cannot read orders.
-- The restaurant owner reads them via the service role (editor), which bypasses RLS.
DROP POLICY IF EXISTS "public_insert_orders" ON orders;
CREATE POLICY "public_insert_orders" ON orders FOR INSERT WITH CHECK (true);

-- ⚠️ RUN-ALONE GUARD (added by the 2026-08-21 migrations-001-118 sweep, T21).
-- `public_insert_orders` above is RETIRED. Migration 029 removed it when pricing became
-- server-authoritative: a guest's order now goes through `lfh_place_order` (session token,
-- approval and server-side pricing) or `lfh_place_order_public`, never a direct table INSERT.
-- An always-true INSERT policy beside those RPCs lets the public menu key write an `orders` row
-- with a price the client chose — the one thing 029 exists to prevent.
--
-- A FULL re-seed already ends correctly, because 029 sorts after this file and drops the policy
-- again. The hole is the PARTIAL run, which is what CLAUDE.md and `scripts/run-migration.mjs`
-- actively recommend ("node scripts/run-migration.mjs 005_allergens_and_orders.sql"); that
-- script's own header assumes CREATE OR REPLACE / IF NOT EXISTS means "safe to re-run", and for
-- a policy that a later migration deliberately removed it does not. So this file now ends in the
-- state migration 029 decided, exactly as migration 099 was made to do for its own cron job.
-- Idempotent, and safe on a database where the policy was never there.
DROP POLICY IF EXISTS "public_insert_orders" ON orders;
