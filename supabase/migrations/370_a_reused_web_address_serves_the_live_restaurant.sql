-- 370 · A reused web address serves the restaurant that is actually on it
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ MIGRATION NUMBER: 370, the next free after 369 on main. T22 and T23 each hold an uncommitted
--   369 of their own, so whichever of the three merges last renumbers on its way in. This file is
--   correct at ANY number: it is CREATE OR REPLACE on one function, it rewrites no data, adds no
--   column and needs no lfh_already_applied guard.
--
-- WHERE IT LIVES: the GUEST menu — a diner's own screen. Admin console → Restaurants → New
-- restaurant is where the situation is created. Nothing on any admin screen changes.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────────────────────────
-- Bin or permanently remove a restaurant, then create a new one that takes its freed web address,
-- and that new restaurant's guest menu could answer **"this menu isn't available right now"** —
-- while Admin → Restaurants listed it as Active and healthy, and nothing anywhere said otherwise.
-- Its printed QR codes would not work either, because they carry that same address.
--
-- Three deliberate decisions, each right on its own, combine into it:
--
--   · migration 309 stopped the purge deleting the `restaurants` row. The bills we keep for the
--     6–8 year records retention have to hang off something, so a removed restaurant leaves one
--     row behind, marked `purged_at` — and that row still holds its old `slug`.
--   · migration 319 made the slug's unique index PARTIAL (`WHERE deleted_at IS NULL`), because the
--     owner's rule is that a binned restaurant does not reserve its name. So a NEW restaurant may
--     legitimately be minted on the same address.
--   · migration 282's `lfh_guest_restaurant(p_slug)` — the one door every guest surface resolves
--     through — was `WHERE r.slug = p_slug LIMIT 1`, with **no `deleted_at IS NULL` filter and no
--     ORDER BY**.
--
-- Two rows therefore legitimately hold one slug, and `LIMIT 1` with no order picks either. When it
-- picked the dead one, `lib/tenant.ts` saw `deleted_at`, returned null, and every guest door on
-- that address answered 404. Reproduced four times on the dev stack by asking the function
-- directly: it returned the row with `deleted_at` AND `purged_at` set instead of the live
-- restaurant. It is INTERMITTENT — an unordered `LIMIT 1` is not deterministic — so the same
-- address can serve one minute and refuse the next, which is worse than a clean failure: nobody
-- goes looking for a bug that is not there when they check.
--
-- Found by sweep #7, terminal 16, re-running ledger row P07967. Evidence rows: P07967,
-- P23033–P23040 in .claude/sweep/LEDGER/T16.md.
--
-- ── THE FIX, AND WHY IT IS AN ORDER RATHER THAN A FILTER ────────────────────────────────────────
-- The obvious change is `AND r.deleted_at IS NULL`. This does something smaller and safer instead:
-- it makes the choice DETERMINISTIC and puts the live restaurant first.
--
--     ORDER BY (r.deleted_at IS NULL) DESC, r.created_at DESC NULLS LAST
--
-- Because migration 319's unique index still guarantees **at most one LIVE row per slug**, that
-- first key alone decides the answer whenever a live restaurant exists — there is nothing for the
-- tie-break to do. The tie-break only matters when EVERY row on the address is gone, and then it
-- returns the most recent one.
--
-- Why that matters, and why a bare filter would have been the worse change: when only dead rows
-- exist, a filter returns NOTHING, whereas today the function returns a row and `lib/tenant.ts`
-- turns it into null itself ("A restaurant in the recycle bin (deleted_at set) resolves to null —
-- so every guest surface that already does `if (!r) notFound()` hides it automatically"). Both
-- paths end at the same null and then at `slugMovedTo()` (mig 350), so the retired-address
-- redirect still fires exactly as before. Keeping the row means the ONLY behaviour that moves is
-- the broken one.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────────────────────────
--   · It does not let a binned or removed restaurant's menu open. `deleted_at` is still returned
--     and `lib/tenant.ts` still refuses it. This changes WHICH row is answered with, never whether
--     a closed restaurant is served.
--   · It does not change the guest slice. The same `to_jsonb(r)` minus the same keys — the access
--     tree, who owns it, why it was binned, and the routing config — so nothing new is exposed.
--   · It does not touch the create route, the recycle bin or the slug-reuse rule. A binned
--     restaurant still frees its name; that is the owner's rule and it is not in question.
--   · It does not stop an old printed QR code being inherited by the new occupant. That is the
--     documented consequence the create screen and the restore chooser both warn about, out loud,
--     before the admin agrees (2026-08-21). This fixes the case where the new occupant's OWN
--     codes did not work either.
--
-- Guarded by `npm run verify:guest-address`, which fails if the ORDER BY is removed, and which
-- also asserts the partial unique index this reasoning stands on is still there.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION lfh_guest_restaurant(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(r) - ARRAY[
    -- the entire Access & permissions tree, and who owns the restaurant
    'access_config', 'manager_permissions', 'owner_entitlements', 'owner_user_id',
    -- why/by whom it was binned (that it IS binned stays: the resolver hides those rows)
    'delete_reason', 'deleted_by',
    -- routing config the guest never uses
    'subdomain', 'custom_domain', 'created_at'
  ]
  FROM restaurants r
  WHERE r.slug = p_slug
  -- THE LIVE RESTAURANT ON THIS ADDRESS WINS (mig 370). A removed restaurant keeps its row and its
  -- slug (mig 309), and a new restaurant may take the freed name (mig 319), so two rows can hold
  -- one address. Migration 319's partial unique index means at most ONE of them is live, so this
  -- first key alone settles it. The date is only a tie-break for the all-gone case, where the
  -- caller nulls the answer anyway and the retired-address redirect (mig 350) takes over.
  ORDER BY (r.deleted_at IS NULL) DESC, r.created_at DESC NULLS LAST
  LIMIT 1;
$$;

COMMENT ON FUNCTION lfh_guest_restaurant(text) IS
  'The one door a guest resolves a restaurant through (mig 282). Returns the guest slice of the '
  'restaurants row for a slug, minus the permission/ownership block. Ordered so the LIVE '
  'restaurant on an address always wins over a binned or permanently removed one that still holds '
  'the same slug (mig 370) — without that, a restaurant created on a reused web address could '
  'answer 404 on its own menu, intermittently.';

-- Restated from migration 282 so this file is correct on its own in a fresh re-seed. CREATE OR
-- REPLACE keeps existing privileges, so on an already-built database these two lines change
-- nothing; they exist so the function can never end up PUBLIC-executable by default.
REVOKE ALL ON FUNCTION lfh_guest_restaurant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lfh_guest_restaurant(text) TO anon, authenticated, service_role;
