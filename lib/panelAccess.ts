// lib/panelAccess.ts — per-restaurant PANEL entitlements (owner 2026-06-29).
//
// Which operational panels a restaurant has: manager / kitchen / tablet / owner. The
// ADMIN turns these on/off per restaurant (settings.enabled_panels, mig 106). A panel that
// is OFF blocks that role's login and hides it. This is the panel-axis sibling of
// settings.features (guest switches) — stored the same way, scoped by restaurant_id.
//
// SERVER-ONLY: the gate runs server-side (panel-login route + panelGate), so this reads via
// supabaseAdmin and pulls in NO React (unlike lib/features.ts) so route handlers can import
// it. A missing row / missing-or-non-boolean key defaults ON — backward-compatible with any
// restaurant that predates the column (though mig 106 backfills every existing row all-on).
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import type { Role } from "@/lib/userAuth";
import { readInChunks } from "@/lib/inChunks";

export const PANEL_KEYS = ["manager", "kitchen", "tablet", "owner"] as const;
export type PanelKey = (typeof PANEL_KEYS)[number];
const ALL_ON: Record<PanelKey, boolean> = { manager: true, kitchen: true, tablet: true, owner: true };

// EVERY RESTAURANT HAS ALL FOUR STAFF APPS (owner, 2026-07-31: "remove it completely, all panels
// always on"). The four switches were deleted from the Access screen in the same change, so this
// must NOT go on honouring a stored value: one restaurant (demo-bistro) had its owner panel off,
// and reading that column would have left an owner login refused by a switch nobody can reach any
// more. Answering ON regardless is what makes the removal safe instead of a trap.
//
// Kept as a function rather than ripped out: settings.enabled_panels still holds the old values,
// several callers read this, and ONE honest place that says "always on" is clearer than deleting it
// and scattering `true` through every caller. It also stays a cheap no-op — this used to be a
// settings read on the hot path, which is why the cached variant below exists.
//
// Whether the MENU EDITOR exists is a different question and is NOT decided here: that follows the
// Menu feature in Main features, enforced by the Edit-menu tab gate, so a restaurant without a menu
// never builds one (no dead screen, no wasted reads).
export async function getEnabledPanels(_restaurantId: string): Promise<Record<PanelKey, boolean>> {
  return { ...ALL_ON };
}

// Is this role's panel enabled for the restaurant? owner/manager/kitchen/tablet map 1:1 to a
// panel; any other role string is allowed (defensive — never lock someone out on a typo).
export async function isPanelEnabled(role: Role, restaurantId: string): Promise<boolean> {
  if (!(PANEL_KEYS as readonly string[]).includes(role)) return true;
  const p = await getEnabledPanels(restaurantId);
  return p[role as PanelKey] !== false;
}

// Cached variant for the HOT path (requireRole runs on every polled request). A per-request
// settings read would reintroduce the egress the owner fights, so cache the enabled-panels
// map per restaurant for a short TTL — an admin flipping a panel OFF then takes effect within
// TTL seconds instead of instantly, which is fine (bug M3, 2026-07-05). The login route keeps
// using the uncached isPanelEnabled (login is rare + must be immediate).
const _panelCache = new Map<string, { at: number; on: boolean }>();
const PANEL_TTL_MS = 30_000;
export async function isPanelEnabledCached(role: Role, restaurantId: string): Promise<boolean> {
  if (!(PANEL_KEYS as readonly string[]).includes(role)) return true;
  if (!restaurantId) return true;
  const key = `${restaurantId}:${role}`;
  const hit = _panelCache.get(key);
  if (hit && Date.now() - hit.at < PANEL_TTL_MS) return hit.on;
  const on = await isPanelEnabled(role, restaurantId);
  _panelCache.set(key, { at: Date.now(), on });
  return on;
}

