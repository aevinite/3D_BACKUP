// lib/staffCaps.ts — WHICH PERMISSIONS ONE PERSON HAS, and where each one is stored.
//
// ONE list, used by three screens, so they can never offer different powers:
//   • /aevinite → Access & permissions → Per person   (components/admin/AccessPerPerson)
//   • /aevinite → Users / Owners → a person's PROFILE (components/admin/StaffProfile)
//   • the admin write route that saves an override    (app/api/admin/users)
//
// THE RULE (owner, 2026-08-01): a person's permissions are EXACTLY the rows that exist in
// Access & permissions for their role — nothing else. Every row starts at DEFAULT, which
// means "follow the restaurant's setting"; a per-person value only ever exists where
// somebody deliberately set one.
//
// THE BLOCKS EACH ROLE GETS (owner, 2026-08-01 — "only manager will have that"):
//   • manager → TWO blocks: "Permissions" (the menus/tabs they get) and
//     "What a manager may manage" (the money & floor actions).
//   • owner   → ONE block: "Owner's menu" — the pages in their own panel. An owner runs a
//     whole separate panel, so there is no "what they may manage" list for them.
//   • waiter  → ONE block: what they may do on the tablet.
//   • kitchen → nothing: the KDS has no per-person settings.
//
// WHERE AN OVERRIDE IS ENFORCED (role-dependent — writing the wrong key stores a value no
// code reads, which is the bug class the access rebuild exists to kill):
//   • manager → the BARE power flag,   read by managerCan()  (app/api/editor)
//   • waiter  → the tablet_* column,   read by tabletPerm()  (app/api/tablet)
//   • owner   → owner_entitlements is a RESTAURANT setting, not a per-person one, so an
//     owner's rows are shown READ-ONLY (perPerson: false) with a link to the screen that
//     owns them. A dropdown that saved nothing would be exactly the dead switch this
//     model was rebuilt to remove.
import { SECTIONS, nodeValue, type Node, type TreeState } from "@/lib/accessTree";

export type CapValue = "default" | "on" | "pin" | "off";

export type Cap = {
  /** the storage key an override is written under (bare flag, or tablet_* column) */
  key: string;
  /** which block of the profile this row belongs in */
  group: string;
  /** the row itself, straight out of the access tree — name, help text, sub-parts */
  node: Node;
  /** money row: the waiter's third state "On, but ask a manager PIN" */
  pin: boolean;
  /** can ONE person be given a different answer, or is this a restaurant-wide setting? */
  perPerson: boolean;
};

export const GROUP_MENUS = "Permissions";
export const GROUP_MANAGE = "What a manager may manage";
export const GROUP_OWNER = "Owner's menu";
export const GROUP_WAITER = "What a waiter may do";

/** Roles whose rows can be overridden for one person. */
export const ROLES_WITH_OVERRIDES = ["manager", "tablet"] as const;
export const hasOverrides = (role: string) => (ROLES_WITH_OVERRIDES as readonly string[]).includes(role);

const section = (id: string) => SECTIONS.find((s) => s.id === id);

/** The permission rows a person of this role has, in the blocks they belong to. */
export function capsForRole(role: string): Cap[] {
  const out: Cap[] = [];
  const seen = new Set<string>();
  const add = (c: Cap) => { if (!seen.has(c.key)) { seen.add(c.key); out.push(c); } };

  if (role === "manager") {
    // Two folders, two blocks. "Manager menu" holds the tabs; "What a manager may do" holds
    // the actions. Walking the folders (not a hard-coded row list) means a row moved between
    // them on the Access screen moves here too.
    const mgr = section("mgrMenu")?.children ?? [];
    const walk = (nodes: Node[], group: string) => {
      for (const n of nodes) {
        if (n.bind.t === "grant" || n.bind.t === "menu") {
          add({ key: n.bind.t === "grant" ? n.bind.flag : n.bind.grant, group, node: n, pin: false, perPerson: true });
        }
        if (n.children?.length && n.bind.t === "none") walk(n.children, group);
      }
    };
    walk(mgr.find((n) => n.id === "mgr_menu_group")?.children ?? [], GROUP_MENUS);
    walk(mgr.find((n) => n.id === "mgr_may")?.children ?? [], GROUP_MANAGE);
    return out;
  }

  if (role === "tablet") {
    const waiter = section("defaults")?.children.find((c) => c.id === "d_waiter")?.children ?? [];
    for (const n of waiter) {
      if (n.bind.t === "tablet") add({ key: n.bind.key, group: GROUP_WAITER, node: n, pin: !!n.pin, perPerson: true });
    }
    return out;
  }

  if (role === "owner") {
    // The owner's own pages. Restaurant-wide (owner_entitlements), so shown but not editable
    // per person — see the header note.
    for (const n of section("ownMenu")?.children ?? []) {
      if (n.bind.t === "section") add({ key: `section:${n.bind.key}`, group: GROUP_OWNER, node: n, pin: false, perPerson: false });
      else if (n.bind.t === "none") add({ key: `todo:${n.id}`, group: GROUP_OWNER, node: n, pin: false, perPerson: false });
    }
    return out;
  }

  return out; // kitchen — no per-person settings at all
}

/** The blocks, in order, with their rows — what the profile renders. */
export function capGroupsForRole(role: string): { group: string; caps: Cap[] }[] {
  const caps = capsForRole(role);
  const groups: { group: string; caps: Cap[] }[] = [];
  for (const c of caps) {
    const g = groups.find((x) => x.group === c.group);
    if (g) g.caps.push(c); else groups.push({ group: c.group, caps: [c] });
  }
  return groups;
}

/** Every key that may legally be written for this role — the write route's allow-list. */
export const capKeysForRole = (role: string): string[] =>
  capsForRole(role).filter((c) => c.perPerson).map((c) => c.key);

/** The states a row can be set to for one person. */
export const capStates = (pin: boolean): CapValue[] =>
  pin ? ["default", "on", "pin", "off"] : ["default", "on", "off"];
export const isCapValue = (v: unknown, pin: boolean): v is CapValue =>
  typeof v === "string" && (capStates(pin) as string[]).includes(v);

/** What the RESTAURANT gives this role for a row — the "(on)" inside "Default (on)". */
export function roleDefault(cap: Cap, st: TreeState | null): "on" | "off" | "pin" | null {
  if (!st) return null;
  if (cap.key.startsWith("todo:")) return null;      // left-to-build row, nothing stored yet
  const v = nodeValue(cap.node, st);
  if (typeof v === "string") return v === "pin" ? "pin" : v === "on" ? "on" : "off";
  return v ? "on" : "off";
}

/** What this person ACTUALLY has: their own setting if they have one, else the restaurant's. */
export function effectiveCap(
  cap: Cap, st: TreeState | null, permissions: Record<string, string> | null | undefined,
): "on" | "off" | "pin" | null {
  const own = cap.perPerson ? permissions?.[cap.key] : undefined;
  if (own === "on" || own === "off" || own === "pin") return own;
  return roleDefault(cap, st);
}

/** How many rows this person has been given something different from their role's default. */
export const countOverrides = (role: string, permissions: Record<string, string> | null | undefined): number => {
  const keys = new Set(capKeysForRole(role));
  return Object.entries(permissions || {}).filter(([k, v]) => keys.has(k) && (v === "on" || v === "off" || v === "pin")).length;
};
