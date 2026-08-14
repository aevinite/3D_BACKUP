// lib/tableTags.ts — special table types (VIP / Family / Owner's Guest) + pay-later
// (khata) shared server-side helpers. Design: docs/superpowers/specs/
// 2026-07-22-table-tags-design.md · migration 166.
//
// SERVER-ONLY (imports supabaseAdmin) — panels learn the effective state through
// their API responses; the server routes re-check every write regardless of UI.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { MODULE_DEFS } from "@/lib/accessModel";

/** One module's ladder as it is stored in settings.modules (mig 320) — the JSONB alternative to the
 *  four columns a module used to need. Absent keys read as false/false/true (new modules start OFF). */
export type ModuleBagEntry = { allowed?: boolean; owner_control?: boolean; enabled?: boolean; tablet?: string };

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
  // COLUMNS for the eleven modules that predate the bag, and settings.modules for any module that
  // declares itself bag-backed (mig 320: a new module needs no new column). Both are read in the
  // SAME single select, so this stays one round-trip however many modules exist. No module declares
  // the bag today, which is why this cannot change a single answer yet — it is the road, not a turn.
  const cols = MODULE_DEFS.filter((m) => !m.bag).flatMap((m) => [m.allowed, m.control, m.enabled]);
  const s = (await sb.from("settings").select([...cols, "modules"].join(", ")).eq("restaurant_id", rid).maybeSingle())
    .data as (Record<string, boolean> & { modules?: Record<string, ModuleBagEntry> }) | null;
  const bag = (s?.modules && typeof s.modules === "object" ? s.modules : {}) as Record<string, ModuleBagEntry>;
  const out: Record<string, TableTagsLadder> = {};
  for (const m of MODULE_DEFS) {
    // An ABSENT bag entry reads exactly like absent columns would: not allowed, not transferred,
    // enabled — i.e. a new module is OFF until the admin grants it (the house rule since mig 107).
    const src = m.bag ? bag[m.key] : undefined;
    const allowed      = m.bag ? src?.allowed === true       : s?.[m.allowed] === true;
    const ownerControl = m.bag ? src?.owner_control === true  : s?.[m.control] === true;
    const enabled      = m.bag ? src?.enabled !== false       : s?.[m.enabled] !== false;
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
// ║     Access → MAIN features. PERMANENT since 2026-08-03 — no switch (see below).       ║
// ║                                                                                       ║
// ║   PLATFORMS  → platformLadder() → settings.takeaway_*                                 ║
// ║     Orders that ARRIVE from outside: Zomato, Swiggy, the restaurant's own website.    ║
// ║     Each channel is switched on separately (settings.platform_channels) with its own  ║
// ║     API key — and those channel switches are now the ONLY switches here. The feature  ║
// ║     itself is PERMANENT since 2026-08-03, merged with Parcel into one board.          ║
// ║                                                                                       ║
// ║ They meet in exactly one place — both kinds of order live in `aggregator_orders` and  ║
// ║ show on the 🛵 board — and that is a storage detail, not a shared switch. mig 235     ║
// ║ briefly aliased both to takeaway_*, which meant a restaurant with no delivery apps    ║
// ║ (Platforms off, correctly) also lost Parcel: the floor still offered it and the       ║
// ║ server refused the finished order at the last tap.                                    ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ ONE PERMANENT FEATURE, NO MASTER SWITCH (owner, 2026-08-03)                           ║
// ║ "The parcel counter should not have a toggle option. The parcel counter where the     ║
// ║  parcels are shown and where the Zomato and all that stuff will be shown will be      ║
// ║  permanently there. Permanently." — asked which way, he chose "merge them into one    ║
// ║  permanent thing".                                                                    ║
// ║                                                                                       ║
// ║ So the 🛵 board and the counter parcel are no longer two features with two switches:  ║
// ║ they are ONE thing every restaurant always has. What stays switchable is what is      ║
// ║ actually optional — the individual delivery CHANNELS (Zomato, Swiggy, own website),   ║
// ║ each needing that company's account and key. Nothing else changes: both ladders keep  ║
// ║ their shape and every call site keeps reading `.effective`.                           ║
// ║                                                                                       ║
// ║ WHY THIS IS SAFE, and why it is not a repeat of the bug mig 259 fixed: that bug was   ║
// ║ "Platforms off silently killed the counter parcel — the floor offered it and the      ║
// ║ server refused the finished order at the last tap". The cause was a master switch     ║
// ║ that could turn parcel off. There is now no such switch to turn off, on either half.  ║
// ║ Merging them BEHIND a switch would bring the bug back; merging them into something    ║
// ║ permanent is what removes it for good.                                                ║
// ║                                                                                       ║
// ║ The settings columns (takeaway_*, parcel_*) are left in the table on purpose — an     ║
// ║ old row saying `false` must NOT be able to take the feature away, so nothing reads    ║
// ║ them any more. Do not "restore" a read here without a switch on the Access screen to  ║
// ║ go with it; a gate no admin can see is the dead switch the access rebuild deleted.    ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
const ALWAYS_ON: TableTagsLadder = { allowed: true, ownerControl: false, enabled: true, effective: true };

// PLATFORMS — Zomato / Swiggy / the restaurant's own website (mig 209, columns renamed to
// takeaway_* by mig 235). Permanent since 2026-08-03 (see the box above). Which channels are
// live is still a real per-restaurant config (settings.platform_channels), edited under the
// same Access row — that is where "we're not on Swiggy" is expressed now.
export const takeawayLadder = async (_rid: string): Promise<TableTagsLadder> => ALWAYS_ON;

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
export const parcelLadder = async (_rid: string): Promise<TableTagsLadder> => ALWAYS_ON;

// Staff profiles, salary records & the performance report (mig 220). A brand-new module:
// every rung starts OFF, so no restaurant sees profiles or pay until the admin grants it
// from the restaurant's Main-features section (owner, 2026-07-29: "this is an additional
// feature — if they want it, only then give it to them").
export const payrollLadder = (rid: string) =>
  moduleLadder(rid, { allowed: "payroll_allowed", control: "payroll_owner_control", enabled: "payroll_enabled" });

// The SAME payroll rung for MANY restaurants in ONE settings read (T9 sweep, 2026-08-05).
// `payrollLadder` is per-restaurant, so asking it in a loop costs one round-trip each — fine for a
// single restaurant, wrong for the admin's whole-platform view. Callers that need a set (the owner
// dashboard's staff-pay tile, the staff roster) use this instead. Same rule as moduleLadder:
// allowed must be on, and a transferred switch must not be explicitly off.
export async function payrollEffectiveByRid(ids: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  if (!ids.length) return out;
  const { data } = await sb.from("settings")
    .select("restaurant_id, payroll_allowed, payroll_owner_control, payroll_enabled")
    .in("restaurant_id", ids);
  for (const r of (data || []) as Record<string, unknown>[]) {
    out[String(r.restaurant_id)] =
      r.payroll_allowed === true && (r.payroll_owner_control !== true || r.payroll_enabled !== false);
  }
  return out;
}

// Inventory management + the expense book (mig 221). A brand-new module: every rung starts
// OFF, so no restaurant sees stock/expense screens until the admin grants it. One module
// carries the whole area (stock register, purchases, counts, waste, expenses; recipes in
// Stage 2) — the khata/table-types "one module, several capabilities" pattern.
export const inventoryLadder = (rid: string) =>
  moduleLadder(rid, { allowed: "inventory_allowed", control: "inventory_owner_control", enabled: "inventory_enabled" });

/** The inventory rung for MANY restaurants in ONE settings read — see payrollEffectiveByRid. */
export async function inventoryEffectiveByRid(ids: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  if (!ids.length) return out;
  const { data } = await sb.from("settings")
    .select("restaurant_id, inventory_allowed, inventory_owner_control, inventory_enabled")
    .in("restaurant_id", ids);
  for (const r of (data || []) as Record<string, unknown>[]) {
    out[String(r.restaurant_id)] =
      r.inventory_allowed === true && (r.inventory_owner_control !== true || r.inventory_enabled !== false);
  }
  return out;
}

// PLATFORMS again, under the name most call sites use. An alias of takeawayLadder (ONE
// feature, two historic names) — NOT of parcelLadder, which is a different feature.
export const platformLadder = takeawayLadder;
