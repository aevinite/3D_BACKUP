-- Owner analytics aggregated EVERY restaurant then threw away all but the owner's
-- slice IN JS, on the 60s-polled dashboard (audit, 2026-07-06). The 2-arg
-- lfh_owner_restaurant_revenue(from,to) LEFT JOINs orders for ALL restaurants
-- platform-wide even for a single-restaurant owner — a whole-tenant scan on a hot
-- path, violating the scoped-read rule ("WHERE restaurant_id …, never read-all-
-- then-filter-in-code").
--
-- Fix = an ADDITIVE 3-arg overload that pushes the restaurant filter INTO the query
-- (p_ids NULL = the admin all-view, an id array = just that owner's restaurants), so
-- the DB touches only the caller's data via the orders(restaurant_id,created_at)
-- index. The old 2-arg version is kept intact for any other caller; the owner
-- analytics route repoints to this scoped one.
-- p_ids DEFAULT NULL keeps this callable as the 2-arg form too, and matches the
-- signature already live on the DB so this CREATE OR REPLACE is an idempotent no-op
-- where it exists (a parallel effort added the same overload out-of-band).
CREATE OR REPLACE FUNCTION lfh_owner_restaurant_revenue(p_from timestamptz, p_to timestamptz, p_ids uuid[] DEFAULT NULL)
RETURNS TABLE (restaurant_id uuid, slug text, name text, accent_color text, revenue numeric, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.slug, r.name, r.accent_color,
         COALESCE(SUM(o.total - o.discount * (1 + lfh_effective_tax_rate(o.restaurant_id))) FILTER (WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric,
         COUNT(o.id) FILTER (WHERE o.status <> 'cancelled')::bigint
  FROM restaurants r
  LEFT JOIN orders o ON o.restaurant_id = r.id AND o.created_at >= p_from AND o.created_at < p_to
  WHERE p_ids IS NULL OR r.id = ANY(p_ids)
  GROUP BY r.id, r.slug, r.name, r.accent_color
  ORDER BY 5 DESC;
$$;

REVOKE ALL ON FUNCTION lfh_owner_restaurant_revenue(timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_owner_restaurant_revenue(timestamptz, timestamptz, uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
