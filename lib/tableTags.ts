// lib/tableTags.ts — special table types (VIP / Family / Owner's Guest) + pay-later
// (khata) shared server-side helpers. Design: docs/superpowers/specs/
// 2026-07-22-table-tags-design.md · migration 166.
//
// SERVER-ONLY (imports supabaseAdmin) — panels learn the effective state through
// their API responses; the server routes re-check every write regardless of UI.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { MODULE_DEFS } from "@/lib/accessModel";

export const TABLE_TAGS = ["vip", "family", "guest"] as const;
export type TableTag = (typeof TABLE_TAGS)[number];
export const isTableTag = (v: unknown): v is TableTag =>
  typeof v === "string" && (TABLE_TAGS as readonly string[]).includes(v);

// Tags whose settle screen offers "On the house" (VIP pays normally).
export const COMP_TAGS: readonly TableTag[] = ["family", "guest"];

// The payment_method that marks a no-charge bill — the on-the-house report keys on it.
export const ON_THE_HOUSE_METHOD = "On the house";

// The permission ladder's admin/owner switches (settings columns, mig 166).
export type TableTagsLadder = {
  allowed: boolean;       // admin switch 1 — the feature at all
  ownerControl: boolean;  // admin switch 2 — power transferred to the owner
  enabled: boolean;       // the owner's own toggle (used only while transferred)
  effective: boolean;     // what everything below the owner actually gets
};

// Generic module-ladder read (the mig-166 pattern, generalised for the 2026-07-22
// ladder audit): three settings columns per module — <x>_allowed (admin switch 1),
// <x>_owner_control (admin switch 2, power transfer), <x>_enabled (the owner's own
// toggle, consulted only while transferred). Effective = allowed AND (!control OR enabled).
export async function moduleLadder(
  rid: string,
  cols: { allowed: string; control: string; enabled: string },
): Promise<TableTagsLadder> {
  const s = (await sb
    .from("settings")
    .select(`${cols.allowed}, ${cols.control}, ${cols.enabled}`)
    .eq("restaurant_id", rid)
    .maybeSingle()).data as Record<string, boolean> | null;
  const allowed = s?.[cols.allowed] === true;
  const ownerControl = s?.[cols.control] === true;
  const enabled = s?.[cols.enabled] !== false;
  return { allowed, ownerControl, enabled, effective: allowed && (!ownerControl || enabled) };
}

// EVERY module's ladder in ONE settings select (keyed by module name — "table_tags",
// "banquet", …, from lib/accessModel MODULE_DEFS). Use this on paths that need several
// modules at once (the editor whoami used to fire five separate selects for the same
// row); a new module added to accessModel appears here with no code change.
export async function allModuleLadders(rid: string): Promise<Record<string, TableTagsLadder>> {
  const cols = MODULE_DEFS.flatMap((m) => [m.allowed, m.control, m.enabled]);
  const s = (await sb.from("settings").select(cols.join(", ")).eq("restaurant_id", rid).maybeSingle())
    .data as Record<string, boolean> | null;
  const out: Record<string, TableTagsLadder> = {};
  for (const m of MODULE_DEFS) {
    const allowed = s?.[m.allowed] === true;
    const ownerControl = s?.[m.control] === true;
    const enabled = s?.[m.enabled] !== false;
    out[m.key] = { allowed, ownerControl, enabled, effective: allowed && (!ownerControl || enabled) };
  }
  return out;
}

export const tableTagsLadder = (rid: string) =>
  moduleLadder(rid, { allowed: "table_tags_allowed", control: "table_tags_owner_control", enabled: "table_tags_enabled" });

