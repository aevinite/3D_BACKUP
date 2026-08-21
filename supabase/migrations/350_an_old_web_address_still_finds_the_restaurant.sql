-- 350 · An old web address still finds the restaurant
--
-- ⚠ MIGRATION NUMBER: next free after 349. Safe to renumber to the next free slot if a parallel
--   branch takes it — CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE only, and it rewrites no data,
--   so it needs no lfh_already_applied guard. Nothing is backfilled: there is no record of a past
--   rename on either stack, and inventing one would point a printed QR code at a guess.
--
-- ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────────────────────────
-- A QR code encodes the ADDRESS, not the restaurant: `/r/<slug>/menu?table=N`. So the moment a
-- restaurant's address changes, every laminated table card it ever printed stops working. Today the
-- address changes in exactly one place — restoring a binned restaurant whose address was taken while
-- it sat there (the admin restore endpoint's `resolve` branch) — and the restaurant comes back at a
-- new address with a drawer full of dead cards.
--
-- ── WHAT IT DELIBERATELY DOES NOT DO, AND WHY THAT MATTERS ───────────────────────────────────────
-- It NEVER takes an address away from whoever is using it. The case that triggers a rename is
-- precisely "somebody else already holds my old address", and that somebody holds it legitimately —
-- their own guests scan it. So `lfh_slug_moved` answers ONLY when the old address is currently
-- unclaimed by any live restaurant. A live holder always wins; history speaks only into a vacancy.
--
-- That is why this is a companion to the warnings shipped on 2026-08-21, not a replacement for them:
--   · address taken by another live restaurant  → nothing can redirect it. The create/restore screens
--     say so out loud, before the admin agrees, and the codes have to be reprinted.
--   · address now vacant (the taker was itself binned or renamed, or nobody ever took it)
--     → THIS sends the old code to the right menu instead of a 404.
-- Between them, an old code either reaches the right restaurant or the admin was told it wouldn't.

CREATE TABLE IF NOT EXISTS public.restaurant_slug_history (
  -- The RETIRED address. Primary key, so one old address can only ever be claimed by one
  -- restaurant — two rows fighting over `/r/aangan/` is the one thing that could send a guest to
  -- the wrong menu, and the key makes it impossible rather than unlikely.
  slug          text PRIMARY KEY,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  retired_at    timestamptz NOT NULL DEFAULT now(),
  -- What it changed TO at the time, for the audit trail. Not read by the resolver (which always
  -- follows the restaurant's CURRENT slug, so a second rename still lands correctly).
  replaced_by   text
);

COMMENT ON TABLE public.restaurant_slug_history IS
  'Addresses a restaurant used to answer on, so its old printed QR codes still work (mig 350). Read ONLY through lfh_slug_moved(), which refuses when a LIVE restaurant currently holds the address — history never takes an address off whoever is using it.';

-- Which restaurants have retired an address (the resolver goes slug → restaurant, but the admin
-- screens want the other direction, and a FK column with no index is a sequential scan on delete).
CREATE INDEX IF NOT EXISTS idx_slug_history_restaurant
  ON public.restaurant_slug_history (restaurant_id);

-- No policies on purpose: the service role bypasses RLS, and a guest browser never touches this
-- table directly — it only ever asks the function below, which returns a single slug and nothing else.
ALTER TABLE public.restaurant_slug_history ENABLE ROW LEVEL SECURITY;

-- ── THE RESOLVER ────────────────────────────────────────────────────────────────────────────────
-- Answers "this address is retired — where did that restaurant go?" and returns the CURRENT slug,
-- or NULL. Three conditions, all of them required:
--   1. no LIVE restaurant holds p_slug today (else that restaurant owns it and we say nothing);
--   2. p_slug is on record as retired;
--   3. the restaurant that retired it is itself still live and not binned (a binned restaurant's
--      menu must stay closed — every guest surface already treats it as absent).
-- Returns the slug only. No name, no id, no settings: a guest browser learns nothing it could not
-- learn by loading the menu it is being sent to.
CREATE OR REPLACE FUNCTION public.lfh_slug_moved(p_slug text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT r.slug
  FROM restaurant_slug_history h
  JOIN restaurants r ON r.id = h.restaurant_id
  WHERE h.slug = lower(btrim(p_slug))
    AND r.deleted_at IS NULL
    AND r.slug <> lower(btrim(p_slug))          -- it moved; it did not come back to this address
    AND NOT EXISTS (                             -- and nobody live is using the old address now
      SELECT 1 FROM restaurants live
      WHERE live.slug = lower(btrim(p_slug)) AND live.deleted_at IS NULL
    )
  LIMIT 1;
$$;

-- A NEW FUNCTION IS PUBLIC-EXECUTABLE UNTIL YOU SAY OTHERWISE (the mig 038/267 lesson, guarded by
-- npm run verify:grants). This one IS for the guest browser — an old QR code is scanned by a diner
-- with no login — so anon keeps EXECUTE deliberately, and it is listed in that guard's allow-list
-- with this reason. It reveals one slug for an address that is already public.
REVOKE ALL ON FUNCTION public.lfh_slug_moved(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lfh_slug_moved(text) TO anon, authenticated, service_role;
