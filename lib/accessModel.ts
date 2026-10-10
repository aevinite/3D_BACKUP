// lib/accessModel.ts — ENFORCEMENT WIRING ONLY: the manager-power flags, the waiter columns and the
// module ladders the routes enforce. Nothing here is drawn on a screen.
//
// It began (2026-07-23) as the data behind the 4-rung access PANEL — guest switches, staff apps,
// descriptions, sub-options, group cards. That panel was retired on 2026-07-31; the Access screen is
// lib/accessTree.ts now and owns every row, every name and every default. What is left is read by six
// files for exactly these questions:
//   · MANAGER_POWER_FLAGS — every manager power a route checks (managerCan, the owner grant lists)
//   · ABSENT_ON_POWERS    — the powers whose grant reads an absent key as ON
//   · TABLET_PERM_KEYS    — the waiter tri-state columns (settings.tablet_*) the tablet route resolves
//   · MODULE_DEFS         — one entry per module ladder (settings.<x>_allowed / _enabled, or the bag)
//   · PERMISSIONS + moduleKey — the editor's whoami, which turns a power off when its module is off
//
// TRIMMED TO THAT on 2026-10-10 (sweep #10 T18, item 25). Each entry used to carry ~16 more fields
// (`what`, `sub`, `group`, `waiter`, `fixedTop`, `ownerUse`, `limit`…) and the list held 17 more
// entries (the guest switches, the four staff apps, auto-print, QO/P, issues, customers) — display data
// for the retired panel that no code read. Mutation testing showed it plainly: flip any of it and
// nothing anywhere changes. Kept: id · name · power · tablet · tabletNew · isNew · absentOn · module ·
// moduleBag · moduleLabel. Do not add display data back: a row's words belong in lib/accessTree.ts.

type Perm = {
  id: string;
  /** a plain label; MODULE_DEFS falls back to it when no moduleLabel is given */
  name: string;
  /** manager power flag → manager_permissions[<flag>], read by managerCan() */
  power?: string;
  /** settings.tablet_<x> tri-state — the waiter rung */
  tablet?: string;
  /** the waiter rung has no settings column (it lives in access_config) — kept out of TABLET_PERM_KEYS */
  tabletNew?: boolean;
  /** a power with no legacy enforcement yet — kept out of MANAGER_POWER_FLAGS (none today) */
  isNew?: boolean;
  /** this power's manager grant reads an ABSENT key as ON (view_logs and the two low-risk pay powers) */
  absentOn?: boolean;
  /** the module ladder this capability belongs to: settings.<x>_allowed / _owner_control / _enabled */
  module?: { allowed: string; control: string; enabled: string };
  /** a NEW module keeps its ladder in settings.modules[<key>] (jsonb, mig 320/326) instead of three
   *  columns. Give `module` the module key in all three slots; lib/tableTags.ts reads the bag for it. */
  moduleBag?: boolean;
  /** the MODULE's name where it is logged and listed — the SAME words the Access screen's module row
   *  uses (lib/accessTree.ts), so one switch has one name everywhere (`verify:access` check 71). */
  moduleLabel?: string;
};

// ── GROUPS · PERM_BY_ID · …  LEFT on 2026-10-10 (item 7); the display fields and entries above LEFT the
// same day (item 25). `const ON = true` — a constant nothing used — went with them.

