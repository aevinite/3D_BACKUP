// lib/menuDataServer.ts — SERVER-ONLY cached read of the SHARED menu data.
//
// WHY THIS EXISTS (the #1 scaling-cost lever):
// The guest menu (<MenuView>) is a client component. Until now it read the
// SHARED menu data — dishes + categories — by calling
// lib/menu.ts straight from the BROWSER (anon Supabase client). So every guest
// view = one fresh Supabase round-trip for data that is identical for everyone
// at that restaurant and changes only when the owner edits the menu. At 1500
// restaurants × many guests that is the dominant Supabase egress.
//
// Next.js's unstable_cache / revalidateTag only intercept reads that run ON THE
// SERVER, never the browser. So the fix is: read this shared data on the server,
// cache it per-restaurant, and serve guests from the cache. The companion route
// handler app/api/r/[restaurant]/menu-data/route.ts exposes it; MenuView fetches
// THAT instead of hitting Supabase directly. Per-guest things (table, session,
// cart, favorites) are NOT touched — they stay client-side and live.
//
// CACHE SHAPE:
//   key parts : ["menu-data", restaurantId]   (per restaurant — never one global blob)
//   tag       : menu-<restaurantId>            (busted on owner edits — see editor route)
//   revalidate: 24h                             (safety net; owner edits bust it instantly)
//
// IMPORTANT: this module imports lib/menu.ts which uses the ANON client — that is
// fine on the server too (public SELECT). We DON'T use the service-role key here:
// guests must only ever see what the public policy allows, identical to before.

import { unstable_cache } from "next/cache";
import { getMenuItems, getCategories, CARD_COLUMNS, type MenuItem, type Category } from "./menu";

// The guest menu (<MenuView>) consumes exactly the dishes + categories, so that's
// all we cache. Settings (bubbles / maintenance / features) are deliberately NOT
// in here: they're read elsewhere (AppShell's getSettings, useFeatures) on their
// own direct path + realtime, and adding them would be dead weight nobody reads.
// If a future caller needs guest-safe settings cached, add the field here AND make
// the consumer read it — and bust this tag where service_mode/bubbles are written.
export interface MenuBundle {
  items: MenuItem[];
  categories: Category[];
}

// Build a per-restaurant cached reader. unstable_cache memoises by the key PARTS
// (we add restaurantId), so each restaurant gets its own cache entry, tagged
// menu-<id> so an owner edit can bust exactly that restaurant — nobody else's.
function cachedBundleFor(restaurantId: string) {
  return unstable_cache(
    async (): Promise<MenuBundle> => {
      // These run on the server now. Two parallel reads, the same queries the
      // browser used to make — but ONCE per 24h per restaurant (or until an edit busts
      // guests, instead of once per guest view.
      const [items, categories] = await Promise.all([
        getMenuItems(restaurantId, CARD_COLUMNS), // grid needs only card fields
        getCategories(restaurantId),
      ]);
      return { items, categories };
    },
    // Key parts: a stable prefix + the restaurant id => one cache entry per restaurant.
    ["menu-data", restaurantId],
    { revalidate: 86400, tags: [menuTag(restaurantId)] }
  );
}

/** The cache tag for one restaurant's shared menu data. Edit paths bust this. */
export function menuTag(restaurantId: string): string {
  return `menu-${restaurantId}`;
}

/**
 * Read the SHARED menu bundle for one restaurant, served from the Next data cache
 * when warm (no Supabase hit). Re-reads only after 120s OR when the tag is busted
 * by an owner menu edit. Returns the SAME shapes the client already consumes.
 */
export async function getMenuBundle(restaurantId: string): Promise<MenuBundle> {
  return cachedBundleFor(restaurantId)();
}
