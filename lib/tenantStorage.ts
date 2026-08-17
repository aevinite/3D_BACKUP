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
export function tenantSlug(): string {
  if (typeof window === "undefined") return DEFAULT_RESTAURANT_SLUG;
  const path = window.location.pathname || "";
  const m = path.match(/^\/r\/([^/]+)/);
  if (m) {
    // FOLDED, because the slug in the address bar is whatever was typed or shared, and this string
    // becomes the NAME OF THE STORAGE BUCKET for the cart, the scanned table, the favourites and
    // the dining session (guest sweep T1, 2026-08-17).
    //
    // getRestaurantBySlug() has always folded case, so /r/French-House/menu resolves and renders
    // perfectly — and MenuView namespaces the browse state it owns from the RESOLVED slug. This
    // function did not fold, so one diner on one phone ended up with two scopes at once:
    //
    //     lfh_menu_layout:french-house     (MenuView, resolved)
    //     lfh_table:French-House           (here, as typed)      ← measured, /menu?table=4
    //
    // The table is what costs someone something: the menu builds its dish links from the resolved
    // slug, so the first dish a diner taps moves them to the lower-case address, where
    // getScannedTable() returns "" and they are asked to join a table they are already sitting at.
    // The menu route now also redirects an oddly-cased address to the canonical one, but this is
    // the root cause — it is what protects a guest who lands STRAIGHT on /r/<Slug>/item/... from a
    // shared dish link, without passing through the menu page at all.
    //
    // Safe to fold here because a slug is lower-case by construction everywhere it is created
    // (lib/tenant.ts folds on every lookup), so this can only ever CORRECT a mis-cased address —
    // it can never point at a different restaurant.
    const slug = decodeURIComponent(m[1]).trim().toLowerCase();
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
// Folded for the same reason tenantSlug() folds: a caller may hand us a slug that came from a URL,
// and the bucket name has to be the one the rest of the app uses.
const fold = (slug: string) => (slug || DEFAULT_RESTAURANT_SLUG).trim().toLowerCase();
export function tgetFor(base: string, slug: string): string | null {
  if (typeof window === "undefined") return null;
  migrateLegacyOnce();
  try { return localStorage.getItem(`${base}:${fold(slug)}`); } catch { return null; }
}
export function tsetFor(base: string, slug: string, value: string) {
  if (typeof window === "undefined") return;
  migrateLegacyOnce();
  try { localStorage.setItem(`${base}:${fold(slug)}`, value); } catch {}
}

// For cross-tab "storage" event listeners: does this event belong to the given
// base key IN THIS TAB'S restaurant? (Another restaurant's tab writing its own
// scoped copy must not wake us up.)
export function isTKey(eventKey: string | null, base: string): boolean {
  return !!eventKey && eventKey === tkey(base);
}
