// lib/features.ts — the per-restaurant FEATURE SWITCHES (owner, 2026-06-12).
//
// One place decides what every switch defaults to; the database row (settings.
// features, migration 035) stores only the owner's overrides. Components ask
// `useFeatures(restaurantId)` and simply don't render what's switched off — so
// turning a feature off makes it disappear COMPLETELY, as if it was never built.
//
// MULTI-TENANT (Phase 1d): every cache + the localStorage key is keyed by
// restaurantId, so restaurant A's switches never leak into restaurant B, and a
// returning guest's first paint reflects THAT restaurant's last-known switches.
//
// The last four are BACKEND-ONLY switches (verification, payments, aggregators,
// gst_invoice): they default OFF and deliberately have NO toggle in any UI —
// flipping them is a by-hand database/settings change.

import { useEffect, useState } from "react";
import { getSettings } from "./menu";
import { DEFAULT_RESTAURANT_ID } from "./tenant";

export const FEATURE_DEFAULTS = {
  // Guest-facing switches (editable in the editor's Features tab):
  ratings: true,      // star ratings on dish cards + detail pages
  reviews: true,      // written guest reviews on dish detail pages
  model3d: true,      // the 3D dish viewer (buttons + background preloading)
  allergies: true,    // allergen warnings, the allergy filter, allergies on orders
  favorites: true,    // the heart button + the Favorites tab
  waiter_calls: true, // the call-waiter bell + popup
  search: true,       // the dish search box
  languages: true,    // the language picker (off = English only)
  currency: true,     // the currency picker (off = ₹ only)
  scrollspy: true,    // the auto-following category strip in the All view
  diet_filter: true,  // the Veg / Non-Veg filter group on the menu (off for pure-veg restaurants)
  // Backend-only switches (NO UI anywhere; default OFF):
  verification: false, // phone/email OTP before ordering (plumbing only)
  payments: false,     // in-app payment collection (plumbing only)
  aggregators: false,  // Zomato/Swiggy order intake (plumbing only)
  gst_invoice: false,  // GST tax-invoice numbering on bills
} as const;

export type FeatureKey = keyof typeof FEATURE_DEFAULTS;
export type FeatureMap = Record<FeatureKey, boolean>;

// Per-restaurant caches: a restaurant's switches are independent of every other's.
const cached = new Map<string, FeatureMap>();
const inflight = new Map<string, Promise<FeatureMap>>();

// Live subscribers per restaurant: every mounted useFeatures() registers its
// setter here so a refreshFeatures(rid) (fired by a realtime 'menu'/'settings'
// breadcrumb) updates exactly that restaurant's mounted components.
const subscribers = new Map<string, Set<(f: FeatureMap) => void>>();
function subsFor(rid: string): Set<(f: FeatureMap) => void> {
  let s = subscribers.get(rid);
  if (!s) { s = new Set(); subscribers.set(rid, s); }
  return s;
}

// Per-restaurant localStorage key, so a returning guest's first paint reflects
// THIS restaurant's last-known switches (and toggling one restaurant never shows
// stale switches for another — also fixes the old single-key staleness).
function lsKey(rid: string): string { return `lfh_features:${rid}`; }

function readSaved(rid: string): FeatureMap | null {
  try {
    const raw = typeof localStorage !== "undefined" && localStorage.getItem(lsKey(rid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return { ...FEATURE_DEFAULTS, ...parsed } as FeatureMap;
  } catch { return null; }
}

// Re-fetch settings for ONE restaurant and push the new switches to its live
// components. Called by the guest menu's useRealtime() when the owner toggles a
// feature (or admin changes an entitlement).
export async function refreshFeatures(restaurantId: string = DEFAULT_RESTAURANT_ID): Promise<void> {
  cached.delete(restaurantId);
  inflight.delete(restaurantId);
  const fresh = await getFeatures(restaurantId);
  subsFor(restaurantId).forEach((cb) => cb(fresh));
}

export async function getFeatures(restaurantId: string = DEFAULT_RESTAURANT_ID): Promise<FeatureMap> {
  const hit = cached.get(restaurantId);
  if (hit) return hit;
  let pending = inflight.get(restaurantId);
  if (!pending) {
    pending = getSettings(restaurantId)
      .then((s) => {
        const map = { ...FEATURE_DEFAULTS, ...(s.features || {}) } as FeatureMap;
        cached.set(restaurantId, map);
        try { localStorage.setItem(lsKey(restaurantId), JSON.stringify(map)); } catch {}
        return map;
      })
      .catch(() => {
        // Offline / settings unreachable: last-known saved switches, else defaults.
        // Clear inflight so the NEXT call retries (don't cache a failure forever).
        inflight.delete(restaurantId);
        return readSaved(restaurantId) || ({ ...FEATURE_DEFAULTS } as FeatureMap);
      });
    inflight.set(restaurantId, pending);
  }
  return pending;
}

// React hook. The initial value MUST match what the server renders (it can't read
// localStorage), so it starts from the in-memory cache or the defaults — reading
// localStorage here would cause a hydration mismatch. The effect then (1) applies
// the saved switches from the last visit right away (one frame, no network wait)
// and (2) refreshes from live settings. Re-subscribes if restaurantId changes.
export function useFeatures(restaurantId: string = DEFAULT_RESTAURANT_ID): FeatureMap {
  const [f, setF] = useState<FeatureMap>(cached.get(restaurantId) || ({ ...FEATURE_DEFAULTS } as FeatureMap));
  useEffect(() => {
    let alive = true;
    if (!cached.get(restaurantId)) { const saved = readSaved(restaurantId); if (saved && alive) setF(saved); }
    getFeatures(restaurantId).then((v) => { if (alive) setF(v); });
    const subs = subsFor(restaurantId);
    subs.add(setF);
    return () => { alive = false; subs.delete(setF); };
  }, [restaurantId]);
  return f;
}
