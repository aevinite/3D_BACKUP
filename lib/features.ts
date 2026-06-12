// lib/features.ts — the per-restaurant FEATURE SWITCHES (owner, 2026-06-12).
//
// One place decides what every switch defaults to; the database row (settings.
// features, migration 035) stores only the owner's overrides. Components ask
// `useFeatures()` and simply don't render what's switched off — so turning a
// feature off makes it disappear COMPLETELY, as if it was never built.
//
// The last four are BACKEND-ONLY switches (verification, payments, aggregators,
// gst_invoice): they default OFF and deliberately have NO toggle in any UI —
// flipping them is a by-hand database/settings change. Owner's instruction:
// "totally backend... like both things are not there at all."

import { useEffect, useState } from "react";
import { getSettings } from "./menu";

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
  // Backend-only switches (NO UI anywhere; default OFF):
  verification: false, // phone/email OTP before ordering (plumbing only)
  payments: false,     // in-app payment collection (plumbing only)
  aggregators: false,  // Zomato/Swiggy order intake (plumbing only)
  gst_invoice: false,  // GST tax-invoice numbering on bills
} as const;

export type FeatureKey = keyof typeof FEATURE_DEFAULTS;
export type FeatureMap = Record<FeatureKey, boolean>;

// Cache the merged answer per page-load: every component shares one fetch.
let cached: FeatureMap | null = null;
let inflight: Promise<FeatureMap> | null = null;

export async function getFeatures(): Promise<FeatureMap> {
  if (cached) return cached;
  if (!inflight) {
    inflight = getSettings()
      .then((s) => {
        cached = { ...FEATURE_DEFAULTS, ...(s.features || {}) } as FeatureMap;
        return cached;
      })
      // Offline / settings unreachable -> just use the defaults (never crash).
      .catch(() => ({ ...FEATURE_DEFAULTS } as FeatureMap));
  }
  return inflight;
}

// React hook: renders with the defaults instantly (no flash of missing UI for
// the common all-on case), then refreshes once the real switches arrive.
export function useFeatures(): FeatureMap {
  const [f, setF] = useState<FeatureMap>(cached || ({ ...FEATURE_DEFAULTS } as FeatureMap));
  useEffect(() => {
    let alive = true;
    getFeatures().then((v) => { if (alive) setF(v); });
    return () => { alive = false; };
  }, []);
  return f;
}
