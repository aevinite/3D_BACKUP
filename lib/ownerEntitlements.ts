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
export const OWNER_SECTION_KEYS = ["reports", "staff", "issues"] as const;
export type OwnerSectionKey = (typeof OWNER_SECTION_KEYS)[number];

// The five manager powers (mig 091). The admin's availability switch for each lives
// under "power_<flag>" — OFF means the toggle disappears from the owner's panel and
// the manager's effective power is off no matter what the owner granted before.
export const MANAGER_POWER_FLAGS = ["manage_staff", "edit_menu", "give_discounts", "view_dashboard", "void_bills"] as const;
export const powerEntitlementKey = (flag: string) => `power_${flag}`;

export const OWNER_ENTITLEMENT_KEYS: readonly string[] = [
  ...OWNER_SECTION_KEYS,
  ...MANAGER_POWER_FLAGS.map(powerEntitlementKey),
];

export type OwnerEntitlements = Record<string, boolean>;

// Merge a raw JSONB value over the all-on defaults (absent/non-boolean = ON).
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
