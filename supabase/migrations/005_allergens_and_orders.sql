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
