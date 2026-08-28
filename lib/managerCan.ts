// lib/managerCan.ts — MAY THIS PERSON DO THIS, asked in one place.
//
// Extracted from app/api/editor/[...path]/route.ts on 2026-08-27, unchanged. It moved because a
// SECOND door now asks it: /api/pair, where a print helper is adopted by a signed-in human. A
// permission rule with two copies is the exact bug class the access rebuild exists to remove — one
// copy drifts, and the screen and the server start disagreeing about who may do what.
//
// Read the comments inside before touching anything: three of them record faults that were live in
// production, and each line they defend looks removable until you know why it is there.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { managerGrantValue } from "@/lib/accessTree";
import type { StaffUser } from "@/lib/userAuth";

export // Whether the acting staff may perform an owner-gated MANAGER action. The admin
// super-user (g.user===null) and the OWNER always may; a plain manager only if the
// owner switched that capability flag ON for this restaurant (mig 091 + the owner's
// "Staff & powers" page) AND the admin still entitles that power at all (mig 133 —
// the row's own Feature half). Both columns come back in
// ONE select, so the ladder check adds no extra round trip. Enforces give_discounts /
// void_bills / edit_menu / view_dashboard server-side so hiding a button is never
// the only guard.
async function managerCan(g: { user: StaffUser | null }, rid: string, flag: string): Promise<boolean> {
  const u = g.user;
  if (!u) return true; // admin super-user — X-ray honesty, always passes
  if (u.role === "owner") {
    // The owner passes every power automatically EXCEPT menu editing, which cascades from the
    // ADMIN rung (owner, 2026-07-25): when the admin turns menu editing OFF the owner also drops
    // to a read-only "View menu" — matching the ladder (a rung that's off is refused by the
    // server, not merely hidden).
    //
    // THE CASCADE WAS LOST AND IS BACK (T19 sweep, 2026-08-14). The old reader was
    // `owner_entitlements.power_edit_menu`, a key no screen has been able to write since the old
    // ladder went, so it answered "allowed" for every restaurant, always. Deleting it on
    // 2026-08-06 was right; what went with it was the cascade itself — this branch became a bare
    // `return true`, which returns BEFORE the Feature-half check on the line below. So the panel
    // correctly flipped the owner to "👁 View menu" (menuEditAllowed() in public/panels/editor/
    // app.js reads the same switch through offByAdmin) while this route went on accepting that
    // owner's saves. The panel's own comment there promises the opposite — "the server refuses
    // the writes regardless, so this is the honest matching UI, never the only guard" — and
    // "hiding is never the only guard" is the access model's first rule.
    //
    // The switch is the Feature half of Access → Manager → Edit menu (`access_config.edit_menu.on`),
    // which is exactly what the panel reads, so the two can't disagree again. ONE tiny indexed
    // read, and only when the question is edit_menu — every other power still costs nothing, as
    // the note above has always promised. It fails OPEN on a read error, deliberately and in step
    // with the manager path six lines down: this rung decides whether an owner may edit their own
    // menu, and a database blip must not lock them out of their own restaurant mid-service.
    if (flag !== "edit_menu") return true;
    const cfg = (await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data as
      { access_config?: Record<string, { on?: boolean }> | null } | null;
    return cfg?.access_config?.edit_menu?.on !== false;
  }
  const r = (await sb.from("restaurants").select("manager_permissions, owner_entitlements, access_config").eq("id", rid).maybeSingle()).data as
    { manager_permissions?: Record<string, boolean>; owner_entitlements?: Record<string, boolean>; access_config?: Record<string, { on?: boolean }> } | null;
  // THE FEATURE HALF (owner, 2026-08-01). A row on the Access screen now answers two questions:
  // does this restaurant HAVE the thing, and what does a person of that role start with. This is
  // the first — switched off, nobody has it whatever their own default or override says, which is
  // why it is checked before them. Absent means ON, so nothing changes until it is switched off.
  if (r?.access_config?.[flag]?.on === false) return false;
  // THE OLD LADDER'S ADMIN CAP IS GONE (sweep T6, 2026-08-06). `power_<flag>` was the pre-rebuild
  // "may the admin allow this power at all" rung, and it is now unwritable by ANY code path: the
  // one and only writer of owner_entitlements is the access-tree route, which allow-lists from
  // SECTION_ENTITLEMENTS (owner PAGE keys), and the create form's copy went on 2026-08-06. So the
  // key is permanently absent, this line was permanently true, and it was a second cap on an idea
  // that already has a switch — `access_config[flag].on`, checked immediately above, which IS the
  // Feature half of the row on the Access screen. Two mechanisms for one idea is what this model
  // exists to remove. Verified before deleting: no restaurant on the backup stack has any
  // power_<flag> stored false, so this changes nothing for anyone today, and nothing can write
  // one tomorrow.
  // Per-person override (access panel → Per person, mig 115 staff_users.permissions):
  // an individual's setting WINS over the restaurant-wide owner→manager grant, but never
  // over the admin cap above. 'on'/'pin' = allow this person, 'off' = deny them, absent/
  // 'default' = fall through to the grant. Rides free on u.permissions (no extra query).
  // An ABSENT key used to mean NO here while the Access screen showed the row's default — usually
  // YES. That one line is why a manager was refused things the admin could see switched on, and
  // why every power dropped from the screen was stuck off. managerGrantValue() is the single
  // answer both sides read now (lib/accessTree.ts).
  return managerHasFlag(flag, {
    accessConfig: r?.access_config as Record<string, { on?: boolean }> | null | undefined,
    managerPermissions: r?.manager_permissions as Record<string, unknown> | null | undefined,
    ownOverride: u.permissions?.[flag],
  });
}

/**
 * THE SAME THREE RUNGS, WITHOUT A QUERY — for a caller that has already read the rows.
 *
 * managerCan() above is for "may the person making THIS request do it". This is for "which of these
 * fifty people may", which is a different shape: a per-person loop that called managerCan() would
 * re-read `restaurants` once per person.
 *
 * WHY IT EXISTS AT ALL (owner's review, 2026-08-28): the Printing board's people picker resolved
 * "may be the printer" from the restaurant-wide grant ALONE. So a manager switched off individually
 * was still offered — pick them, the board says their screen is the printer, and their screen is
 * refused, so the kitchen never gets the paper and nothing says why. It failed the other way too: a
 * manager allowed individually could not be picked while the restaurant default was off. The picker
 * and the gate were two copies of one rule, and they disagreed. There is one copy now, and both
 * call it.
 *
 * The order is the order, and it matters: the Feature half is a CAP (off = nobody, whatever anyone's
 * own setting says), then the person's own override, then the restaurant-wide default.
 */
export function managerHasFlag(flag: string, from: {
  accessConfig?: Record<string, { on?: boolean }> | null;
  managerPermissions?: Record<string, unknown> | null;
  ownOverride?: string | null;
}): boolean {
  if (from.accessConfig?.[flag]?.on === false) return false;
  const ov = from.ownOverride;
  if (ov === "on" || ov === "pin") return true;
  if (ov === "off") return false;
  return managerGrantValue(flag, (from.managerPermissions || {})[flag]);
}
