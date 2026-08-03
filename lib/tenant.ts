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
// How long a LAST KNOWN answer may stand in when the database won't answer. Generous on purpose:
// whether a restaurant exists changes about never, and the alternative is telling a diner it
// doesn't. See the note in getRestaurantBySlug.
const STALE_ON_ERROR_MS = 10 * 60 * 1000;

/**
 * Resolve a restaurant by its URL slug (anon read on the public `restaurants`
 * table — migration 078 allows public SELECT). Returns null if the slug is
 * unknown. Cached per process with a short TTL.
 *
 * "I COULDN'T ASK" IS NOT "IT DOESN'T EXIST" (2026-08-03). This used to fold a failed READ into
 * the same `null` as an unknown slug:
 *
 *     const r = !error && data && !data.deleted_at ? {…} : null;
 *     bySlug.set(slug, { value: r, at: Date.now() });     // ← and it CACHED that null
 *
 * Every guest surface turns null into `notFound()`, so one timed-out lookup told a diner
 * scanning the QR that **the restaurant does not exist** — and because the null was cached, so
 * did every scan for the next 15 seconds. `lib/panelGate.ts` uses the same helper, so a staff
 * panel would likewise say the restaurant isn't there.
 *
 * Caught 2026-08-03 by the 485-phase suite: eight guest-menu phases failed with
 * `/r/french-house/menu → 404` while that restaurant was perfectly present and active, during a
 * moment the database was under load from the suite itself.
 *
 * So a failed read now (a) is never cached, and (b) answers with the last known row if we have
 * one, and otherwise THROWS — because "something went wrong, try again" is honest and a 404 is
 * not. A genuinely unknown slug, and a restaurant in the recycle bin, still return null exactly
 * as before.
 */
export async function getRestaurantBySlug(slug: string): Promise<Restaurant | null> {
  const hit = bySlug.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, slug, name, active, deleted_at, logo_text, hero_title, tagline, accent_color, theme, logo_url")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    // Stand on the last real answer rather than invent one. (It may itself be null — a slug we
    // already know is unknown — and that is fine: it was a real answer, not a failure.)
    if (hit && Date.now() - hit.at < STALE_ON_ERROR_MS) return hit.value;
    throw new Error(`Couldn't look up restaurant "${slug}": ${error.message}`);
  }
  // A restaurant in the recycle bin (deleted_at set) resolves to null — so every
  // guest surface that already does `if (!r) notFound()` hides it automatically
  // (menu page, item page, menu-data API), no per-caller change needed.
  const r: Restaurant | null =
    data && !data.deleted_at
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
// (resolveRestaurantId was removed 2026-07-07: it always returned restaurant #1
// regardless of the slug, so any caller would silently treat every restaurant as
// #1. It had no callers — deleted so it can't become a trap. Use
// getRestaurantBySlug() to resolve a slug to its real id.)
