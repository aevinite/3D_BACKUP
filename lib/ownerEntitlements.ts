// lib/ownerEntitlements.ts — the ADMIN → OWNER rung of the access ladder (mig 133).
//
// The admin decides, per restaurant, which OWNER-panel sections even exist and which
// manager-power toggles the owner may grant. Stored in restaurants.owner_entitlements
// (JSONB); an ABSENT key means ON, so `{}` = today's behaviour for every restaurant.
//
// SERVER-ONLY (imports supabaseAdmin, no React) — the same split as lib/panelAccess.ts.
// Clients learn their entitlements through their panel's whoami/API responses; they
// never read this table directly.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

// Owner-panel SECTIONS the admin can switch off (nav + API both honour these).
// "ratings" (mig 138) gates the guest star-ratings view/management the owner + manager
// get on the Feedback & issues page.
// "customers" (guest list from the customers table) + "settings" (owner appearance /
// password / what's-enabled) added 2026-07-07; absent = ON, so every restaurant gets them.
export const OWNER_SECTION_KEYS = ["reports", "staff", "issues", "ratings", "customers", "settings"] as const;
export type OwnerSectionKey = (typeof OWNER_SECTION_KEYS)[number];

// The manager powers (mig 091). The admin's availability switch for each lives under
// "power_<flag>" — OFF means the toggle disappears from the owner's panel and the
// manager's effective power is off no matter what the owner granted before.
//  · edit_settings  — enforced in the editor (mig, route:1203) but had no owner toggle.
//  · view_ratings   — see + handle guest ratings in the manager panel (mig 138).
//  · table_tags      — mark tables VIP/Family/Owner's-Guest + settle "on the house" (mig 166).
//  · khata           — park a bill on a person to collect later + manage the khata book (mig 166).
//  · take_orders    — take a brand-new dine-in order from the manager panel, exactly
//    like the waiter tablet does (2026-07-22). Part of the full 4-rung ladder (see
//    below): the FEATURE is entitled by default (taking orders is the tablet's existing
//    core function — turning the entitlement off would stop every live tablet), but the
//    owner→manager GRANT (manager_permissions.take_orders) defaults OFF, so a manager
//    only gets it when the owner deliberately hands it over.
export const MANAGER_POWER_FLAGS = ["manage_staff", "edit_menu", "give_discounts", "view_dashboard", "void_bills", "edit_settings", "view_ratings", "table_tags", "khata", "take_orders"] as const;
export const powerEntitlementKey = (flag: string) => `power_${flag}`;

// The authoritative "is this feature available for this restaurant AT ALL?" check
// (rung 1a of the ladder), reading a RAW owner_entitlements JSONB value. Absent = ON,
// so no existing restaurant changes when a new flag is added. The admin turns this OFF
// to remove the feature from a restaurant entirely (hides every rung below).
export function powerEntitled(rawEntitlements: unknown, flag: string): boolean {
  const key = powerEntitlementKey(flag);
  const v = rawEntitlements && typeof rawEntitlements === "object" ? (rawEntitlements as Record<string, unknown>)[key] : undefined;
  return typeof v === "boolean" ? v : true;
}

// ── Rung 1b: admin MAX-DEPTH / reach (owner rule, 2026-07-22) ──────────────────
// Per feature the admin caps HOW FAR the ladder may reach: owner-only, owner+manager,
// or owner+manager+tablet. Stored as a STRING under "depth_<flag>" in the SAME
// owner_entitlements JSONB (the boolean merge ignores it; dedicated helpers below read
// it). Absent = "tablet" (full reach) so nothing is silently narrowed for existing
// restaurants — the admin deliberately restricts it.
export type FeatureDepth = "owner" | "manager" | "tablet";
export const DEPTH_ORDER: FeatureDepth[] = ["owner", "manager", "tablet"];
export const featureDepthKey = (flag: string) => `depth_${flag}`;
export function featureDepth(rawEntitlements: unknown, flag: string): FeatureDepth {
  const v = rawEntitlements && typeof rawEntitlements === "object" ? (rawEntitlements as Record<string, unknown>)[featureDepthKey(flag)] : undefined;
  return v === "owner" || v === "manager" || v === "tablet" ? v : "tablet";
}
// Does the admin's chosen reach for this feature extend down to `level`?
export function depthAllows(depth: FeatureDepth, level: FeatureDepth): boolean {
  return DEPTH_ORDER.indexOf(depth) >= DEPTH_ORDER.indexOf(level);
}

export const OWNER_ENTITLEMENT_KEYS: readonly string[] = [
  ...OWNER_SECTION_KEYS,
  ...MANAGER_POWER_FLAGS.map(powerEntitlementKey),
];

export type OwnerEntitlements = Record<string, boolean>;

// Merge a raw JSONB value over the all-on defaults (absent/non-boolean = ON). Only the
// BOOLEAN entitlement keys — the depth_<flag> strings are read separately (featureDepth).
export function mergeOwnerEntitlements(raw: unknown): OwnerEntitlements {
  const out: OwnerEntitlements = {};
  for (const k of OWNER_ENTITLEMENT_KEYS) out[k] = true;
  if (raw && typeof raw === "object") {
    for (const k of OWNER_ENTITLEMENT_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "boolean") out[k] = v;
    }
  }
  return out;
}

// One restaurant's merged entitlements. Small select on a rare path (panel boot /
// settings pages), so no cache — a flipped switch takes effect on the next load.
export async function getOwnerEntitlements(restaurantId: string): Promise<OwnerEntitlements> {
  if (!restaurantId) return mergeOwnerEntitlements(null);
  const r = await sb.from("restaurants").select("owner_entitlements").eq("id", restaurantId).maybeSingle();
  return mergeOwnerEntitlements(r.data?.owner_entitlements);
}

// The subset of these restaurants still entitled to a key — how the owner APIs
// filter a multi-restaurant owner's queries down to what the admin still allows.
export async function entitledSubset(restaurantIds: string[], key: string): Promise<string[]> {
  if (!restaurantIds.length) return [];
  const rows = (await sb.from("restaurants").select("id, owner_entitlements").in("id", restaurantIds)).data || [];
  return rows.filter((r) => mergeOwnerEntitlements(r.owner_entitlements)[key] !== false).map((r) => r.id as string);
}

// Union across a multi-restaurant owner's estate: a section shows if ANY owned
// restaurant still has it (per-restaurant data is filtered separately by the APIs).
export async function getOwnerEntitlementsUnion(restaurantIds: string[]): Promise<OwnerEntitlements> {
  if (!restaurantIds.length) return mergeOwnerEntitlements(null);
  const rows = (await sb.from("restaurants").select("owner_entitlements").in("id", restaurantIds)).data || [];
  const merged = rows.map((r) => mergeOwnerEntitlements(r.owner_entitlements));
  const out: OwnerEntitlements = {};
  for (const k of OWNER_ENTITLEMENT_KEYS) out[k] = merged.length ? merged.some((m) => m[k]) : true;
  return out;
}
