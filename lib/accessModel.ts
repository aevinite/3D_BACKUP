// lib/accessModel.ts — the ONE source of truth for the redesigned access panel
// (owner brief 2026-07-23, design #1). Pure data + pure functions, shared by the
// admin read/write route AND the React panel, so both agree on every mapping.
//
// ARCHITECTURE (see access-panel-BUILD memory): every capability maps onto the
// EXISTING canonical storage so the app's proven enforcement applies the moment
// the panel saves — no route rewrite:
//   • guest features   → settings.features[key]            (admin on/off)
//   • staff apps        → panels route (manager/kitchen/tablet/owner)  (admin on/off)
//   • owner sections    → restaurants.owner_entitlements[key]           (admin on/off)
//   • module ladders    → settings.<x>_allowed / _owner_control / _enabled
//   • plain powers      → owner_entitlements.power_<flag> (admin allow) +
//                         manager_permissions[flag] (owner→manager grant)
//   • tablet rung       → settings.tablet_<x>  ("off" | "on" | "pin")
//   • per-person        → staff_users.permissions[key]  ("on"|"pin"|"off")
// Only genuinely-new granular sub-options (edit-menu split, dashboard/log picks,
// per-side discount caps) live in restaurants.access_config (mig 180); their
// enforcement is a later, reviewed migration.

export type Kind = "switch" | "ladder";
export type SubOpt = { id: string; name: string; adminOnly?: boolean; def?: boolean; what?: string };

export type Perm = {
  id: string;
  group: string;
  kind: Kind;
  name: string;
  what: string;
  adminOnly?: boolean;          // shows the "Admin only" tag (guest 3D is NOT admin-only)
  requires?: string;            // switch depends on another switch being on (reviews→ratings)
  waiter?: boolean;             // ladder can reach the tablet rung (level 3)
  // storage binding ------------------------------------------------------------
  feature?: string;            // settings.features[<feature>]  (guest switch)
  panel?: string;              // panels route key              (staff-app switch)
  section?: string;            // owner_entitlements[<section>] (owner-section switch)
  power?: string;              // manager power flag → owner_entitlements.power_<flag> + manager_permissions[<flag>]
  module?: { allowed: string; control: string; enabled: string }; // settings module-ladder columns
  tablet?: string;             // settings.tablet_<x> tri-state column (the tablet rung)
  adminSwitch?: string;        // settings boolean the ADMIN alone flips (auto_print_kot_allowed)
  isNew?: boolean;             // power that has no legacy enforcement yet (revert_payment/export_reports/view_logs)
  fixedTop?: boolean;          // owner+manager ALWAYS have it (only the tablet rung toggles) — mark_paid / invoice
  tabletNew?: boolean;         // tablet rung has no settings column yet → stored in access_config, enforced later
  tabletDefault?: string;      // tablet tri-state default when unset (off|on|pin). Default "off"; void_bills = "pin" (a walk-out stays closable WITH a manager PIN)
  ownerOnly?: boolean;         // owner-panel-only section (issues/customers): reach is just Off/Owner
  sub?: SubOpt[];              // granular options → access_config[id].{owner_opts,manager_opts}
  limit?: { label: string; unit: string; options: number[] }; // per-side cap → access_config[id].limit
  // ── the owner rung says TWO different things (owner clarification, 2026-07-26) ──
  ownerUse?: "panel" | "manager"; // WHERE the owner personally uses a ladder capability: a page in
                                  // their own owner panel, or through the manager panel's higher-view
                                  // (floor/bill work like parcel). Display truth only — enforcement
                                  // is unchanged (managerCan already passes owners on every power).
  moduleLabel?: string;        // owner-facing label for the MODULE toggle when several capabilities
                               // share one module (khata + table types share the table_tags_* columns)
  absentOn?: boolean;          // this power's manager grant reads an ABSENT key as ON (legacy
                               // non-breaking flags — view_logs); every other power reads absent as OFF
};