// OWNER-panel entitlement for a specific OWNER USER. An owner's staff_users row
// carries the #1 "home" restaurant_id (a namespace, not ownership), so checking
// isPanelEnabled('owner', u.restaurant_id) tested restaurant #1's toggle — wrong
// restaurant entirely (found in the 2026-07-06 owner-portfolio redesign). The
// real rule: an owner may use the owner panel if ANY live (non-binned) restaurant
// they own (restaurant_owners, mig 097) has the owner panel enabled. Cached like
// the per-restaurant map — requireRole runs on every polled owner request.
const _ownerCache = new Map<string, { at: number; ids: string[] }>();

// The exact set of restaurants an owner may use the owner panel FOR: those they own
// (restaurant_owners, mig 097) that are LIVE (not binned) AND still have the owner panel
// switched on by the admin. This is the single source of truth for owner-panel access —
// lib/ownerScope (every /api/owner/* call) and app/owner/layout (the page gate) both scope
// to it, so when the admin turns the owner panel off or bins a restaurant, an already-open
// owner tab loses that restaurant within the 30s cache TTL instead of keeping full access
// for the 7-day cookie life (audit 2026-07-07 — the parallel M3/H2 fix for the other panels
// was never carried over to the owner layer). Cached (30s) so the hot path adds no read.
/** Thrown when we could not READ whether someone owns anything — as opposed to knowing they
 *  own nothing. Callers turn this into "couldn't load, please try again", never into a
 *  permission or "not set up" message. */
export class OwnedLookupFailed extends Error {
  constructor(cause?: unknown) {
    super("Couldn't read which restaurants this owner has");
    this.name = "OwnedLookupFailed";
    if (cause && typeof cause === "object" && "message" in cause) this.cause = (cause as { message: unknown }).message;
  }
}

// On a failed read: hand back the last answer we trusted (even if the TTL has passed — stale
// truth beats a confident lie), otherwise throw. Nothing is written to the cache either way,
// so the next call retries instead of serving the blip for 30s.
function staleOrThrow(userId: string, cause: unknown): string[] {
  const prev = _ownerCache.get(userId);
  if (prev) return prev.ids;
  throw new OwnedLookupFailed(cause);
}

// AN OWNER'S ESTATE IS NOT CAPPED AT 50 (T19 sweep, 2026-08-14). This read was
// `.limit(50)` — past the 50th ownership link the rest were dropped with no error and no note,
// and the short answer was then CACHED for the TTL. Because this helper is the one source of
// truth (see the block above), a 51st restaurant would simply be absent from the owner's
// sidebar, the Menu picker, Manager mode and every /api/owner/* call at once, with nothing on
// any screen to say so. The sibling helper for the same job already refuses to do that —
// `scopedRestaurantIds` in lib/ownerScope.ts pages in thousands and throws
// `RestaurantListIncomplete` rather than hand back a partial list — so the two disagreed about
// what a complete list means. Paged the same way here; a page read that fails goes through
// staleOrThrow like every other read in this function, so a blip is never a shorter estate.
const OWNED_PAGE = 1000;
async function ownedLinkIds(userId: string): Promise<{ ids?: string[]; error?: unknown }> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += OWNED_PAGE) {
    const r = await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", userId)
      .order("restaurant_id").range(offset, offset + OWNED_PAGE - 1);
    if (r.error) return { error: r.error };
    const batch = (r.data || []).map((x) => x.restaurant_id as string);
    ids.push(...batch);
    if (batch.length < OWNED_PAGE) return { ids };
  }
}

