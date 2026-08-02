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
import { MANAGER_POWER_FLAGS } from "@/lib/accessModel";

// Owner-panel SECTIONS the admin can switch off (nav + API both honour these).
// "ratings" (mig 138) gates the guest star-ratings view/management the owner + manager
// get on the Feedback & issues page.
// "customers" (guest list from the customers table) + "settings" (owner appearance /
// password / what's-enabled) added 2026-07-07; absent = ON, so every restaurant gets them.
// "menu" (2026-07-25) gates the owner-panel Menu editor page (the real dishes/categories/
// tags editor embedded from the manager panel). Absent = ON, so every restaurant gets it;
// the admin can switch it off to remove the section for a restaurant. Note this is the
// SECTION-visibility rung — whether the owner can EDIT vs only VIEW the menu is the separate
// power_edit_menu rung (see MANAGER_POWER_FLAGS below).
// "logs" (2026-07-31, access rebuild) gates the owner panel's activity-log page — the
// owner's equivalent of the manager's Log tab, which was the one panel tab never wired.
// "expenses" (2026-08) gates the owner panel's own Expenses page — the expense book that
// until now only existed inside the manager's Inventory tab. It is deliberately NOT tied to
// the inventory module: money leaving the business is something every owner should be able
// to see, so absent = ON here means every restaurant gets the page unless an admin says no.
export const OWNER_SECTION_KEYS = ["reports", "staff", "issues", "ratings", "customers", "settings", "menu", "logs", "expenses"] as const;
export type OwnerSectionKey = (typeof OWNER_SECTION_KEYS)[number];

// The manager powers (mig 091). The admin's availability switch for each lives under
// "power_<flag>" — OFF means the toggle disappears from the owner's panel and the
// manager's effective power is off no matter what the owner granted before.
//  · edit_settings  — enforced in the editor (mig, route:1203) but had no owner toggle.
//  · view_ratings   — see + handle guest ratings in the manager panel (mig 138).
//  · table_tags      — mark tables VIP/Family/Owner's-Guest + settle "on the house" (mig 166).
//  · khata           — park a bill on a person to collect later + manage the khata book (mig 166).
//  · banquet         — the Banquet tab / banquet billing (mig 130; rung added mig 167,
//                      BACKFILLED true so pre-existing behaviour is unchanged).
//  · table_ops      — the KOT ▾ menu (merge tables, move a KOT/dish, split bill,
//                     reprint; migs 172-177). CANONICAL module ladder (docs/
//                     ACCESS-MODEL.md): the module rung lives on settings
//                     (table_ops_allowed / _owner_control / _enabled →
//                     tableOpsLadder() in lib/tableTags.ts); this power is the
//                     plain manager rung on top of it.
//  · take_orders    — take a brand-new dine-in order from the manager panel, like the
//                     waiter tablet (2026-07-22). A plain manager POWER (admin exists +
//                     owner grant) PLUS a tablet CAP (settings.tablet_take_orders
//                     tri-state) — the same two-rail shape as discount/mark_paid, NOT a
//                     module. The tablet cap defaults 'on' (mig 178) because taking
//                     orders is the tablet's existing core function.
//
// DERIVED since 2026-07-26: the list now comes from lib/accessModel.ts (the access
// panel's single source of truth), so a power added there wires itself here — the old
// hand-typed copy had drifted (view_logs existed in the panel + enforcement but not
// here, so the owner could never grant/revoke it). Re-exported for existing importers.
export { MANAGER_POWER_FLAGS };
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
