-- Order lifecycle: a status the restaurant advances, plus a way for the guest
-- who placed an order to follow ONLY their own order's status (no login).

-- 1) Status column. received -> preparing -> served (cancelled also allowed).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'received';

-- 2) Secure lookup so a guest can poll just their own order's status by id.
--    SECURITY DEFINER lets it bypass the (insert-only) RLS, but it returns only
--    a few harmless fields for the single id passed in — so no one can list
--    other people's orders. The guest's device remembers its own order id.
CREATE OR REPLACE FUNCTION public.get_order_status(order_id UUID)
RETURNS TABLE (status TEXT, table_number TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.status, o.table_number, o.created_at
  FROM public.orders o
  WHERE o.id = order_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_order_status(UUID) TO anon, authenticated;