export const GROUPS: { id: string; name: string; blurb: string; icon: string }[] = [
  { id: "guest", name: "Guest experience", blurb: "What a diner sees on the menu. Admin switches these on for the restaurant.", icon: "cutlery" },
  { id: "menu", name: "The menu", blurb: "Who may change dishes, prices and categories.", icon: "book" },
  { id: "money", name: "Bills & money", blurb: "Every action that can move money.", icon: "receipt" },
  { id: "floor", name: "Tables & floor", blurb: "Taking orders and moving parties around the floor.", icon: "grip" },
  { id: "kitchen", name: "Kitchen", blurb: "Kitchen ticket printing (admin-only hardware setting).", icon: "fire" },
  { id: "banquet", name: "Banquet & events", blurb: "Per-plate event billing. A special feature the admin switches on.", icon: "sparkles" },
  { id: "reports", name: "Reports & insights", blurb: "Numbers, ratings and the activity log.", icon: "chart" },
  { id: "staff", name: "Staff & settings", blurb: "Managing people and the restaurant's own settings.", icon: "users" },
  { id: "panels", name: "Staff apps", blurb: "Which of the four staff apps this restaurant has. Off refuses the login.", icon: "grid" },
];

const ON = true;

export const PERMISSIONS: Perm[] = [
  // ───────────────────────── GUEST EXPERIENCE (admin switches) ──────────────
  { id: "ratings", group: "guest", kind: "switch", feature: "ratings", name: "Star ratings",
    what: "Guests leave a 1–5 star rating on a dish after eating. Off removes the stars everywhere." },
  { id: "reviews", group: "guest", kind: "switch", feature: "reviews", requires: "ratings", name: "Written reviews",
    what: "A short written review alongside the rating. Needs star ratings on." },
  { id: "model3d", group: "guest", kind: "switch", feature: "model3d", name: "3D dish viewer",
    what: "The rotating 3D model on dishes that have one — a normal guest feature (attaching a model is a separate admin-only job in Edit the menu)." },
  { id: "allergies", group: "guest", kind: "switch", feature: "allergies", name: "Allergy warnings",
    what: "Allergen badges, the allergy filter, and the allergy note on the kitchen ticket.",
    sub: [{ id: "allergies_other", name: "Let a guest add their own allergy", def: true, what: "An “Other…” box so a guest can type an allergy not on your list." }] },
  { id: "favorites", group: "guest", kind: "switch", feature: "favorites", name: "Favourites",
    what: "The heart button on dishes and the Favourites tab." },
  { id: "waiter_calls", group: "guest", kind: "switch", feature: "waiter_calls", name: "Call-waiter button",
    what: "The bell a guest taps to call a waiter." },
  { id: "diet_filter", group: "guest", kind: "switch", feature: "diet_filter", adminOnly: true, name: "Veg / non-veg filter",
    what: "The Veg / Non-veg chips. Pure-veg restaurants switch this off." },
  { id: "languages", group: "guest", kind: "switch", feature: "languages", name: "Language picker",
    what: "Read the menu in any of the six languages. Off = English only." },
  { id: "currency", group: "guest", kind: "switch", feature: "currency", name: "Currency picker",
    what: "Show prices converted. Off = rupees only." },
  // (sticky category bar / scrollspy removed — always on, no toggle. search removed.)

  // ───────────────────────────── THE MENU (ladder) ─────────────────────────
  { id: "edit_menu", group: "menu", kind: "ladder", power: "edit_menu", ownerUse: "panel", name: "Edit the menu",
    what: "The Dishes and Categories screens. Tick exactly which parts each role gets.",
    sub: [
      { id: "add_dish", name: "Add a new dish", what: "The + Add dish button." },
      { id: "edit_dish", name: "Edit a dish", what: "Name, description, photo, tags, allergens." },
      { id: "edit_price", name: "Change a price", what: "The price field only — the field most worth protecting." },
      { id: "delete_dish", name: "Delete a dish", what: "Permanently removes a dish." },
      { id: "mark_86", name: "Mark sold out (86)", what: "Flips a dish sold-out so guests can't order it." },
      { id: "manage_categories", name: "Manage categories", what: "Add, rename, hide menu categories." },
      { id: "manage_filters", name: "Manage filters", what: "The dietary/preference chips guests filter by." },
      { id: "edit_3d", name: "Attach a 3D model", adminOnly: true, what: "Uploading/positioning a dish's 3D model — admin-only, it writes shared storage." },
    ] },

  // ─────────────────────────── BILLS & MONEY (ladder) ──────────────────────
  { id: "give_discounts", group: "money", kind: "ladder", power: "give_discounts", tablet: "tablet_discount", waiter: true, ownerUse: "manager", name: "Give a discount",
    what: "Taking money off a bill. The cap is the most this role may take off in one go.",
    limit: { label: "Most they can take off", unit: "%", options: [5, 10, 20, 50, 100] },
    sub: [
      { id: "whole_bill", name: "Discount the whole bill", what: "A percentage or amount off the whole bill." },
      { id: "on_the_house", name: "Settle on the house", what: "Closes a bill at zero — the highest-risk one." },
    ] },
  { id: "void_bills", group: "money", kind: "ladder", power: "void_bills", tabletNew: true, tabletDefault: "pin", waiter: true, ownerUse: "manager", name: "Void, delete or close a bill",
    what: "Cancelling a bill after it's generated. Every use is logged with the typed reason.",
    sub: [
      { id: "void_bill", name: "Void a bill", what: "Cancels a generated bill but KEEPS it in the records marked voided (nothing collected)." },
      { id: "delete_bill", name: "Delete a bill", what: "Removes the bill entirely — cannot be undone, leaves no record." },
      { id: "close_unpaid", name: "Close a table unpaid", what: "Frees the table, money marked never collected (walk-out / write-off)." },
    ] },
  { id: "mark_paid", group: "money", kind: "ladder", tablet: "tablet_mark_paid", waiter: true, fixedTop: true, ownerUse: "manager", name: "Mark a bill paid (& undo)",
    what: "The button that closes a table as paid — and the matching Undo that reopens a just-paid bill (they deliberately share ONE permission, so undoing is never easier than paying). Owner & manager always have it (it's core to running the floor); the toggle is whether WAITERS get it — the classic “trust one waiter, not another” cap.",
    sub: [
      { id: "pay_cash", name: "Cash", what: "Settle as cash." },
      { id: "pay_card", name: "Card / UPI", what: "Settle as card/UPI." },
      { id: "pay_split", name: "Split across methods", what: "Part cash, part card." },
    ] },
  { id: "print_invoice", group: "money", kind: "ladder", tablet: "tablet_invoice", waiter: true, fixedTop: true, ownerUse: "manager", name: "Generate & print the invoice",
    what: "Producing the tax invoice — carries a legal number that can't be reused. Owner & manager always have it; the toggle is whether waiters may issue invoices.",
    sub: [
      { id: "inv_generate", name: "Generate the invoice", what: "Assigns the next invoice number." },
      { id: "inv_reprint", name: "Reprint an invoice", what: "Prints a copy of an already-issued invoice." },
    ] },
  { id: "khata", group: "money", kind: "ladder", power: "khata", tablet: "tablet_khata", waiter: true, ownerUse: "panel",
    module: { allowed: "table_tags_allowed", control: "table_tags_owner_control", enabled: "table_tags_enabled" },
    moduleLabel: "Table types (VIP / Family / Guest) + pay later", name: "Khata — put it on their tab",
    what: "Parking a bill against a named regular to collect later, and the book that tracks who owes what.",
    sub: [
      { id: "khata_add", name: "Park a bill on a person", what: "Moves the amount to that person's tab." },
      { id: "khata_settle", name: "Settle a tab", what: "Takes the money and clears what a person owes." },
      { id: "khata_book", name: "See the whole book", what: "Every person and how much is outstanding." },
    ] },

  // ─────────────────────────── TABLES & FLOOR (ladder) ─────────────────────
  { id: "take_orders", group: "floor", kind: "ladder", power: "take_orders", tablet: "tablet_take_orders", waiter: true, ownerUse: "manager",
    module: { allowed: "take_orders_allowed", control: "take_orders_owner_control", enabled: "take_orders_enabled" }, name: "Take a new order",
    what: "Punching in a dine-in order. Waiters do this by default; you can hand it to the manager too, or pull it back." },
  { id: "parcel", group: "floor", kind: "ladder", power: "parcel", tablet: "tablet_parcel", waiter: true, ownerUse: "manager",
    module: { allowed: "parcel_allowed", control: "parcel_owner_control", enabled: "parcel_enabled" }, name: "Parcel / takeaway orders",
    what: "The 🥡 New Parcel button — punch in a quick takeaway order from the floor (no table). It shows in the Platform board as a Takeaway, next to Zomato/Swiggy." },
  { id: "platform", group: "floor", kind: "ladder", power: "platform", ownerUse: "manager",
    module: { allowed: "platform_allowed", control: "platform_owner_control", enabled: "platform_enabled" },
    name: "Platform board (Zomato / Swiggy)",
    what: "The 🛵 Platform tab — online delivery orders from Zomato / Swiggy and the restaurant's own website. Turn it off for restaurants that aren't on the delivery apps. Which channels are live (and their API keys) are set in the restaurant's Platform card. Takeaway parcels have their own separate switch and keep their board either way." },
  { id: "table_ops", group: "floor", kind: "ladder", power: "table_ops", tablet: "tablet_table_ops", waiter: true, ownerUse: "manager",
    module: { allowed: "table_ops_allowed", control: "table_ops_owner_control", enabled: "table_ops_enabled" }, name: "Table & ticket operations",
    what: "The KOT ▾ menu: moving parties/tickets after an order has gone to the kitchen.",
    sub: [
      { id: "change_table", name: "Move a party to another table", what: "Shifts the whole party, bill and all." },
      { id: "merge_tables", name: "Merge two tables", what: "Joins two parties into one bill." },
      { id: "move_kot", name: "Move a whole ticket", what: "Sends one kitchen ticket to a different table." },
      { id: "move_dish", name: "Move a single dish", what: "Moves one line to another table's bill." },
      { id: "split_bill", name: "Split the bill", what: "Breaks one bill into several." },
      { id: "reprint_kot", name: "Reprint a kitchen ticket", what: "Prints the ticket again for the kitchen." },
    ] },
  { id: "table_tags", group: "floor", kind: "ladder", power: "table_tags", tablet: "tablet_table_tags", waiter: true, ownerUse: "manager",
    module: { allowed: "table_tags_allowed", control: "table_tags_owner_control", enabled: "table_tags_enabled" },
    moduleLabel: "Table types (VIP / Family / Guest) + pay later", name: "Table types (VIP / Family / Guest)",
    what: "Marking a table so the floor shows who's sitting there.",
    sub: [{ id: "tag_set", name: "Mark / remove a table's type", what: "Puts or clears the VIP / Family / Owner's-guest ribbon on a table." }] },

  // ───────────────────────────── KITCHEN (admin switch) ────────────────────
  { id: "auto_print_kot", group: "kitchen", kind: "switch", adminSwitch: "auto_print_kot_allowed", adminOnly: true, name: "Auto-print kitchen tickets",
    what: "Tickets print themselves as orders come in. A main hardware setting — only the admin turns it on/off; it is not delegated." },

  // ───────────────────────────── BANQUET (ladder) ──────────────────────────
  // banquet carries the tablet rung too — the waiter cap (settings.tablet_banquet) has been
  // server-enforced since mig 130 (tabletPerm) and the manager panel already sets it; without
  // `tablet`/`waiter` here the admin panel could neither see nor set a rung that genuinely
  // works — a working-but-invisible switch (fixed 2026-07-26).
  { id: "banquet", group: "banquet", kind: "ladder", power: "banquet", tablet: "tablet_banquet", waiter: true, ownerUse: "manager",
    module: { allowed: "banquet_allowed", control: "banquet_owner_control", enabled: "banquet_enabled" }, name: "Banquet & events",
    what: "Per-plate event billing that runs without a table. A special feature the admin allows first.",
    sub: [
      { id: "bq_create", name: "Create an event", what: "Starting a new banquet booking." },
      { id: "bq_bill", name: "Bill an event", what: "Closing and settling the event." },
      { id: "bq_reports", name: "See banquet reports", what: "Event revenue separated from dine-in." },
    ] },

  // ─────────────────────────── REPORTS & INSIGHTS (ladder) ─────────────────
  { id: "view_dashboard", group: "reports", kind: "ladder", power: "view_dashboard", section: "reports", ownerUse: "panel", name: "Dashboard & reports",
    what: "The numbers screen. Tick which reports each role may open.",
    sub: [
      { id: "rep_sales", name: "Sales summary", what: "Revenue, covers, average bill." },
      { id: "rep_items", name: "Dish performance", what: "What sold, what didn't." },
      { id: "rep_tables", name: "Table turnover", what: "How long parties sit / how often tables turn." },
      { id: "rep_staff", name: "Staff performance", what: "Per-waiter sales and speed. Sensitive — usually owner only." },
      { id: "rep_tax", name: "Tax report", what: "CGST / SGST breakdown." },
      { id: "rep_zclose", name: "Day close (Z report)", what: "The end-of-day cash-up." },
    ] },
  { id: "view_ratings", group: "reports", kind: "ladder", power: "view_ratings", section: "ratings", ownerUse: "panel", name: "Guest ratings & feedback",
    what: "Reading what guests said and handling complaints.",
    sub: [
      { id: "rat_view", name: "Read ratings", what: "See the star ratings and comments." },
      { id: "rat_respond", name: "Mark a complaint handled", what: "Closing off an issue with a note." },
      { id: "rat_delete", name: "Delete a rating", what: "Removing a rating — owner-level by default." },
    ] },
  // (Download & export removed — the app has no export feature yet; it returns here when that's built. See access-panel-build memory, Part I.)
  // view_logs is the one ABSENT-ON power: canViewLogs (editor API) deliberately keeps the log
  // for a manager unless someone EXPLICITLY switched it off (non-breaking rollout, 2026-07-24).
  { id: "view_logs", group: "reports", kind: "ladder", power: "view_logs", absentOn: true, ownerUse: "panel", name: "Activity log",
    what: "The record of who did what. Choose which logs each role may read. (Admin-action logs are never delegated.)",
    sub: [
      { id: "log_orders", name: "Order changes", what: "Dishes added, removed, moved." },
      { id: "log_bills", name: "Bill actions", what: "Discounts, voids, refunds — with the typed reason." },
      { id: "log_staff", name: "Staff actions", what: "Logins, shift changes, power grants." },
    ] },
  { id: "handle_issues", group: "reports", kind: "ladder", section: "issues", ownerOnly: true, ownerUse: "panel", name: "Issues & tickets",
    what: "The Issues page — staff-raised tickets with photo/voice notes. An owner-panel page; not delegated to a waiter." },
  { id: "view_customers", group: "reports", kind: "ladder", section: "customers", ownerOnly: true, ownerUse: "panel", name: "Customers list",
    what: "The guest list built from past orders. An owner-panel page." },

  // ─────────────────────────── STAFF & SETTINGS (ladder) ───────────────────
  { id: "manage_staff", group: "staff", kind: "ladder", power: "manage_staff", section: "staff", ownerUse: "panel", name: "Manage staff",
    what: "Adding people, changing roles, resetting PINs.",
    sub: [
      { id: "st_add", name: "Add a person", what: "Creating a new staff login." },
      { id: "st_edit", name: "Edit a person", what: "Name, username, role." },
      { id: "st_remove", name: "Remove a person", what: "Deactivating a staff login." },
      { id: "st_pin", name: "Reset a PIN", what: "Issuing a new PIN when locked out." },
      { id: "st_grant", name: "Grant powers to others", what: "Handing capabilities onward — and ONLY powers this person already holds. Owner-level by default." },
    ] },
  { id: "edit_settings", group: "staff", kind: "ladder", power: "edit_settings", section: "settings", ownerUse: "panel", name: "Restaurant settings",
    what: "The restaurant's own configuration screens.",
    sub: [
      { id: "set_brand", name: "Branding & appearance", what: "Logo, colours, splash." },
      { id: "set_tax", name: "Tax rates", what: "The GST rate on every bill — money-sensitive." },
      { id: "set_hours", name: "Opening hours", what: "When the menu accepts orders." },
      { id: "set_printers", name: "Printers & stations", what: "Which printer serves which station." },
      { id: "set_tables", name: "Tables & floor plan", what: "Adding, renaming, removing tables." },
    ] },

  // ───────────────────────────── STAFF APPS (admin switch) ─────────────────
  { id: "panel_manager", group: "panels", kind: "switch", panel: "manager", name: "Manager panel", what: "The full control room. Off refuses a manager login at the door." },
  { id: "panel_kitchen", group: "panels", kind: "switch", panel: "kitchen", name: "Kitchen display", what: "The New → Cooking → Ready board and the 86 list." },
  { id: "panel_tablet", group: "panels", kind: "switch", panel: "tablet", name: "Waiter tablet", what: "The floor tiles and take-order app." },
  { id: "panel_owner", group: "panels", kind: "switch", panel: "owner", name: "Owner panel", what: "The owner's own dashboard, staff and reports." },

  // ──────────────────────── OWNER PANEL SECTIONS (admin switch) ─────────────
];