export const PERMISSIONS: Perm[] = [
  { id: "edit_menu", name: "Edit the menu", power: "edit_menu" },
  { id: "give_discounts", name: "Give a discount", power: "give_discounts", tablet: "tablet_discount" },
  // "Delete a bill" is not a permission and never will be (owner, 2026-08-16 — docs/REJECTED-IDEAS.md
  // R27): cancel is the only way out of a bill. This power is REOPENING a bill; its waiter rung (a
  // walk-out) lives in access_config, hence tabletNew.
  { id: "void_bills", name: "Reopen a bill", power: "void_bills", tabletNew: true },
  // Owner & manager always mark paid / issue the invoice; only the WAITER rung is a column.
  { id: "mark_paid", name: "Mark a bill paid (& undo)", tablet: "tablet_mark_paid" },
  { id: "print_invoice", name: "Generate & print the invoice", tablet: "tablet_invoice" },
  // Pay later got its OWN module columns in the access rebuild (mig 235) — it used to share
  // table_tags_*, so switching table types off silently killed pay-later. Keep these in step with
  // khataLadder() in lib/tableTags.ts.
  { id: "khata", name: "Khata — put it on their tab", power: "khata", tablet: "tablet_khata",
    module: { allowed: "khata_allowed", control: "khata_owner_control", enabled: "khata_enabled" }, moduleLabel: "Pay later (khata)" },
  // LOYALTY POINTS (2026-09-19) — the first module in the shared settings.modules bag (mig 326). It is
  // here, not only in lib/accessTree.ts, because MODULE_DEFS is built from THIS list and both
  // allModuleLadders() and the editor whoami iterate it: a module missing here would save its switch on
  // the Access screen and reach no gate.
  { id: "loyalty", name: "Loyalty points", power: "loyalty",
    module: { allowed: "loyalty", control: "loyalty", enabled: "loyalty" }, moduleBag: true, moduleLabel: "Loyalty points" },
  { id: "take_orders", name: "Take a new order", power: "take_orders", tablet: "tablet_take_orders",
    module: { allowed: "take_orders_allowed", control: "take_orders_owner_control", enabled: "take_orders_enabled" }, moduleLabel: "Take a new order" },
  // PARCEL AND PLATFORMS ARE PERMANENT (owner, 2026-08-03): each keeps its POWER (may THIS person punch
  // one in / work the board) and has NO module binding, so the whoami loop that turns a power off with
  // its module simply skips them. Do not re-add a module binding without a switch on the Access screen.
  { id: "parcel", name: "Parcel orders", power: "parcel", tablet: "tablet_parcel" },
  { id: "platform", name: "Platform board (Zomato / Swiggy)", power: "platform" },
  { id: "table_ops", name: "Table & ticket operations", power: "table_ops", tablet: "tablet_table_ops",
    module: { allowed: "table_ops_allowed", control: "table_ops_owner_control", enabled: "table_ops_enabled" }, moduleLabel: "Move, merge & split tables" },
  { id: "table_tags", name: "Table types (VIP / Family / Guest)", power: "table_tags", tablet: "tablet_table_tags",
    module: { allowed: "table_tags_allowed", control: "table_tags_owner_control", enabled: "table_tags_enabled" }, moduleLabel: "Table types (VIP / Family / Guest)" },
  // Waiter sections (mig 222): only WHO MAY EDIT the sections; deliberately no tablet rung, not a module
  // ("it's not a feature, it should always be on" — owner, 2026-07-30).
  { id: "table_assign", name: "Give waiters their own tables", power: "table_assign" },
  { id: "banquet", name: "Banquet & events", power: "banquet", tablet: "tablet_banquet",
    module: { allowed: "banquet_allowed", control: "banquet_owner_control", enabled: "banquet_enabled" }, moduleLabel: "Banquet billing" },
  { id: "view_dashboard", name: "Dashboard & reports", power: "view_dashboard" },
  { id: "view_ratings", name: "Guest ratings & feedback", power: "view_ratings" },
  // view_logs is the one ABSENT-ON floor power: canViewLogs (editor API) keeps the log for a manager
  // unless it was EXPLICITLY switched off (non-breaking rollout, 2026-07-24).
  { id: "view_logs", name: "Activity log", power: "view_logs", absentOn: true },
  { id: "manage_staff", name: "Manage staff", power: "manage_staff" },
  { id: "edit_settings", name: "Restaurant settings", power: "edit_settings" },
  // STAFF PROFILES & PAY (mig 220) — ONE module (payroll_*) with three manager reaches under it. Absent
  // grant: OFF for seeing pay, ON for the two low-risk powers (lib/staffProfileShared.ts
  // ABSENT_ON_PAY_POWERS is the enforcement side of the same rule).
  { id: "staff_profiles", name: "Edit staff profiles", power: "edit_staff_profiles", absentOn: true,
    module: { allowed: "payroll_allowed", control: "payroll_owner_control", enabled: "payroll_enabled" }, moduleLabel: "Staff profiles & pay" },
  { id: "staff_pay_view", name: "See staff pay", power: "see_staff_pay",
    module: { allowed: "payroll_allowed", control: "payroll_owner_control", enabled: "payroll_enabled" }, moduleLabel: "Staff profiles & pay" },
  { id: "staff_pay_record", name: "Record a staff payment", power: "record_staff_payment", absentOn: true,
    module: { allowed: "payroll_allowed", control: "payroll_owner_control", enabled: "payroll_enabled" }, moduleLabel: "Staff profiles & pay" },
  // INVENTORY (mig 221) — ONE module (inventory_*) with two manager reaches, both absent = OFF.
  // ONE NAME (owner, 2026-09-23: "inventory management, call it inventory management only").
  { id: "inv_stock", name: "Run the stock register", power: "inv_stock",
    module: { allowed: "inventory_allowed", control: "inventory_owner_control", enabled: "inventory_enabled" }, moduleLabel: "Inventory management" },
  { id: "inv_expenses", name: "Record an expense", power: "inv_expenses",
    module: { allowed: "inventory_allowed", control: "inventory_owner_control", enabled: "inventory_enabled" }, moduleLabel: "Inventory management" },
];

