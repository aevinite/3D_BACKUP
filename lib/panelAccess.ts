// lib/panelAccess.ts — per-restaurant PANEL entitlements (owner 2026-06-29).
//
// Which operational panels a restaurant has: manager / kitchen / tablet / owner. The
// ADMIN turns these on/off per restaurant (settings.enabled_panels, mig 106). A panel that
// is OFF blocks that role's login and hides it. This is the panel-axis sibling of
// settings.features (guest switches) — stored the same way, scoped by restaurant_id.
//
// SERVER-ONLY: the gate runs server-side (panel-login route + panelGate), so this reads via
// supabaseAdmin and pulls in NO React (unlike lib/features.ts) so route handlers can import
// it. A missing row / missing-or-non-boolean key defaults ON — backward-compatible with any
// restaurant that predates the column (though mig 106 backfills every existing row all-on).
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import type { Role } from "@/lib/userAuth";

export const PANEL_KEYS = ["manager", "kitchen", "tablet", "owner"] as const;
export type PanelKey = (typeof PANEL_KEYS)[number];
const ALL_ON: Record<PanelKey, boolean> = { manager: true, kitchen: true, tablet: true, owner: true };

// The merged enabled-panels map for one restaurant (defaults overlaid with its overrides).
export async function getEnabledPanels(restaurantId: string): Promise<Record<PanelKey, boolean>> {
  const out: Record<PanelKey, boolean> = { ...ALL_ON };
  if (!restaurantId) return out;
  const row = await sb.from("settings").select("enabled_panels").eq("restaurant_id", restaurantId).maybeSingle();
  const stored = row.data?.enabled_panels;
  if (stored && typeof stored === "object") {
    for (const k of PANEL_KEYS) {
      const v = (stored as Record<string, unknown>)[k];
      if (typeof v === "boolean") out[k] = v;
    }
  }
  return out;
}

// Is this role's panel enabled for the restaurant? owner/manager/kitchen/tablet map 1:1 to a
// panel; any other role string is allowed (defensive — never lock someone out on a typo).
export async function isPanelEnabled(role: Role, restaurantId: string): Promise<boolean> {
  if (!(PANEL_KEYS as readonly string[]).includes(role)) return true;
  const p = await getEnabledPanels(restaurantId);
  return p[role as PanelKey] !== false;
}
