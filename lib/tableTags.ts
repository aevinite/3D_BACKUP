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

export async function tableTagsLadder(rid: string): Promise<TableTagsLadder> {
  const s = (await sb
    .from("settings")
    .select("table_tags_allowed, table_tags_owner_control, table_tags_enabled")
    .eq("restaurant_id", rid)
    .maybeSingle()).data as Record<string, boolean> | null;
  const allowed = s?.table_tags_allowed === true;
  const ownerControl = s?.table_tags_owner_control === true;
  const enabled = s?.table_tags_enabled !== false;
  return { allowed, ownerControl, enabled, effective: allowed && (!ownerControl || enabled) };
}
