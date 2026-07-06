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
}

const DEFAULT_META: RestaurantMeta = { id: DEFAULT_RESTAURANT_ID, slug: DEFAULT_RESTAURANT_SLUG, name: null };
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
  const slug = useMemo(() => {
    const m = (pathname || "").match(/^\/r\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : DEFAULT_RESTAURANT_SLUG;
  }, [pathname]);

  const [id, setId] = useState<string>(DEFAULT_RESTAURANT_ID);
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const m = (pathname || "").match(/^\/r\/([^/]+)/);
    const s = m ? decodeURIComponent(m[1]) : null;
    // Reset name so a stale name from the previous restaurant can't flash during
    // the resolve window (the audit's "widget briefly on old tenant" note).
    setName(null);
    if (!s) { setId(DEFAULT_RESTAURANT_ID); return; }
    getRestaurantBySlug(s)
      .then((r) => { if (alive) { setId(r?.id || DEFAULT_RESTAURANT_ID); setName(r?.name || null); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [pathname]);

  const value = useMemo<RestaurantMeta>(() => ({ id, slug, name }), [id, slug, name]);
  return <RestaurantContext.Provider value={value}>{children}</RestaurantContext.Provider>;
}
