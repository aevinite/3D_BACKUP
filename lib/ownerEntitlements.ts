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
// "manager_mode" (2026-08-02) gates the owner panel's Manager mode page — the full live
// manager panel (floor/bills/platform/…) embedded in the owner cockpit. Absent = ON.
// "logs_signins" / "logs_service" / "logs_staff_changes" (2026-08-02) are VISIBILITY
// switches for the owner's Activity page — which KINDS of rows it shows (read by
// /api/owner/oplog). They never stop anything being RECORDED: the money/bill audit
// trail is not switchable (docs/COMPLIANCE-GUARDRAILS.md). Absent = ON.
export const OWNER_SECTION_KEYS = ["reports", "staff", "issues", "ratings", "customers", "settings", "menu", "logs", "manager_mode", "logs_signins", "logs_service", "logs_staff_changes"] as const;
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

// ⚠️ RETIRED 2026-08-06 — KEPT ONLY SO THE KEY SHAPE IS STILL DOCUMENTED. NOTHING READS THESE.
//
// `power_<flag>` was the OLD ladder's "may the admin allow this power at all" rung. It is now
// unwritable by any code path in the product: the one and only writer of owner_entitlements is
// app/api/admin/restaurants/access-tree/route.ts, which allow-lists from SECTION_ENTITLEMENTS —
// owner PAGE keys — and the New-restaurant form's copy of the old ladder went on 2026-08-06.
// So every power_<flag> is permanently absent, every read of it was permanently "allowed", and
// it was a SECOND cap on an idea that already has a switch: access_config[flag].on, the Feature
// half of that row on the Access screen. Two mechanisms for one idea is what the access model
// exists to remove, so the five readers (editor ×3, inventory, staffProfile, owner/staff) were
// deleted and each says where the live cap lives instead.
//
// Do not wire this back up. If a power needs an admin-level "does this restaurant have it",
// that is a `has` row in lib/accessTree.ts — which is switchable, visible and audited.
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

// Which of these restaurants still show a given VIEW of the owner's Audit & logs page
// (owner, 2026-08-02 — the Access screen's "Audit & logs" sub-options, stored at
// access_config.view_logs.owner_opts.removals / .activity). ABSENT MEANS ON, matching the
// model's def:true, so nothing changes until an admin switches a view off. The caller has
// already narrowed to the "logs" section via entitledSubset — this is the finer cut.
export async function logViewSubset(restaurantIds: string[], part: "removals" | "activity"): Promise<string[]> {
  if (!restaurantIds.length) return [];
  const rows = (await sb.from("restaurants").select("id, access_config").in("id", restaurantIds)).data || [];
  return rows
    .filter((r) => {
      const opts = (r.access_config as { view_logs?: { owner_opts?: Record<string, boolean> } } | null)?.view_logs?.owner_opts;
      return !opts || typeof opts !== "object" || opts[part] !== false;
    })
    .map((r) => r.id as string);
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
