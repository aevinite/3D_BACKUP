-- 319_the_bin_stops_locking_a_restaurants_name.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- THE OWNER, 2026-08-13: "from bin make it like you can delete… make it like you can, and inside
-- bin no name lock it will show, and like that name will be rewritten if same name exist."
--
-- WHERE: Admin console (/aevinite) → Restaurants → Recycle bin.
-- WHAT HE WOULD SEE, BEFORE: delete "Aangan" into the bin, try to create a new "Aangan" — the new
-- one silently becomes "aangan-2", for 90 days, because of a restaurant nobody can see any more.
--
-- He already made this decision once, for staff LOGIN names: migration 245 made that unique index
-- partial (`WHERE deleted_at IS NULL`) so only LIVE logins reserve a name, with a rename offered at
-- restore time. Restaurant names never got the same treatment. This is that same change, for the
-- restaurant's own name and web address.
--
-- THE HALF THAT MATTERS, AND WHY IT IS ONE CHANGE, NOT TWO. Freeing the name is one line. But then
-- restoring the old one can collide with the new holder — and a collision on a UNIQUE index is a
-- database error on the admin's screen, which is worse than the lock it replaces. So the restore
-- endpoint renames the RETURNING restaurant in the same commit (app/api/admin/restaurants/route.ts),
-- which is exactly what he asked for: "that name will be rewritten if same name exist".
--
-- SAFE BY CONSTRUCTION: partial indexes only ever REMOVE a restriction here — every live row still
-- has a unique slug/subdomain/domain, and a binned row simply stops competing. Nothing is renamed by
-- this migration; existing names are untouched.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- `slug` is the restaurant's web address (/r/<slug>/menu) and the name the admin types is turned
-- into it. Dropping the table-wide constraint and re-adding it as a partial index is the whole fix.
ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_slug_key;
DROP INDEX IF EXISTS restaurants_slug_live_key;
CREATE UNIQUE INDEX restaurants_slug_live_key
  ON public.restaurants (slug) WHERE deleted_at IS NULL;

-- The same for the two white-label addresses, for the same reason: a binned restaurant must not
-- hold a subdomain or a custom domain a live one now wants. Both are nullable, and a partial index
-- still allows many NULLs, exactly as the old constraints did.
ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_subdomain_key;
DROP INDEX IF EXISTS restaurants_subdomain_live_key;
CREATE UNIQUE INDEX restaurants_subdomain_live_key
  ON public.restaurants (subdomain) WHERE deleted_at IS NULL AND subdomain IS NOT NULL;

ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_custom_domain_key;
DROP INDEX IF EXISTS restaurants_custom_domain_live_key;
CREATE UNIQUE INDEX restaurants_custom_domain_live_key
  ON public.restaurants (custom_domain) WHERE deleted_at IS NULL AND custom_domain IS NOT NULL;

COMMENT ON COLUMN public.restaurants.slug IS
  'The restaurant''s web address (/r/<slug>/menu) and the id its settings row carries. Unique among LIVE restaurants only (mig 319) — a restaurant in the 90-day recycle bin does NOT reserve its name, the same rule migration 245 gave staff logins. Restoring one whose name has since been taken renames the RETURNING restaurant (admin restore endpoint), never the one currently using it.';

NOTIFY pgrst, 'reload schema';
