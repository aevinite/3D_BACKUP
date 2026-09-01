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
// ── BOTH CACHES BELOW ARE KEYED ON A SLUG SOMEBODY TYPED (owner picked item 19, 2026-08-30) ──────
//
// Every other cache in this codebase is keyed on a restaurant id, an owner id or a person's id, so
// it is bounded by the estate — nine entries today, a few hundred at worst. These two are keyed on
// whatever was in the ADDRESS BAR, on a public path nobody has to log in to reach. A crawler walking
// /r/<random>/menu adds one entry per distinct string it invents, and nothing ever removed one.
//
// It is small (a slug plus a tiny object, or a slug plus a string) and it only ever grows, which is
// the shape worth closing before it matters rather than after. lib/floorSummary.ts, lib/planTable.ts
// and lib/publicCap.ts all already do exactly this; these two were the ones that did not.
//
// SWEPT OPPORTUNISTICALLY, on the miss path only — never on a timer and never on a hit, so a real
// menu load pays nothing. `keep` is the window past which an entry can no longer be USED for
// anything: for the restaurant cache that is the stale-on-error window (not the 15s TTL, because an
// entry older than the TTL is still the answer a failed read stands on), and for the moved-address
// cache it is its own TTL.
//
// The threshold is deliberately far above any real number of restaurants on one instance, so a
// genuine multi-tenant stack never sweeps and never notices this exists.
const CACHE_MAX = 500;
function sweep(m: Map<string, { at: number }>, keep: number): void {
  if (m.size <= CACHE_MAX) return;
  const now = Date.now();
  for (const [k, v] of m) if (now - v.at > keep) m.delete(k);
  // Still oversized means the entries are all fresh — a real burst rather than a crawler. Drop the
  // OLDEST half rather than clearing: clearing would throw away answers a live diner is using.
  if (m.size > CACHE_MAX) {
    const oldest = [...m.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, Math.floor(m.size / 2));
    for (const [k] of oldest) m.delete(k);
  }
}

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
 * HOW IT WAS FOUND, accurately: a 485-phase run had eight guest-menu phases fail with
 * `/r/french-house/menu → 404` for a restaurant that was present and active. Those particular
 * 404s turned out to have a DIFFERENT cause — verify-access-live.mjs crashed with the Menu master
 * switch off and never put it back (fixed separately) — but reading the code path they pointed at
 * turned up this fault sitting there unexercised. It is real: a failed read genuinely produced a
 * cached "no such restaurant" for 15 seconds, which is what a scanned QR would have shown.
 *
 * So a failed read now (a) is never cached, and (b) answers with the last known row if we have
 * one, and otherwise THROWS — because "something went wrong, try again" is honest and a 404 is
 * not. A genuinely unknown slug, and a restaurant in the recycle bin, still return null exactly
 * as before.
 */
export async function getRestaurantBySlug(slugRaw: string): Promise<Restaurant | null> {
  // CAPITALS MUST BEHAVE EXACTLY LIKE LOWER CASE (owner, 2026-08-12: *"make sure c capital and
  // small works as a same … it should be identical only"*).
  //
  // Slugs are stored lower case and `lfh_guest_restaurant` matches them exactly, so
  // `/r/French-House/menu` answered 404 while `/r/french-house/menu` answered 200 — measured on the
  // deployed site (guest sweep T1). A diner does not have to do anything unusual to hit that: a
  // chat app capitalising the first letter of a pasted link, a printed card set in Title Case, or
  // simply typing it. And the page they land on says the restaurant is not available, which is a
  // lie about a restaurant that is right there.
  //
  // Folded HERE rather than in each route because all three guest doors, the item pages, the
  // menu-data API and lib/panelGate.ts every one of them resolve through this function — one place
  // to be case-blind, and the per-process cache is keyed on the folded value so `/r/FRENCH-HOUSE`
  // and `/r/french-house` share one entry instead of reading the database twice.
  const slug = String(slugRaw || "").trim().toLowerCase();
  const hit = bySlug.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  sweep(bySlug, STALE_ON_ERROR_MS);
  // ONE DOOR (mig 282): a SECURITY DEFINER function returns this restaurant's guest slice as one
  // object — `to_jsonb(row)` minus the permission/ownership block (access_config,
  // manager_permissions, owner_entitlements, owner_user_id). It used to be a column list read
  // straight off the table with the public key, which required anon to hold a table-wide read on
  // `restaurants` and handed every guest the whole Access & permissions tree of every restaurant.
  // Not a column grant and not a view: both enumerate columns and so must match the list here,
  // and a mismatch is a hard error. A missing key on an object is just `undefined`.
  const { data, error } = await supabase
    .rpc("lfh_guest_restaurant", { p_slug: slug });
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

// ── AN OLD PRINTED QR CODE STILL FINDS THE RESTAURANT (mig 350) ─────────────────────────────────
// A QR code encodes the ADDRESS, not the restaurant, so when a restaurant's address changes every
// laminated table card it printed stops working. This answers "that address is retired — where did
// they go?" and the guest routes turn the answer into a redirect.
//
// COST: this is only ever asked AFTER getRestaurantBySlug has already returned null, i.e. for an
// address that resolves to nothing. The happy path — every real menu load, every dish page — never
// reaches it and pays nothing. A genuinely unknown slug (a typo, a bot, a stale link) costs one
// tiny function call, and the answer is cached either way, so a crawler hammering one bad URL is a
// single round-trip and then memory.
//
// It can only ever answer into a VACANCY: lfh_slug_moved refuses if a live restaurant currently
// holds the address (that restaurant owns it, and its own guests scan it). So this can never take
// a diner away from the menu they meant to open.
const movedSlug = new Map<string, { value: string | null; at: number }>();
// Longer than the restaurant TTL on purpose: a retired address is a fact about the past, and the
// thing it points AT is re-resolved separately on the next request anyway.
const MOVED_TTL_MS = 60_000;

/**
 * The current address of the restaurant that used to answer on `slug`, or null.
 *
 * Null means "no redirect" and is the answer for almost every caller: an unknown slug, a slug a
 * live restaurant still holds, or a retired slug whose restaurant is now in the recycle bin (a
 * binned restaurant's menu stays closed — every guest surface already treats it as absent).
 *
 * NEVER THROWS. A failed lookup here must not turn a plain 404 into a crash: the caller is already
 * on its way to notFound(), and this is only trying to do better than that.
 */
export async function slugMovedTo(slugRaw: string): Promise<string | null> {
  const slug = String(slugRaw || "").trim().toLowerCase();
  if (!slug) return null;
  const hit = movedSlug.get(slug);
  if (hit && Date.now() - hit.at < MOVED_TTL_MS) return hit.value;
  sweep(movedSlug, MOVED_TTL_MS);
  try {
    const { data, error } = await supabase.rpc("lfh_slug_moved", { p_slug: slug });
    if (error) return hit ? hit.value : null;   // stand on a known answer, never invent one
    const to = typeof data === "string" && data ? data : null;
    movedSlug.set(slug, { value: to, at: Date.now() });
    return to;
  } catch {
    return hit ? hit.value : null;
  }
}

/**
 * A URL query string rebuilt from Next's `searchParams`, or "" when there is none.
 *
 * `?table=N` IS THE WHOLE POINT of carrying it: a QR code encodes the table, so any redirect on a
 * guest door that drops the query has taken the diner's table away from them and they will be asked
 * to join one again at a table the app had already been told about. Shared so the case-folding
 * redirect and the moved-address redirect cannot drift apart on it.
 */
export function queryStringOf(sp: Record<string, string | string[] | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else qs.append(k, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}
