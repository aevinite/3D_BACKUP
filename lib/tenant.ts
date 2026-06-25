// lib/tenant.ts
// Single source of truth for tenant (restaurant) resolution.
//
// Phase 0: only the seeded default restaurant exists, so everything resolves to
// it and the app behaves exactly as before. Phase 1 replaces the body of
// resolveRestaurantId() with real slug / subdomain resolution — callers that
// already route through this function won't need to change.

/** The seeded "restaurant #1" (My Little French House). Must match migration 078. */
export const DEFAULT_RESTAURANT_ID = "00000000-0000-0000-0000-000000000001";

/** Its URL slug, for Phase 1 path-based routing: /r/<slug>/... */
export const DEFAULT_RESTAURANT_SLUG = "french-house";

/**
 * Resolve the active restaurant id for the current request/context.
 *
 * Phase 0: always the default restaurant.
 * Phase 1: will read the slug from the URL path (/r/<slug>) — and later a
 * subdomain or custom domain — and look up its id. Returning the default here
 * keeps every existing caller behaving identically until Phase 1 wires real
 * resolution in one place.
 */
export function resolveRestaurantId(_slug?: string | null): string {
  return DEFAULT_RESTAURANT_ID;
}
