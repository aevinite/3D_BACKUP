-- 116: item_ratings view gains restaurant_id (stress-test fix queue, 2026-07-03).
--
-- The view aggregated reviews by item_slug ONLY (030-era, single-restaurant).
-- lib/menu.ts therefore had to read it UNSCOPED — every restaurant's aggregates
-- shipped to every guest (harmless data-wise while slugs stay prefixed-unique,
-- but an egress-rule violation and wrong the day two restaurants share a slug).
-- reviews already carries restaurant_id (tenancy phase), so the view just needs
-- to expose + group by it. ADDITIVE: the new column appends at the end, so any
-- still-deployed `select *` keeps working during rollout.
CREATE OR REPLACE VIEW item_ratings WITH (security_invoker = true) AS
  SELECT item_slug,
         round(avg(stars)::numeric, 1) AS avg_rating,
         count(*)::int AS review_count,
         restaurant_id
  FROM reviews GROUP BY item_slug, restaurant_id;
GRANT SELECT ON item_ratings TO anon, authenticated;
