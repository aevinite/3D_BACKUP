-- 195 — fix Category-mix report dumping 100% of sales into "Other".
--
-- lfh_owner_category_breakdown joined the order item to menu_items on
-- `mi.id::text = it->>'id'`, but order items carry NO `id` — each item is
-- {qty, slug, price, title}. So every item missed the join and fell to
-- COALESCE(mi.category,'Other') → "Other" = 100% for every restaurant.
--
-- The canonical dish key in this app's order items is the TITLE (the dishes
-- report already groups by title), and menu_items.title matches it exactly.
-- Re-join on title (scoped per restaurant). Titles not found in the menu
-- (renamed/removed dishes) still fall to "Other", which is correct.
CREATE OR REPLACE FUNCTION public.lfh_owner_category_breakdown(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(category text, qty bigint, revenue numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(mi.category, 'Other') AS category,
         COALESCE(SUM((it->>'qty')::numeric), 0)::bigint AS qty,
         COALESCE(SUM((it->>'qty')::numeric * (it->>'price')::numeric) FILTER (WHERE o.payment_status = 'paid'), 0)::numeric AS revenue
  FROM orders o
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS it
  LEFT JOIN menu_items mi ON mi.restaurant_id = o.restaurant_id AND mi.title = (it->>'title')
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status <> 'cancelled'
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
  GROUP BY 1
  ORDER BY 3 DESC;
$function$;

ALTER FUNCTION public.lfh_owner_category_breakdown(uuid, timestamptz, timestamptz) SET work_mem = '128MB';
