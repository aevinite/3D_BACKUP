// lib/tenant.ts
// Single source of truth for tenant (restaurant) resolution.
//
// Phase 0 seeded one restaurant (#1) and everything defaulted to it. Phase 1
// resolves the restaurant from the URL slug (/r/<slug>) via getRestaurantBySlug;
// later a subdomain / custom domain can resolve through the same place.

import { supabase } from "./supabase";

/** The seeded "restaurant #1" (My Little French House). Must match migration 078. */
export const DEFAULT_RESTAURANT_ID = "00000000-0000-0000-0000-000000000001";

/** Its URL slug, for path-based routing: /r/<slug>/... */
export const DEFAULT_RESTAURANT_SLUG = "french-house";

export interface Restaurant {
  id: string;
  slug: string;
  name: string;
  active: boolean;
}

// Per-process cache: slug -> restaurant (or null if unknown). Restaurants change
// rarely, so caching avoids a DB round-trip on every render. A miss is cached as
// null too, so unknown slugs don't repeatedly hit the DB.
const bySlug = new Map<string, Restaurant | null>();

/**
 * Resolve a restaurant by its URL slug (anon read on the public `restaurants`
 * table — migration 078 allows public SELECT). Returns null if the slug is
 * unknown. Cached per process.
 */
export async function getRestaurantBySlug(slug: string): Promise<Restaurant | null> {
  if (bySlug.has(slug)) return bySlug.get(slug)!;
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, slug, name, active")
    .eq("slug", slug)
    .maybeSingle();
  const r: Restaurant | null =
    !error && data ? { id: data.id, slug: data.slug, name: data.name, active: !!data.active } : null;
  bySlug.set(slug, r);
  return r;
}

/**
 * Legacy helper for callers that only have a slug and want an id. Prefer
 * getRestaurantBySlug() where you need the full row / active check.
 */
export function resolveRestaurantId(_slug?: string | null): string {
  return DEFAULT_RESTAURANT_ID;
}
