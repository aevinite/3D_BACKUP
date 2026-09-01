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
import { getSettings, invalidateSettings } from "./menu";
import { DEFAULT_RESTAURANT_ID } from "./tenant";

export const FEATURE_DEFAULTS = {
  // Guest-facing switches (editable in the editor's Features tab):
  ratings: true,      // star ratings on dish cards + detail pages
  reviews: true,      // written guest reviews on dish detail pages
  model3d: true,      // the 3D dish viewer (buttons + background preloading)
  allergies: true,    // allergen warnings, the allergy filter, allergies on orders
  // The two FREE-TEXT halves of the allergy/notes step (access rebuild, 2026-07-31). Off
  // removes only the typing — a guest may still pick from the restaurant's presets.
  allergy_other: true, // the "Other…" box for an allergy that isn't on the list
  guest_note: true,    // the free-text note a guest sends to the kitchen
  favorites: true,    // the heart button + the Favorites tab
  waiter_calls: true, // the call-waiter bell + popup
  search: true,       // the dish search box
  languages: true,    // the language picker (off = English only)
  currency: true,     // the currency picker (off = ₹ only)
  // `scrollspy` USED TO LIVE HERE and was removed 2026-08-07 (T1 improvement 7). It was a switch
  // that could not do anything: the auto-following category strip is always on — see the note in
  // lib/accessModel.ts, "sticky category bar / scrollspy removed — always on, no toggle" — and no
  // component has ever read this key. The editor still OFFERED it under Features, so a restaurant
  // could switch it off, watch the strip keep following, and go looking for a bug that isn't there.
  // A restaurant whose saved settings still carry `scrollspy` is unaffected: getFeatures spreads the
  // DB overrides over these defaults, so the stray key just rides along unread.
  diet_filter: true,  // the Veg / Non-Veg filter group on the menu (off for pure-veg restaurants)
  // PREP TIME ON A DISH CARD — OFF unless a restaurant asks for it (owner, 2026-08-12: *"We don't
  // need time column only for the restaurant which requires it. We will add it if you want to add
  // the setting and permission do that and off that thing"*). Before this, the editor had a "Prep
  // time" box whose value reached NO screen at all: `time` was not in CARD_COLUMNS, and the dish page
  // never printed it either — so an owner typed "20 min", saved, and nothing showed anywhere
  // (guest sweep T1). It is now a real, admin-controlled switch that starts off.
  prep_time: false,
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
  // …AND the settings cache these switches are DERIVED from (T13 sweep, 2026-08-13). Clearing only
  // the two maps above looked like a refresh and was not one: getFeatures() below calls getSettings(),
  // which has its own 8-second cache, so within that window this re-read the PRE-TOGGLE row and then
  // stored the old feature map in `cached` — which has no TTL — and pushed it to every subscriber as
  // the new truth. The real delivery time for a feature switch was therefore the 60-second backstop,
  // not the breadcrumb that had just arrived. See invalidateSettings() in lib/menu.ts.
  invalidateSettings(restaurantId);
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
        // best-effort: a phone with storage switched off still gets the flags from the fetch above
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
/**
 * `seed` — THE SWITCHES THE SERVER ALREADY KNEW (sweep #7 T2, 2026-09-01, finishing item 9).
 *
 * Without it this hook's FIRST value is always FEATURE_DEFAULTS, and the real switches land a tick
 * later. That was invisible while every screen showed a spinner until its data arrived. It stopped
 * being invisible the moment the dish page began rendering its dish on the server: the
 * server-rendered HTML was built with `ratings: true` and `reviews: true` because those are the
 * DEFAULTS, so a restaurant with ratings switched OFF had a five-star row in its own page's HTML.
 * On a normal load React corrects it in a frame and nobody sees it. On a reload with no signal
 * React never boots at all — measured on this stack — so that star row was simply the page.
 *
 * A server component that has already read `settings` can hand the derived map in here, and then
 * the first paint, the shared HTML and the offline view all obey the same switches the live screen
 * does. Optional, so every existing caller is unchanged.
 */
export function useFeatures(
  restaurantId: string = DEFAULT_RESTAURANT_ID,
  // The RAW `settings.features` bag, not a finished FeatureMap — deliberately, so a SERVER
  // component can pass it without importing anything from this file. This module imports
  // `useEffect`, which makes it unimportable from a server component at all: the first version of
  // this exported a `featuresFromSettings()` helper here and the two dish routes went blank with
  // *"You're importing a module that depends on useEffect into a React Server Component"*. A plain
  // JSON object crosses the boundary with no import, and the spread below turns it into the map.
  seed?: Record<string, boolean> | null,
): FeatureMap {
  const [f, setF] = useState<FeatureMap>(
    // The seed only ever LEADS: the cache still wins when this tab has already learned the truth,
    // and the effect below still re-reads and still subscribes, so a live toggle behaves as before.
    cached.get(restaurantId) || (seed ? ({ ...FEATURE_DEFAULTS, ...seed } as FeatureMap) : ({ ...FEATURE_DEFAULTS } as FeatureMap)),
  );
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
