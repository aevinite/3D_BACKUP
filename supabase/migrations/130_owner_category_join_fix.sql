-- 130 — Fix the owner Categories breakdown (dashboard "Revenue by category" + the
-- Categories report). It joined menu_items on a `slug` key that stored order items
-- NEVER contain: the server-authoritative order builder (mig 029) writes each line as
-- {id, title, price, qty, options, removed, note} — no slug. So `mi.slug = it->>'slug'`
-- matched nothing, mi.category was always NULL, and COALESCE(mi.category,'Other')
-- collapsed EVERY dish into a single meaningless "Other" row for every restaurant
-- (found 2026-07-06). Join on the dish id instead — it IS present (it->>'id' =
-- menu_items.id, the same key mig 029 looks the dish up by). Cast via ::text so a
-- legacy non-uuid id can never raise and kill the whole report. Qty/revenue logic is
-- unchanged (paid-only revenue, mig 113).
CREATE OR REPLACE FUNCTION lfh_owner_category_breakdown(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (category text, qty bigint, revenue numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(mi.category, 'Other') AS category,
         COALESCE(SUM((it->>'qty')::numeric), 0)::bigint AS qty,
         COALESCE(SUM((it->>'qty')::numeric * (it->>'price')::numeric) FILTER (WHERE o.payment_status = 'paid'), 0)::numeric AS revenue
  FROM orders o
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS it
  LEFT JOIN menu_items mi ON mi.restaurant_id = o.restaurant_id AND mi.id::text = (it->>'id')
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status <> 'cancelled'
    AND o.created_at >= p_from AND o.created_at < p_to
  GROUP BY 1
  ORDER BY 3 DESC;
$$;

-- CREATE OR REPLACE preserves existing ACL, but re-assert the staff-only grant per the
-- project rule (new/replaced functions must never stay public-executable).
REVOKE EXECUTE ON FUNCTION lfh_owner_category_breakdown(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_owner_category_breakdown(uuid, timestamptz, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';
