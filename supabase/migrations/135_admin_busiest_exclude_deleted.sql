-- 135_admin_busiest_exclude_deleted.sql — bug H4 (2026-07-06).
-- The admin Analytics "busiest restaurants" table showed SOFT-DELETED (recycle-bin)
-- restaurants: lfh_admin_busiest_restaurants (mig 123) LEFT JOINs `restaurants` with
-- no deleted_at guard, so a binned restaurant still surfaced with its pre-deletion
-- orders (which survive the 90-day retention window). Every other admin dashboard read
-- was fixed in the routes; this is the one aggregate that lives in SQL. Add the guard.
-- Same signature — CREATE OR REPLACE keeps existing GRANTs; re-lock defensively anyway.

CREATE OR REPLACE FUNCTION lfh_admin_busiest_restaurants(p_from timestamptz, p_to timestamptz, p_limit int)
RETURNS TABLE (restaurant_id uuid, slug text, name text, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.slug, r.name, COUNT(o.id)::bigint AS orders
  FROM restaurants r
  LEFT JOIN orders o ON o.restaurant_id = r.id AND o.created_at >= p_from AND o.created_at < p_to
  WHERE r.deleted_at IS NULL
  GROUP BY r.id, r.slug, r.name
  ORDER BY 4 DESC
  LIMIT GREATEST(COALESCE(p_limit, 10), 1);
$$;

REVOKE EXECUTE ON FUNCTION lfh_admin_busiest_restaurants(timestamptz, timestamptz, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_admin_busiest_restaurants(timestamptz, timestamptz, int) TO service_role;

NOTIFY pgrst, 'reload schema';
