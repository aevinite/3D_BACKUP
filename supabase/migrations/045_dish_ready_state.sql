-- A dish now has a real "ready" state between cooking and served (owner,
-- 2026-06-13): the kitchen marks a dish READY (cooked, waiting to be carried
-- out) — that is a staff handoff state. The WAITER marks it SERVED once it
-- actually reaches the guest. "ready" lives ONLY at the dish (order_items)
-- level: the order's own status stays received/preparing/served, so the guest's
-- order tracker and the floor brain (which read order-level status) are
-- unchanged and never expose the internal "ready" step.

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_status_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_status_check
  CHECK (status IN ('received','preparing','ready','served'));

NOTIFY pgrst, 'reload schema';
