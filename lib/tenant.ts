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
  logoText: string | null;
  heroTitle: string | null;
  tagline: string | null;
  accentColor: string | null;
  theme: Record<string, unknown> | null;
  logoUrl: string | null;
}

// Per-process cache: slug -> {value, at}. Short TTL so an admin's branding/menu
// edit shows on the guest menu within ~15s without a process restart. (Restaurants
// change rarely; one tiny row read every 15s per active slug is negligible egress.)
const bySlug = new Map<string, { value: Restaurant | null; at: number }>();
const TTL_MS = 15000;

/**
 * Resolve a restaurant by its URL slug (anon read on the public `restaurants`
 * table — migration 078 allows public SELECT). Returns null if the slug is
 * unknown. Cached per process with a short TTL.
 */
export async function getRestaurantBySlug(slug: string): Promise<Restaurant | null> {
  const hit = bySlug.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, slug, name, active, logo_text, hero_title, tagline, accent_color, theme, logo_url")
    .eq("slug", slug)
    .maybeSingle();
  const r: Restaurant | null =
    !error && data
      ? {
          id: data.id, slug: data.slug, name: data.name, active: !!data.active,
          logoText: data.logo_text ?? null, heroTitle: data.hero_title ?? null,
          tagline: data.tagline ?? null, accentColor: data.accent_color ?? null,
          theme: (data.theme && typeof data.theme === "object") ? data.theme as Record<string, unknown> : null,
          logoUrl: data.logo_url ?? null,
        }
      : null;
  bySlug.set(slug, { value: r, at: Date.now() });
  return r;
}

/**
 * Legacy helper for callers that only have a slug and want an id. Prefer
 * getRestaurantBySlug() where you need the full row / active check.
 */
export function resolveRestaurantId(_slug?: string | null): string {
  return DEFAULT_RESTAURANT_ID;
}
