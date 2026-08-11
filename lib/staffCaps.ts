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

// THE GROUP NAMES ARE THE ACCESS SCREEN'S OWN (owner, 2026-08-02: "in the permission, also,
// there will be same thing — manager menu, permission for manager and manager setting, all
// that same structure"). A person's permission list reads exactly like the Manager section,
// so nobody has to translate between two vocabularies for one idea.
export const GROUP_MENUS = "Manager's menu";
export const GROUP_MANAGE = "Permission for manager";
export const GROUP_MGRSET = "Manager settings (what manager can do)";
export const GROUP_OWNER = "Owner's menu";
// The waiter's two folders, named exactly as Access → Waiter names them (owner, 2026-08-04).
export const GROUP_WAITER_MONEY = "Permission for waiter";
export const GROUP_WAITER_FLOOR = "What a waiter can do on the floor";

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
    // Three folders, three blocks — the SAME structure as Access → Manager (owner, 2026-08-02:
    // "if we add any feature in the manager section, it should be added in the user also").
    // Walking the folders (not a hard-coded row list) is what makes that automatic.
    const mgr = section("mgrMenu")?.children ?? [];
    const walk = (nodes: Node[], group: string) => {
      for (const n of nodes) {
        if (n.bind.t === "grant") {
          add({ key: n.bind.flag, group, node: n, pin: false, perPerson: true });
        }
        if (n.children?.length && n.bind.t === "none") walk(n.children, group);
      }
    };
    walk(mgr.find((n) => n.id === "mgr_menu_group")?.children ?? [], GROUP_MENUS);
    walk(mgr.find((n) => n.id === "mgr_may")?.children ?? [], GROUP_MANAGE);
    // Manager settings — the panel's Settings SECTIONS. Restaurant-wide (access_config.menus
    // .mgrset, no per-person path), so shown READ-ONLY like the owner's pages: the structure
    // matches the Access screen without minting a dropdown that would save a key nothing reads.
    for (const n of section("mgrMenu")?.children.find((x) => x.id === "mgr_manage")?.children ?? []) {
      if (n.bind.t === "tab") add({ key: `mgrset:${n.bind.key}`, group: GROUP_MGRSET, node: n, pin: false, perPerson: false });
    }
    return out;
  }

  if (role === "tablet") {
    // The Waiter section grew two FOLDERS on 2026-08-04 (money · floor), the same shape as
    // Manager, so this walks them by name exactly as the manager branch above does. Both waiter
    // bind shapes are collected:
    //   · `tablet`    → settings.tablet_<x>, the tri-state tabletPerm() reads
    //   · `capTablet` → access_config[id].tablet, for an action with no column of its own
    // The second was MISSING here until 2026-08-04, which is why the waiter walk-out row had a
    // restaurant-wide switch on the Access screen and no per-person row anywhere: the doc's rule
    // is "a person's rows are exactly the rows Access has for their role", and it wasn't true.
    const waiter = section("waiter")?.children ?? [];
    const walkWaiter = (nodes: Node[], group: string) => {
      for (const n of nodes) {
        if (n.bind.t === "tablet") add({ key: n.bind.key, group, node: n, pin: !!n.pin, perPerson: true });
        else if (n.bind.t === "capTablet") add({ key: `cap:${n.bind.id}`, group, node: n, pin: !!n.pin, perPerson: true });
        if (n.children?.length && n.bind.t === "none") walkWaiter(n.children, group);
      }
    };
    walkWaiter(waiter.find((n) => n.id === "wtr_money")?.children ?? [], GROUP_WAITER_MONEY);
    walkWaiter(waiter.find((n) => n.id === "wtr_floor")?.children ?? [], GROUP_WAITER_FLOOR);
    // A row added to the Waiter section OUTSIDE those two folders would otherwise be silently
    // missing from every person's screen, so sweep up anything left over rather than lose it.
    walkWaiter(waiter.filter((n) => n.id !== "wtr_money" && n.id !== "wtr_floor"), GROUP_WAITER_MONEY);
    return out;
  }

  if (role === "owner") {
    // The owner's own pages. Restaurant-wide (owner_entitlements), so shown but not editable
    // per person — see the header note.
    //
    // RECURSIVE, deliberately (fixed 2026-08-04). The Owner section was flattened into a single
    // `own_menu_group` folder, and this loop only looked one level down — so it stopped finding
    // the four pages and added ONE row keyed `todo:own_menu_group`, i.e. every owner's profile
    // showed a lone "Owner's menu · left to build" placeholder instead of their actual pages.
    // A folder is not a permission; walk through it.
    const walkOwner = (nodes: Node[]) => {
      for (const n of nodes) {
        if (n.bind.t === "section") add({ key: `section:${n.bind.key}`, group: GROUP_OWNER, node: n, pin: false, perPerson: false });
        // THE TWO VIEW ROWS INSIDE "Audit & logs" (fixed by sweep T6, 2026-08-10). They are `opt`
        // binds — access_config.view_logs.owner_opts.{removals,activity} — not section keys, so
        // this walked straight past them while the comment right here claimed the opposite. The
        // owner's profile listed 12 rows and Access → Owner showed 14, against this file's own
        // stated rule ("a person's rows are EXACTLY the rows Access has for their role"). Nothing
        // was ever mis-granted, because an owner's rows are read-only either way; the profile
        // simply told a smaller truth than the screen it is supposed to mirror.
        else if (n.bind.t === "opt") add({ key: `opt:${n.bind.id}.${n.bind.side}.${n.bind.key}`, group: GROUP_OWNER, node: n, pin: false, perPerson: false });
        else if (n.bind.t === "none" && !n.children?.length) add({ key: `todo:${n.id}`, group: GROUP_OWNER, node: n, pin: false, perPerson: false });
        // Walk INTO everything, folder or page: the sub-views inside "Audit & logs" are pages the
        // owner does or doesn't get, so they belong on their profile too (read-only, like the rest).
        if (n.children?.length) walkOwner(n.children);
      }
    };
    walkOwner(section("ownMenu")?.children ?? []);
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

/** Is this row even OFFERABLE for one person at this restaurant?
 *
 *  THE OWNER'S RULE (2026-08-02): "if I off the FEATURE delete bill, it will not even show in
 *  the user that delete bill can be on and off… if the feature is closed, it should not even
 *  be seen there." The FEATURE half of a row says whether the restaurant HAS the thing at all;
 *  a per-person dropdown for a thing the restaurant doesn't have is a dead switch wearing a
 *  person's name — managerCan() would refuse it whatever the dropdown said. So both per-person
 *  screens (the profile's Permissions block and Access → Per person) hide the row entirely
 *  while its feature is off, and it reappears the moment the feature comes back on.
 *  No feature half (Dashboard, the mgrset sections) or no loaded state yet → visible. */
export function capVisible(cap: Cap, st: TreeState | null): boolean {
  const fb = cap.node.featureBind;
  if (!fb || !st) return true;
  return nodeValue({ ...cap.node, bind: fb }, st) === true;
}

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