export async function enabledOwnedRestaurantIds(userId: string, cached = true): Promise<string[]> {
  if (!userId) return [];
  const hit = cached ? _ownerCache.get(userId) : undefined;
  if (hit && Date.now() - hit.at < PANEL_TTL_MS) return hit.ids;
  const links = await ownedLinkIds(userId);
  // A FAILED read must never look like "this owner has no restaurants". Every `.data || []`
  // here used to swallow the error, so one DB blip produced an empty list — and the caller
  // then told the owner "no restaurants are assigned to you" / "staff management isn't
  // enabled", which is a lie about their setup, AND it got cached for the whole TTL.
  // Now: reuse the last known-good answer if we have one, else throw so the caller can say
  // "couldn't load, try again" instead of inventing a configuration problem. (2026-07-31)
  if (links.error) return staleOrThrow(userId, links.error);
  const owned = links.ids || [];
  let ids: string[] = [];
  if (owned.length) {
    // Two scoped reads: live restaurants ∩ owned ids, joined against their settings.
    //
    // BOTH GO THROUGH readInChunks, and that is the SECOND half of the T19 fix (T25 sweep,
    // 2026-08-21). The paging above stopped the ownership LINKS being cut short at 50; these two
    // reads FILTER that list, and they were still inlining every id in one URL with no `.limit()`.
    // Measured on this stack: an `.in()` list of 800 uuids (29.6 KB) comes back "Bad Request", and
    // a select with no limit is silently capped at 1,000 rows. Either way the estate comes back
    // SHORT — and because this helper is the single source of truth for owner-panel access, a
    // missing restaurant vanishes from the sidebar, the Menu picker, Manager mode and every
    // /api/owner/* call at once, with nothing on any screen to say so. Same fault, one level down.
    const [restQ, setQ] = await Promise.all([
      readInChunks<{ id: string }>(owned, (chunk) =>
        sb.from("restaurants").select("id").in("id", chunk).is("deleted_at", null).limit(chunk.length)),
      readInChunks<{ restaurant_id: string; enabled_panels: unknown }>(owned, (chunk) =>
        sb.from("settings").select("restaurant_id, enabled_panels").in("restaurant_id", chunk).limit(chunk.length)),
    ]);
    if (restQ.error) return staleOrThrow(userId, restQ.error);
    if (setQ.error) return staleOrThrow(userId, setQ.error);
    const live = new Set((restQ.rows || []).map((r) => r.id));
    const panelsByRid = new Map((setQ.rows || []).map((r) => [r.restaurant_id, r.enabled_panels as Record<string, unknown> | null]));
    ids = owned.filter((rid) => {
      if (!live.has(rid)) return false;
      const p = panelsByRid.get(rid);
      // Missing row / key defaults ON (same backward-compat rule as getEnabledPanels).
      return !(p && typeof p === "object" && (p as Record<string, unknown>).owner === false);
    });
  }
  _ownerCache.set(userId, { at: Date.now(), ids });
  return ids;
}

// OWNER-panel entitlement for a specific OWNER USER — true if ANY live (non-binned)
// restaurant they own still has the owner panel on. Derived from the id list above.
export async function ownerPanelEnabled(userId: string, cached = true): Promise<boolean> {
  return (await enabledOwnedRestaurantIds(userId, cached)).length > 0;
}

// Is this restaurant in the RECYCLE BIN (soft-deleted, migration 128)? A binned
// restaurant is treated as gone: staff can't log in and existing sessions are
// bounced (the guest resolver already hides it). Cached like the panel map so
// this runs on the hot panel-gate path without a read per request; a fresh
// delete/restore takes effect within TTL. Fail-OPEN on error (a DB blip must not
// lock every restaurant out) — the guest resolver is the authoritative hide.
const _deletedCache = new Map<string, { at: number; deleted: boolean }>();
export async function isRestaurantDeleted(restaurantId: string): Promise<boolean> {
  if (!restaurantId) return false;
  const hit = _deletedCache.get(restaurantId);
  if (hit && Date.now() - hit.at < PANEL_TTL_MS) return hit.deleted;
  try {
    const row = await sb.from("restaurants").select("deleted_at").eq("id", restaurantId).maybeSingle();
    const deleted = !!row.data?.deleted_at;
    _deletedCache.set(restaurantId, { at: Date.now(), deleted });
    return deleted;
  } catch {
    return false;
  }
}
