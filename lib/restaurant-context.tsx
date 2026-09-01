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
// THE ONE RULE for "which restaurant is this tab on" (sweep 6 T3, 2026-08-17). This file used to
// carry its OWN copy of that rule — a `/^\/r\/([^/]+)/` match on the path and nothing else — while
// lib/tenantStorage.ts carried a fuller one. They disagreed on the door a real diner actually uses:
// the printed table sticker.
//
// THE THIRD DOOR. `/q/<code>` renders the restaurant's menu with the URL left as `/q/<code>` on
// purpose (the table number must not go back in the address bar), so there is no `/r/<slug>` to
// match. tenantStorage handles that by reading the tenant the tab was PINNED to — app/q/[code]
// stamps `lfh_tab_tenant` in a script before hydration — so the cart, the session and the tracker
// were scoped correctly. This provider knew nothing about that pin, so every GLOBAL widget
// (cart, session gate, feature switches, tax rate, the bell) answered "restaurant #1".
//
// WATCHED HAPPENING on Aangan's own table-1 sticker: Aangan has the dining-session system OFF, but
// the widgets read restaurant #1's settings, where it is ON — so tapping "+" on a dish opened the
// join-a-table gate instead of adding it, and the basket stayed empty. A diner scanning the sticker
// on their table could not order at all. It went unnoticed because restaurant #1's own stickers
// resolve to #1 by accident, which is the right answer for exactly one restaurant.
//
// So: import the rule instead of re-writing it. A door added tomorrow is handled in one place.
import { tenantSlug } from "./tenantStorage";

export interface RestaurantMeta {
  /** Resolved restaurant id (defaults to #1 until a /r/<slug> resolves). */
  id: string;
  /** URL slug for the active restaurant — used to build /r/<slug>/... links. */
  slug: string;
  /** The restaurant's display name, once resolved (null while resolving / on bare routes). */
  name: string | null;
  /** False while a /r/<slug> id is still being looked up — AND false for good if the lookup
   *  FAILED. `id` starts at restaurant #1 so every widget has something usable immediately, which
   *  means a widget that ASKS THE SERVER something about "this restaurant" would otherwise ask
   *  twice: once about #1, once about the real one (BanGate did exactly that — two requests per
   *  page load, the first about the wrong restaurant). Anything that makes a network call keyed on
   *  the restaurant should wait for this. Bare routes (/menu, /item) resolve instantly: they ARE
   *  restaurant #1 by definition. Guest sweep 2026-08-04.
   *
   *  ⚠️ ON A FAILED LOOKUP `id` IS "" AND `ready` STAYS FALSE (item 21, 2026-08-30). It used to
   *  stay on restaurant #1, which is a guess about a different restaurant's orders and money — see
   *  the long note at the resolve below, and the Aangan sticker it was watched on. A widget that
   *  keys on the restaurant must treat "" the way the server already does: refuse, and say so. */
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
  // The slug the PATH alone can tell us, known synchronously and identical on the server and on
  // the first client render — so a widget can always build a correct /r/<slug>/... link, and
  // hydration can never mismatch. A door with no slug in its path (`/q/<code>`, `/view/<folder>`)
  // is settled a moment later by the effect below, which is where the tab's pin can be read.
  //
  // LOWER-CASED, for the same reason lib/tenantStorage's fold() exists: this slug BUILDS LINKS
  // (`/r/<slug>/menu` from the global widgets) while the page components build theirs from the
  // RESOLVED `r.slug`, which is always lower case. Handing back "French-House" here sent a diner
  // between two spellings of one restaurant — and the phone files the basket per spelling.
  // (Guest sweep T1, 2026-08-16; owner's capital/lower-case rule, 2026-08-12.)
  const pathSlug = useMemo(() => {
    const m = (pathname || "").match(/^\/r\/([^/]+)/);
    return m ? decodeURIComponent(m[1]).trim().toLowerCase() : DEFAULT_RESTAURANT_SLUG;
  }, [pathname]);

