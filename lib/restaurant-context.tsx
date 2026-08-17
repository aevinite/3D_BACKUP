"use client";
// Client-side "which restaurant am I?" for the GLOBAL guest widgets mounted in the
// root layout (GuestChrome's session / cart / chef components). They live OUTSIDE
// the /r/[restaurant] route tree, so they can't receive restaurantId as a prop —
// instead they read it from this context, which derives the restaurant from the
// URL (/r/<slug>) and resolves the slug to its id. Everything else (bare /menu,
// /item, ...) is restaurant #1.
//
// The context now also carries the SLUG and NAME, not just the id. Global widgets
// need these to (a) navigate back into the SAME restaurant (/r/<slug>/menu) instead
// of the bare /menu that always meant restaurant #1, and (b) show the restaurant's
// OWN name in the session/table gates instead of a hardcoded "My Little French
// House" (the white-label leak the audit found). The slug comes straight from the
// URL synchronously; the name resolves async (cached) right behind it.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { DEFAULT_RESTAURANT_ID, DEFAULT_RESTAURANT_SLUG, getRestaurantBySlug } from "./tenant";

export interface RestaurantMeta {
  /** Resolved restaurant id (defaults to #1 until a /r/<slug> resolves). */
  id: string;
  /** URL slug for the active restaurant — used to build /r/<slug>/... links. */
  slug: string;
  /** The restaurant's display name, once resolved (null while resolving / on bare routes). */
  name: string | null;
  /** False only while a /r/<slug> id is still being looked up. `id` starts at restaurant
   *  #1 so every widget has something usable immediately, which means a widget that ASKS
   *  THE SERVER something about "this restaurant" would otherwise ask twice: once about
   *  #1, once about the real one (BanGate did exactly that — two requests per page load,
   *  the first about the wrong restaurant). Anything that makes a network call keyed on
   *  the restaurant should wait for this. Bare routes (/menu, /item) resolve instantly:
   *  they ARE restaurant #1 by definition. Guest sweep 2026-08-04. */
  ready: boolean;
}

const DEFAULT_META: RestaurantMeta = { id: DEFAULT_RESTAURANT_ID, slug: DEFAULT_RESTAURANT_SLUG, name: null, ready: true };
const RestaurantContext = createContext<RestaurantMeta>(DEFAULT_META);

/** The active restaurant id for the current URL (defaults to restaurant #1). */
export function useRestaurantId(): string {
  return useContext(RestaurantContext).id;
}

/** The active restaurant's id + slug + name — for global widgets that need to
 *  navigate back into this restaurant or show its own branding. */
export function useRestaurantMeta(): RestaurantMeta {
  return useContext(RestaurantContext);
}

export function RestaurantProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Slug is known SYNCHRONOUSLY from the URL, so a widget can always build a
  // correct /r/<slug>/... link even before the id/name resolve.
  // Lower-cased, for the same reason lib/tenantStorage.foldSlug exists: this slug BUILDS LINKS
  // (`/r/<slug>/menu` from the global widgets) while the page components build theirs from the
  // RESOLVED `r.slug`, which is always lower case. Handing back "French-House" here sent a diner
  // between two spellings of one restaurant — and the phone files the basket per spelling.
  // (Guest sweep T1, 2026-08-16; owner's capital/lower-case rule, 2026-08-12.)
  const slug = useMemo(() => {
    const m = (pathname || "").match(/^\/r\/([^/]+)/);
    return m ? decodeURIComponent(m[1]).trim().toLowerCase() : DEFAULT_RESTAURANT_SLUG;
  }, [pathname]);

  const [id, setId] = useState<string>(DEFAULT_RESTAURANT_ID);
  const [name, setName] = useState<string | null>(null);
  // A tenant route starts NOT ready (its id is still #1's placeholder); a bare route is
  // ready at once because it genuinely IS restaurant #1.
  const [ready, setReady] = useState<boolean>(() => !/^\/r\/[^/]+/.test(pathname || ""));
  useEffect(() => {
    let alive = true;
    const m = (pathname || "").match(/^\/r\/([^/]+)/);
    const s = m ? decodeURIComponent(m[1]) : null;
    // Reset name so a stale name from the previous restaurant can't flash during
    // the resolve window (the audit's "widget briefly on old tenant" note).
    setName(null);
    if (!s) { setId(DEFAULT_RESTAURANT_ID); setReady(true); return; }
    setReady(false);
    getRestaurantBySlug(s)
      // `ready` flips true even when the lookup FAILS: the answer is then "it's #1", and a
      // widget waiting forever would be worse than one asking about the fallback.
      .then((r) => { if (alive) { setId(r?.id || DEFAULT_RESTAURANT_ID); setName(r?.name || null); setReady(true); } })
      .catch(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [pathname]);

  const value = useMemo<RestaurantMeta>(() => ({ id, slug, name, ready }), [id, slug, name, ready]);
  return <RestaurantContext.Provider value={value}>{children}</RestaurantContext.Provider>;
}
