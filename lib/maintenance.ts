// lib/maintenance.ts — WHO MAY TAKE A RESTAURANT'S GUEST MENU DOWN, in one place.
//
// Taking the menu down (settings.service_mode = the "we'll be right back" screen) stops every guest
// ordering, so it is handed over deliberately on the admin's Access & permissions screen → Menu →
// "Put menu on maintenance" (lib/accessTree.ts, id "maintenance"): OFF for every restaurant until it
// is switched on, and then "Who may do it" says `owner` (the default) or `owner_manager`.
//
// TWO DOORS READ THIS, SO THE RULE LIVES HERE (sweep #10 T16 round 2, owner 2026-10-15: "owner should
// get, in the setting thing, the maintenance switch"):
//   · /api/maintenance        — the manager panel's ⚙ drawer (and the admin acting as a manager)
//   · /api/owner/settings     — the owner panel's Settings page
// Before this file the rule was written inline in the first, and the second did not exist — which
// meant that at the DEFAULT ("Owner only") nobody at the restaurant could take the menu down at all:
// the owner was the only person allowed, and no owner screen had the switch.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

export type MaintenanceWho = "owner" | "owner_manager";
export type MaintenanceGrant = { on: boolean; who: MaintenanceWho };

/** Read the grant out of a restaurant's `access_config` (absent / malformed = not handed over). */
export function maintenanceGrant(accessConfig: unknown): MaintenanceGrant {
  const m = accessConfig && typeof accessConfig === "object"
    ? (accessConfig as { maintenance?: { on?: unknown; manager_opts?: { who?: unknown } } }).maintenance
    : undefined;
  return {
    on: m?.on === true,
    who: m?.manager_opts?.who === "owner_manager" ? "owner_manager" : "owner",
  };
}

/** May this person flip the switch? The ADMIN super-user always may (Aevidine reaches every
 *  restaurant); an owner may once it is handed over; a manager only when "Owner and manager". */
export function mayFlipMaintenance(grant: MaintenanceGrant, who: "admin" | "owner" | "manager"): boolean {
  if (who === "admin") return true;
  if (!grant.on) return false;
  return who === "owner" || grant.who === "owner_manager";
}

export type ServiceModeWrite =
  | { ok: true; maintenance: boolean }
  | { ok: false; status: number; error: string };

/** Set (never toggle) one restaurant's service_mode. Setting an explicit value rather than flipping
 *  it is what makes two people pressing at once harmless: both asked for the same end state, so
 *  the second press changes nothing and both screens end up telling the truth. */
export async function setServiceMode(rid: string, on: boolean, where: string): Promise<ServiceModeWrite> {
  const r = await sb.from("settings").update({ service_mode: on }).eq("restaurant_id", rid).select("service_mode");
  if (r.error) {
    console.error(`[${where}] maintenance write failed:`, r.error.message);   // detail our side, not theirs
    return { ok: false, status: 500, error: "Couldn't change the menu's status — please try again." };
  }
  // A WRITE THAT MATCHED NO ROW IS NOT A WRITE (T9 sweep, 2026-08-05) — see /api/maintenance.
  if (!r.data?.length) {
    return { ok: false, status: 409, error: "Couldn't change the menu's status — this restaurant has no settings saved yet. Ask your admin." };
  }
  return { ok: true, maintenance: (r.data[0] || {}).service_mode === true };
}
