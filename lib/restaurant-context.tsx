"use client";
// Client-side "which restaurant am I?" for the GLOBAL guest widgets mounted in the
// root layout (GuestChrome's session / cart / chef components). They live OUTSIDE
// the /r/[restaurant] route tree, so they can't receive restaurantId as a prop —
// instead they read it from this context, which derives the restaurant from the
// URL (/r/<slug>) and resolves the slug to its id. Everything else (bare /menu,
// /item, ...) is restaurant #1.
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { DEFAULT_RESTAURANT_ID, getRestaurantBySlug } from "./tenant";

// The context carries TWO values:
//  - `rid`: the best-known id (defaults to #1 so string-typed callers never see null);
//  - `resolvedId`: the id ONCE it's genuinely known, or null while a /r/<slug> URL is
//    still being resolved. Effects that must not fire as the wrong (#1 default) tenant
//    gate on `resolvedId` being non-null (see useResolvedRestaurantId).
interface RestaurantCtx { rid: string; resolvedId: string | null; }
const RestaurantIdContext = createContext<RestaurantCtx>({
  rid: DEFAULT_RESTAURANT_ID,
  resolvedId: DEFAULT_RESTAURANT_ID,
});

/** The active restaurant id for the current URL (defaults to restaurant #1). */
export function useRestaurantId(): string {
  return useContext(RestaurantIdContext).rid;
}

/**
 * The resolved restaurant id, or `null` while a /r/<slug> URL is still resolving
 * its slug → id. Tenant-scoped effects (settings/ban reads) should skip fetching
 * while this is null, so they never run once as restaurant #1 and then again for
 * the real tenant. On the bare (#1) routes this is the default id immediately.
 */
export function useResolvedRestaurantId(): string | null {
  return useContext(RestaurantIdContext).resolvedId;
}

export function RestaurantProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [rid, setRid] = useState<string>(DEFAULT_RESTAURANT_ID);
  const [resolvedId, setResolvedId] = useState<string | null>(DEFAULT_RESTAURANT_ID);
  useEffect(() => {
    let alive = true;
    // Only /r/<slug>/... is a non-default restaurant; resolve the slug to an id.
    const m = (pathname || "").match(/^\/r\/([^/]+)/);
    const slug = m ? decodeURIComponent(m[1]) : null;
    // Bare routes (/menu, /item, ...) ARE restaurant #1 — the default IS the real
    // id, so it's resolved immediately.
    if (!slug) { setRid(DEFAULT_RESTAURANT_ID); setResolvedId(DEFAULT_RESTAURANT_ID); return; }
    // A non-default restaurant: its id is unknown until the slug resolves. Mark it
    // unresolved (null) so tenant-scoped effects don't fetch as restaurant #1 first.
    setResolvedId(null);
    getRestaurantBySlug(slug)
      .then((r) => { if (alive) { const id = r?.id || DEFAULT_RESTAURANT_ID; setRid(id); setResolvedId(id); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [pathname]);
  return <RestaurantIdContext.Provider value={{ rid, resolvedId }}>{children}</RestaurantIdContext.Provider>;
}