// Pay later (khata) — its OWN module since the access rebuild (mig 235). It used to share
// table_tags_*, so switching "table types" off silently killed pay-later too; in the new
// model Pay later is a Main feature and marking a table VIP is a per-role permission, so
// they cannot share a column. Every "Pay later (khata) isn't enabled" gate reads THIS.
export const khataLadder = (rid: string) =>
  moduleLadder(rid, { allowed: "khata_allowed", control: "khata_owner_control", enabled: "khata_enabled" });

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ PARCEL and PLATFORMS ARE TWO SEPARATE FEATURES — never merge them again (owner,       ║
// ║ 2026-08-02, mig 259). If you are adding a gate, pick the right one:                   ║
// ║                                                                                       ║
// ║   PARCEL     → parcelLadder()   → settings.parcel_*                                   ║
// ║     A counter order the restaurant's OWN staff punch in: ⚡ QO/P → Parcel on the       ║
// ║     manager floor, ☰ → New parcel on the waiter tablet, the Parcel tiles under the    ║
// ║     live floor, the parcel bill. No table, no outside account, no API key.            ║
// ║     Access → MAIN features, default ON (it replaced a button every floor had).        ║
// ║                                                                                       ║
// ║   PLATFORMS  → platformLadder() → settings.takeaway_*                                 ║
// ║     Orders that ARRIVE from outside: Zomato, Swiggy, the restaurant's own website.    ║
// ║     Each channel is switched on separately (settings.platform_channels) with its own  ║
// ║     API key. Access → EXTRA features, default OFF.                                    ║
// ║                                                                                       ║
// ║ They meet in exactly one place — both kinds of order live in `aggregator_orders` and  ║
// ║ show on the 🛵 board — and that is a storage detail, not a shared switch. mig 235     ║
// ║ briefly aliased both to takeaway_*, which meant a restaurant with no delivery apps    ║
// ║ (Platforms off, correctly) also lost Parcel: the floor still offered it and the       ║
// ║ server refused the finished order at the last tap.                                    ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝

// PLATFORMS — Zomato / Swiggy / the restaurant's own website (mig 209, columns renamed to
// takeaway_* by mig 235). Which channels are live stays a separate per-restaurant config
// (settings.platform_channels), edited under the same Access row.
export const takeawayLadder = (rid: string) =>
  moduleLadder(rid, { allowed: "takeaway_allowed", control: "takeaway_owner_control", enabled: "takeaway_enabled" });

// Banquet's ladder (mig 130 + 167).
export const banquetLadder = (rid: string) =>
  moduleLadder(rid, { allowed: "banquet_allowed", control: "banquet_owner_control", enabled: "banquet_enabled" });

// Table & KOT operations — the KOT ▾ menu (merge tables, move a KOT/dish, split
// bill, reprint; migs 172-177).
export const tableOpsLadder = (rid: string) =>
  moduleLadder(rid, { allowed: "table_ops_allowed", control: "table_ops_owner_control", enabled: "table_ops_enabled" });

// Order-taking — the manager panel's ＋Take order builder + the waiter tablet's order
// button (mig 179). Same canonical module ladder as the others, but its _allowed is
// BACKFILLED true (ordering is the app's core function — a new rung on a pre-existing
// feature defaults to current behaviour, per docs/ACCESS-MODEL.md).
export const takeOrdersLadder = (rid: string) =>
  moduleLadder(rid, { allowed: "take_orders_allowed", control: "take_orders_owner_control", enabled: "take_orders_enabled" });

// PARCEL — the counter takeaway staff punch in themselves (migs 197/198, its own feature
// again since mig 259). Its OWN columns, deliberately: a restaurant that is not on Zomato
// or Swiggy still hands parcels over the counter every day. See the box above before
// pointing this at takeaway_* "because they're both takeaway" — they are not.
export const parcelLadder = (rid: string) =>
  moduleLadder(rid, { allowed: "parcel_allowed", control: "parcel_owner_control", enabled: "parcel_enabled" });

// Staff profiles, salary records & the performance report (mig 220). A brand-new module:
// every rung starts OFF, so no restaurant sees profiles or pay until the admin grants it
// from the restaurant's Main-features section (owner, 2026-07-29: "this is an additional
// feature — if they want it, only then give it to them").
export const payrollLadder = (rid: string) =>
  moduleLadder(rid, { allowed: "payroll_allowed", control: "payroll_owner_control", enabled: "payroll_enabled" });

// Inventory management + the expense book (mig 221). A brand-new module: every rung starts
// OFF, so no restaurant sees stock/expense screens until the admin grants it. One module
// carries the whole area (stock register, purchases, counts, waste, expenses; recipes in
// Stage 2) — the khata/table-types "one module, several capabilities" pattern.
export const inventoryLadder = (rid: string) =>
  moduleLadder(rid, { allowed: "inventory_allowed", control: "inventory_owner_control", enabled: "inventory_enabled" });

// PLATFORMS again, under the name most call sites use. An alias of takeawayLadder (ONE
// feature, two historic names) — NOT of parcelLadder, which is a different feature.
export const platformLadder = takeawayLadder;
