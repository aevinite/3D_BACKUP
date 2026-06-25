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

const RestaurantIdContext = createContext<string>(DEFAULT_RESTAURANT_ID);

/** The active restaurant id for the current URL (defaults to restaurant #1). */
export function useRestaurantId(): string {
  return useContext(RestaurantIdContext);
}

export function RestaurantProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [rid, setRid] = useState<string>(DEFAULT_RESTAURANT_ID);
  useEffect(() => {
    let alive = true;
    // Only /r/<slug>/... is a non-default restaurant; resolve the slug to an id.
    const m = (pathname || "").match(/^\/r\/([^/]+)/);
    const slug = m ? decodeURIComponent(m[1]) : null;
    if (!slug) { setRid(DEFAULT_RESTAURANT_ID); return; }
    getRestaurantBySlug(slug)
      .then((r) => { if (alive) setRid(r?.id || DEFAULT_RESTAURANT_ID); })
      .catch(() => {});
    return () => { alive = false; };
  }, [pathname]);
  return <RestaurantIdContext.Provider value={rid}>{children}</RestaurantIdContext.Provider>;
}
