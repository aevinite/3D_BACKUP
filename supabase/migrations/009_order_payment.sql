-- Bill payment state per order: 'pending' until the restaurant marks it 'paid'.
-- Lets the owner track the running tab (unpaid orders) in the editor.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending';
