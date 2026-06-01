-- "Free table" archives a table's settled orders: they leave the live floor map
-- and Orders board but stay in the DB.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
