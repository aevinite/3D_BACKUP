// Tenant-scoped localStorage for the GUEST app — the fix for cross-restaurant
// state leaks (2026-07-04). localStorage is shared per DOMAIN, and all our
// restaurants live under one domain (path routing, /r/<slug>/...), so a plain
// key like "lfh_cart" is ONE shared notepad for every restaurant: a session
// opened at French House kept showing on Sakura Sushi's menu on the same phone.
//
// The cure: every per-restaurant key gets the restaurant's slug appended —
// "lfh_cart:french-house" vs "lfh_cart:sakura-sushi" — same pattern the app
// already used for "lfh_features:<rid>". Device-wide preferences (theme,
// language, currency, device id) stay unscoped on purpose: those belong to the
// PERSON's phone, not to a restaurant.
//
// When we later move to subdomains (<slug>.app.com), the browser will isolate
// storage per restaurant for free — these scoped keys stay correct either way.

import { DEFAULT_RESTAURANT_SLUG } from "./tenant";

// Remembers, per browser TAB, which restaurant the guest last browsed. Needed
// because a few pages are not tenant-prefixed (e.g. the 3D viewer /view/<folder>)
// — on those we keep using the tenant the tab came from instead of guessing.
const LAST_SLUG_KEY = "lfh_tab_tenant";

// Which restaurant does this tab belong to RIGHT NOW?
//  - /r/<slug>/...            → that slug (and we remember it for this tab)
//  - bare /menu, /item/...    → restaurant #1 (these paths ARE #1 by definition —
//                               same rule as lib/restaurant-context.tsx)
//  - anything else (/view/..) → the slug this tab last visited, else #1
// CAPITALS AND LOWER CASE ARE THE SAME RESTAURANT — INCLUDING IN THIS PHONE'S OWN MEMORY
// (owner, 2026-08-12: *"make sure c capital and small works as a same … it should be identical
// only"*; the storage half was found by guest sweep T1, 2026-08-16 and measured on the deployed site).
//
// Slugs are stored lower case, and lib/tenant.getRestaurantBySlug folds case so /r/French-House/menu
// resolves — but this function read the address bar VERBATIM while every link the app builds carries
// the RESOLVED slug (app/r/[restaurant]/menu/page.tsx passes `r.slug` for exactly that reason). The
// two therefore disagreed the moment an address had a capital in it, and this key is what the basket,
// the scanned table, the table session, the nickname, the favourites, the allergy list and the live
// order list are all filed under. Measured: opening /r/French-House/menu?table=5 stored the table as
// `lfh_table:French-House`, the dish card linked to /r/french-house/item/…, and on that page the
// table number was simply gone — and anything added there landed in a second basket the menu could
// not see.
//
// Folding HERE rather than at each call site because tkey/tget/tset/isTKey all come through it, so
// one restaurant is one scope however the address was typed. `tgetFor`/`tsetFor` fold too — they take
// an explicit slug, and a caller that passes a raw address slug must land in the same place.
const foldSlug = (s: string): string => String(s || "").trim().toLowerCase();

export function tenantSlug(): string {
  if (typeof window === "undefined") return DEFAULT_RESTAURANT_SLUG;
  const path = window.location.pathname || "";
  const m = path.match(/^\/r\/([^/]+)/);
  if (m) {
    const slug = foldSlug(decodeURIComponent(m[1]));
    try { sessionStorage.setItem(LAST_SLUG_KEY, slug); } catch {}
    return slug;
  }
  // Bare guest routes are restaurant #1's own URLs (the original single-restaurant
  // QRs) — pin them to #1 even if this tab visited another restaurant earlier.
  if (/^\/(menu|item)(\/|$)/.test(path)) {
    try { sessionStorage.setItem(LAST_SLUG_KEY, DEFAULT_RESTAURANT_SLUG); } catch {}
    return DEFAULT_RESTAURANT_SLUG;
  }
  try { return sessionStorage.getItem(LAST_SLUG_KEY) || DEFAULT_RESTAURANT_SLUG; } catch { return DEFAULT_RESTAURANT_SLUG; }
}

/** The scoped storage key for a base name, e.g. tkey("lfh_cart") → "lfh_cart:sakura-sushi". */
export function tkey(base: string): string {
  return `${base}:${tenantSlug()}`;
}

// ── one-time migration of the old, unscoped keys ────────────────────────────
// Before this fix every device stored plain "lfh_cart", "lfh_session", … Those
// all date from the single-restaurant era, so they belong to restaurant #1:
// move each one to its ":french-house" name once, then delete the old copy so
// no other restaurant can ever read it again.
const LEGACY_KEYS = [
  "lfh_session", "lfh_table", "lfh_table_name", "lfh_nickname", "lfh_guest_name",
  "lfh_cart", "lfh_active_orders", "lfh_declared", "lfh-favorites", "lfh_loc_consent",
];
const MIGRATED_FLAG = "lfh_tenant_migrated_v1";
let migrated = false;
function migrateLegacyOnce() {
  if (migrated || typeof window === "undefined") return;
  migrated = true;
  try {
    if (localStorage.getItem(MIGRATED_FLAG)) return;
    for (const base of LEGACY_KEYS) {
      const old = localStorage.getItem(base);
      const scoped = `${base}:${DEFAULT_RESTAURANT_SLUG}`;
      if (old !== null && localStorage.getItem(scoped) === null) localStorage.setItem(scoped, old);
      if (old !== null) localStorage.removeItem(base);
    }
    localStorage.setItem(MIGRATED_FLAG, "1");
  } catch {}
}

// ── get / set / remove, scoped to the current restaurant ────────────────────
// Same try/catch manners as everywhere else: storage can throw (private mode,
// full quota) and we'd rather quietly no-op than crash the menu.
export function tget(base: string): string | null {
  if (typeof window === "undefined") return null;
  migrateLegacyOnce();
  try { return localStorage.getItem(tkey(base)); } catch { return null; }
}
export function tset(base: string, value: string) {
  if (typeof window === "undefined") return;
  migrateLegacyOnce();
  try { localStorage.setItem(tkey(base), value); } catch {}
}
export function tremove(base: string) {
  if (typeof window === "undefined") return;
  migrateLegacyOnce();
  try { localStorage.removeItem(tkey(base)); } catch {}
}

// Explicit-slug variants: read/write a scoped key for a SPECIFIC restaurant,
// not "whichever page this tab is on right now". Needed by the offline outbox,
// which flushes an order that may belong to restaurant A while the tab has moved
// on to restaurant B — the order's tracker entry must land under A, not B.
export function tgetFor(base: string, slug: string): string | null {
  if (typeof window === "undefined") return null;
  migrateLegacyOnce();
  try { return localStorage.getItem(`${base}:${foldSlug(slug) || DEFAULT_RESTAURANT_SLUG}`); } catch { return null; }
}
export function tsetFor(base: string, slug: string, value: string) {
  if (typeof window === "undefined") return;
  migrateLegacyOnce();
  try { localStorage.setItem(`${base}:${foldSlug(slug) || DEFAULT_RESTAURANT_SLUG}`, value); } catch {}
}

// For cross-tab "storage" event listeners: does this event belong to the given
// base key IN THIS TAB'S restaurant? (Another restaurant's tab writing its own
// scoped copy must not wake us up.)
export function isTKey(eventKey: string | null, base: string): boolean {
  return !!eventKey && eventKey === tkey(base);
}