// WHO MAY BE THE PRINTER, and WHO MAY CLEAR A QUEUE, are deliberately NOT entries here: they are
// manager grants on the Access screen (lib/accessTree.ts ACTIONS: print_here, print_clear), enforced
// the way those are enforced. A second entry here would be a second switch for one question. Who may
// SET THE PRINTERS UP is admin-only, always (owner, 2026-09-14) — there is no switch for it anywhere.

// ── WHAT LEFT THIS FILE ON 2026-10-10 (sweep #10 T18, item 7) ───────────────────────────────────
// PERM_BY_ID · PERM_BY_POWER · GROUP_BY_ID · permsOf · maxReach · NEW_POWER_FLAGS — and, further down,
// the AccessState type with allowed() · tabletValue() · reachLevel() · subState(). They were the 4-rung
// ladder panel's DISPLAY helpers. That panel was retired on 2026-07-31; sweep #9 (P105050) measured that
// no file imported any of them, and they still answered questions about a `power_<flag>` rung nothing can
// write any more. A helper that answers a retired question is a trap for the next reader, so they are
// gone rather than kept "just in case". What survives is the enforcement wiring below, which six files
// import. The 4-rung ladder itself is history: docs/ACCESS-LADDER.md.

// ── DERIVED WIRING LISTS (2026-07-26) — the routes import THESE instead of keeping
// hand-typed copies, so adding a feature above wires the whole ladder in one place.
// (Before this, four separate files each carried their own list and drifted: the owner
// settings route was missing parcel, the grant routes were missing view_logs.)
// Every manager-power flag — the owner→manager rung the owner may grant/revoke.
export const MANAGER_POWER_FLAGS: readonly string[] = PERMISSIONS.filter((p) => p.power && !p.isNew).map((p) => p.power!);
// Powers whose grant reads an ABSENT manager_permissions key as ON (see `absentOn`).
export const ABSENT_ON_POWERS: ReadonlySet<string> = new Set(PERMISSIONS.filter((p) => p.power && p.absentOn).map((p) => p.power!));
// Every real tablet tri-state settings column (the waiter rung).
export const TABLET_PERM_KEYS: readonly string[] = PERMISSIONS.filter((p) => p.tablet && !p.tabletNew).map((p) => p.tablet!);
// One entry per MODULE (capabilities sharing columns — khata + table types — dedupe).
export type ModuleDef = {
  key: string; label: string; allowed: string; control: string; enabled: string;
  /** TRUE = this module's ladder lives in settings.modules[key] instead of three columns
   *  (mig 320). Declare `moduleBag: true` on the permission and give `module` the SAME key three
   *  times — the column names are then never used, and no migration is needed for a new module.
   *  The eleven modules that predate the bag are deliberately NOT converted; see mig 320. */
  bag?: boolean;
};
export const MODULE_DEFS: ModuleDef[] = PERMISSIONS.reduce<ModuleDef[]>((acc, p) => {
  if (p.module && !acc.some((m) => m.allowed === p.module!.allowed))
    acc.push({ key: p.module.allowed.replace("_allowed", ""), label: p.moduleLabel || p.name, ...p.module,
               ...(p.moduleBag ? { bag: true } : {}) });
  return acc;
}, []);

// The canonical module name a permission's ladder columns live under
// (e.g. "table_tags" from "table_tags_allowed"), or "" for a plain power.
export function moduleKey(p: Perm): string {
  return p.module ? p.module.allowed.replace("_allowed", "") : "";
}
