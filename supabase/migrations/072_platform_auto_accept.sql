-- 072_platform_auto_accept.sql
-- Zomato/Swiggy orders are already confirmed by the customer + the platform before
-- they reach the restaurant, so the manual "accept" step isn't real — auto-accept
-- them. lfh_platform_insert now lands an order straight as 'accepted' (it shows in
-- the kitchen's Cooking column immediately; no New/accept step). (owner, 2026-06-20)

CREATE OR REPLACE FUNCTION lfh_platform_insert(
  p_source TEXT, p_external_id TEXT, p_customer TEXT, p_phone TEXT, p_items JSONB, p_total NUMERIC
) RETURNS aggregator_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row aggregator_orders;
BEGIN
  INSERT INTO aggregator_orders(source, external_id, payload, status, status_history,
      customer_name, customer_phone, items, total, kot_no, accepted_at)
  VALUES (p_source, p_external_id, '{}'::jsonb, 'accepted',
      jsonb_build_array(jsonb_build_object('status','accepted','at', NOW(), 'by','auto')),
      p_customer, p_phone, COALESCE(p_items, '[]'::jsonb), COALESCE(p_total, 0),
      lfh_next_counter('kot'), NOW())
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION lfh_platform_insert(TEXT,TEXT,TEXT,TEXT,JSONB,NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_platform_insert(TEXT,TEXT,TEXT,TEXT,JSONB,NUMERIC) TO service_role;

NOTIFY pgrst, 'reload schema';