  const [slug, setSlug] = useState<string>(pathSlug);
  const [id, setId] = useState<string>(DEFAULT_RESTAURANT_ID);
  const [name, setName] = useState<string | null>(null);
  // Ready at once ONLY for the routes that genuinely ARE restaurant #1 — the bare /menu and
  // /item, the original single-restaurant URLs. Everything else has to be looked up, including
  // the pinned doors: answering "#1, ready" for those is precisely the bug fixed here.
  const [ready, setReady] = useState<boolean>(() => /^\/(menu|item)(\/|$)/.test(pathname || ""));
  useEffect(() => {
    let alive = true;
    // Reset name so a stale name from the previous restaurant can't flash during
    // the resolve window (the audit's "widget briefly on old tenant" note).
    setName(null);
    // ONE rule, shared with the tenant-scoped storage the same widgets read from:
    //   /r/<slug>/…      → that slug (and the tab is pinned to it)
    //   /menu, /item/…   → restaurant #1, by definition
    //   anything else    → the tenant this TAB was pinned to (the printed-QR door), else #1
    // Read inside the effect, never during render: it touches sessionStorage, which does not
    // exist on the server.
    const s = tenantSlug();
    setSlug(s);
    if (s === DEFAULT_RESTAURANT_SLUG) { setId(DEFAULT_RESTAURANT_ID); setReady(true); return; }
    setReady(false);
    getRestaurantBySlug(s)
      // ── A FAILED LOOKUP IS "WE DON'T KNOW", NOT "IT'S RESTAURANT #1" ─────────────────────────
      // (T25, sweep #7, item 21, 2026-08-30. The owner: *"21 is very imp do it solve and make sure
      // this never happens."*)
      //
      // This used to read `setId(r?.id || DEFAULT_RESTAURANT_ID)` with a `.catch` that flipped
      // `ready` and left the id alone — so on a failed resolve every GLOBAL widget answered
      // "restaurant #1" for a diner standing in a different restaurant. That is not a theoretical
      // fault: it is the one written at the top of this file, watched happening on AANGAN'S OWN
      // TABLE-1 STICKER. Aangan has dining sessions OFF; the widgets read #1's settings, where they
      // are ON; so tapping "+" on a dish opened the join-a-table gate instead of adding it, and the
      // basket stayed empty. A diner scanning the sticker on their table could not order at all.
      //
      // It went unnoticed because restaurant #1's own stickers resolve to #1 by accident, which is
      // the right answer for exactly one restaurant.
      //
      // WHEN IT CAN HAPPEN NOW. lib/tenant.ts stopped folding a failed READ into `null` on
      // 2026-08-03 — it stands on a 10-minute-old answer if it has one and otherwise THROWS. So the
      // `.catch` below is genuinely reachable: a cold process plus one refused read, on the
      // `/q/<code>` door where the page renders server-side and the client re-resolves.
      //
      // WHY THE EMPTY STRING IS THE RIGHT ANSWER, and not a hang. The server half of this is
      // ALREADY BUILT and already worded. `/api/guest/place-order` and `/api/guest/call-waiter` both
      // do `isUuid(b.restaurantId) ? … : ""` and refuse with `unknown_restaurant`, and
      // lib/guestOutbox.ts already words it for a diner: *"We couldn't tell which restaurant this
      // order was for."* So an unknown restaurant now takes the path this codebase built for exactly
      // that case — a visible refusal — instead of quietly becoming somebody else's order and
      // somebody else's money. `ready` stays FALSE, which is what BanGate and CustomerGreeter
      // already wait on.
      //
      // A lookup that succeeds and returns null (a slug nobody owns) is a DIFFERENT answer and keeps
      // its old behaviour: there is no restaurant to be wrong about.
      .then((r) => {
        if (!alive) return;
        if (r?.id) { setId(r.id); setName(r.name || null); setReady(true); return; }
        setId(DEFAULT_RESTAURANT_ID); setName(null); setReady(true);
      })
      .catch(() => {
        if (!alive) return;
        setId("");          // we do not know — and "#1" would be a guess about somebody's money
        setName(null);
        setReady(false);    // …so nothing keyed on the restaurant acts on a guess
      });
    return () => { alive = false; };
  }, [pathname]);

  const value = useMemo<RestaurantMeta>(() => ({ id, slug, name, ready }), [id, slug, name, ready]);
  return <RestaurantContext.Provider value={value}>{children}</RestaurantContext.Provider>;
}