export const PERM_BY_ID: Record<string, Perm> = Object.fromEntries(PERMISSIONS.map((p) => [p.id, p]));
export const GROUP_BY_ID = Object.fromEntries(GROUPS.map((g) => [g.id, g]));
export const permsOf = (gid: string) => PERMISSIONS.filter((p) => p.group === gid);

export const maxReach = (p: Perm) => (p.ownerOnly ? 1 : p.waiter ? 3 : 2);

// Manager powers that DON'T exist in the legacy flag list yet — the read/write
// route stores them, but their server enforcement is a later reviewed step.
export const NEW_POWER_FLAGS = PERMISSIONS.filter((p) => p.isNew && p.power).map((p) => p.power!) as string[];

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
export type ModuleDef = { key: string; label: string; allowed: string; control: string; enabled: string };
export const MODULE_DEFS: ModuleDef[] = PERMISSIONS.reduce<ModuleDef[]>((acc, p) => {
  if (p.module && !acc.some((m) => m.allowed === p.module!.allowed))
    acc.push({ key: p.module.allowed.replace("_allowed", ""), label: p.moduleLabel || p.name, ...p.module });
  return acc;
}, []);

// ── the live server state the panel reads (mirrors the extended access route) ─
export type AccessState = {
  features: Record<string, boolean>;     // settings.features
  panels: Record<string, boolean>;       // manager/kitchen/tablet/owner
  owner: Record<string, boolean>;        // owner_entitlements (sections + power_<flag>)
  manager: Record<string, boolean>;      // manager_permissions
  tablet: Record<string, string>;        // settings.tablet_<x>  off|on|pin
  modules: Record<string, { allowed: boolean; control: boolean; enabled: boolean }>;
  adminSwitches: Record<string, boolean>; // auto_print_kot_allowed …
  config: Record<string, any>;            // restaurants.access_config (granular extras)
};

