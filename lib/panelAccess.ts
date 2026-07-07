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

export const PANEL_KEYS = ["manager", "kitchen", "tablet", "owner"] as const;
export type PanelKey = (typeof PANEL_KEYS)[number];
const ALL_ON: Record<PanelKey, boolean> = { manager: true, kitchen: true, tablet: true, owner: true };

// The merged enabled-panels map for one restaurant (defaults overlaid with its overrides).
export async function getEnabledPanels(restaurantId: string): Promise<Record<PanelKey, boolean>> {
  const out: Record<PanelKey, boolean> = { ...ALL_ON };
  if (!restaurantId) return out;
  const row = await sb.from("settings").select("enabled_panels").eq("restaurant_id", restaurantId).maybeSingle();
  const stored = row.data?.enabled_panels;
  if (stored && typeof stored === "object") {
    for (const k of PANEL_KEYS) {
      const v = (stored as Record<string, unknown>)[k];
      if (typeof v === "boolean") out[k] = v;
    }
  }
  return out;
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
export async function enabledOwnedRestaurantIds(userId: string, cached = true): Promise<string[]> {
  if (!userId) return [];
  const hit = cached ? _ownerCache.get(userId) : undefined;
  if (hit && Date.now() - hit.at < PANEL_TTL_MS) return hit.ids;
  const links = await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", userId).limit(50);
  const owned = (links.data || []).map((r) => r.restaurant_id as string);
  let ids: string[] = [];
  if (owned.length) {
    // One scoped read: live restaurants ∩ owned ids, joined against their settings.
    const [restQ, setQ] = await Promise.all([
      sb.from("restaurants").select("id").in("id", owned).is("deleted_at", null),
      sb.from("settings").select("restaurant_id, enabled_panels").in("restaurant_id", owned),
    ]);
    const live = new Set((restQ.data || []).map((r) => r.id as string));
    const panelsByRid = new Map((setQ.data || []).map((r) => [r.restaurant_id as string, r.enabled_panels as Record<string, unknown> | null]));
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
