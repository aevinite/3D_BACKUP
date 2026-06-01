-- Let a guest correct ONLY their own order's table number (e.g. they mistyped it).
-- Same id-holding model as get_order_status: SECURITY DEFINER, and it changes
-- nothing but table_number, and only while the order is still open (not served).
CREATE OR REPLACE FUNCTION public.set_order_table_number(order_id UUID, new_table TEXT)
RETURNS TABLE (status TEXT, table_number TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.orders
  SET table_number = NULLIF(btrim(new_table), '')
  WHERE id = order_id AND status IN ('received', 'preparing')
  RETURNING status, table_number;
$$;

GRANT EXECUTE ON FUNCTION public.set_order_table_number(UUID, TEXT) TO anon, authenticated;