const powerKey = (flag: string) => `power_${flag}`;

// The canonical module name a permission's ladder columns live under
// (e.g. "table_tags" from "table_tags_allowed"), or "" for a plain power.
export function moduleKey(p: Perm): string {
  return p.module ? p.module.allowed.replace("_allowed", "") : "";
}

// Is a ladder power ALLOWED for the restaurant at all (the admin rung)?
//  • module-backed → its <x>_allowed column (state.modules[key].allowed)
//  • plain power    → owner_entitlements.power_<flag>, where ABSENT means allowed
export function allowed(p: Perm, s: AccessState): boolean {
  if (p.module) return !!s.modules[moduleKey(p)]?.allowed;
  if (p.section) return s.owner[p.section] !== false;   // the owner-panel section IS the owner gate (absent = on)
  if (p.power) return s.owner[powerKey(p.power)] !== false;
  return true;
}

// The tablet rung's tri-state ("off"|"on"|"pin"): a real settings column for the
// existing caps, or access_config[id].tablet for the new ones (void/revert).
export function tabletValue(p: Perm, s: AccessState): string {
  if (p.tabletNew) return String(s.config?.[p.id]?.tablet || p.tabletDefault || "off");
  if (p.tablet) return s.tablet[p.tablet] || "off";
  return "off";
}

// The reach level (0 off · 1 owner · 2 +manager · 3 +tablet) computed from live state.
export function reachLevel(p: Perm, s: AccessState): number {
  if (p.kind !== "ladder") return 0;
  if (!allowed(p, s)) return 0;
  let lvl = 1;                                        // admin-allowed ⇒ owner has it
  if (p.fixedTop) lvl = 2;                             // mark_paid / invoice: owner+manager always
  // absentOn (view_logs): an ABSENT grant means ON — display must match what canViewLogs
  // enforces, or the panel shows "Owner only" while managers genuinely have the log.
  else if (p.power && (p.absentOn ? s.manager[p.power] !== false : !!s.manager[p.power])) lvl = 2;
  if (lvl >= 2 && p.waiter && tabletValue(p, s) !== "off") lvl = 3;
  return lvl;
}

export function subState(p: Perm, side: "owner" | "manager" | "waiter", s: AccessState): Record<string, boolean> {
  const cfg = s.config?.[p.id];
  const key = side === "owner" ? "owner_opts" : side === "manager" ? "manager_opts" : "waiter_opts";
  return (cfg && cfg[key]) || {};
}
