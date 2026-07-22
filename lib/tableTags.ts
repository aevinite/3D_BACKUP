// lib/tableTags.ts — special table types (VIP / Family / Owner's Guest) + pay-later
// (khata) shared server-side helpers. Design: docs/superpowers/specs/
// 2026-07-22-table-tags-design.md · migration 166.
//
// SERVER-ONLY (imports supabaseAdmin) — panels learn the effective state through
// their API responses; the server routes re-check every write regardless of UI.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

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

export const tableTagsLadder = (rid: string) =>
  moduleLadder(rid, { allowed: "table_tags_allowed", control: "table_tags_owner_control", enabled: "table_tags_enabled" });

// Banquet's ladder (mig 130 + 167).
export const banquetLadder = (rid: string) =>
  moduleLadder(rid, { allowed: "banquet_allowed", control: "banquet_owner_control", enabled: "banquet_enabled" });
