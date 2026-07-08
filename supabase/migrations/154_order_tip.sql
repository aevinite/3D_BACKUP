-- 154_order_tip.sql — optional TIP captured at payment, stored per order.
-- (153 was taken by a parallel admin-usage migration, so this is 154 — the repo's recurring
--  migration-number collision; safe to renumber, it's a plain additive column.)
--
-- ADDITIVE + SAFE: a plain NOT NULL DEFAULT 0 column that is NEVER touched by the bill/discount/tax
-- math. A tip is EXTRA money for staff on TOP of the bill, so it must not enter subtotal/tax/
-- discount/total. For a multi-order table bill the whole tip is stored on the FIRST paid order;
-- tips are not split or clamped by any trigger (unlike discounts, which are), so a single-order
-- store is safe. Reports read SUM(orders.tip) as "tips collected".
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tip NUMERIC NOT NULL DEFAULT 0;
