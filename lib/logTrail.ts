// lib/logTrail.ts — turning one log row into "where in the app did this actually happen?"
//
// ── THE OWNER'S ASK, 2026-08-12 ───────────────────────────────────────────────────────────────────
//
//   "it's still hard to identify who did what — there should be restaurant name, which panel,
//    inside panel which menu, inside menu … he clicked take order, but from where, table detail …
//    in short it will show, but when you go in detail it will actually show the log."
//
// Today a row says `order_place` → "Placed order". True, and almost useless: it does not say WHERE
// the person was standing when they did it. A restaurant with three panels, twenty screens and a
// dozen staff needs the PATH, not just the verb.
//
// So every row now resolves to a trail:
//
//     My Little French House  ›  Manager panel  ›  The floor  ›  Take order  ›  Table 5
//     └─ restaurant ─────────┘  └─ panel ─────┘  └─ area ───┘  └─ screen ─┘  └─ target ┘
//
// The short list shows the last two or three crumbs; the detail card shows the whole path.
//
// ── WHY IT IS DERIVED, NOT RECORDED ──────────────────────────────────────────────────────────────
//
// The honest alternative was to add `area`/`screen` columns and pass them at all 84 `logAction`
// call sites. That would be more precise — and it would also mean the 30,583 rows ALREADY in the
// table stay blank forever, which is most of what an owner ever looks at. Deriving from the action
// code gives every existing row a trail immediately, costs nothing at write time, and cannot drift
// out of step with the labels because both are keyed off the same code.
//
// Where a call site genuinely knows something extra (which table, which bill), it already records it
// in `table_number` / `order_id` / `detail` — so the TARGET is read from those, not invented.
//
// This file is CLIENT-SAFE: no imports that reach the server (see lib/partialRead.ts's header for
// what happens otherwise). The API attaches a trail to each row, and the UI can also compute one
// for a row it already holds.

/** Which panel a row came from, in the words a person uses for it. */
const PANEL_NAME: Record<string, string> = {
  editor: "Manager panel",     // "editor" is the old name for the manager panel
  manager: "Manager panel",
  kitchen: "Kitchen screen",
  tablet: "Waiter tablet",
  owner: "Owner dashboard",
  admin: "Aevidine console",
  db: "Direct database edit",
  guest: "Guest phone",
  menu: "Guest menu",
};

/** The AREAS, in the order a restaurant thinks about them. */
export const AREAS = [
  "Orders & bills",
  "The floor",
  "The menu",
  "Parcel & delivery",
  "Banquet",
  "Stock & expenses",
  "People & pay",
  "Guests",
  "Settings & features",
  "Sign-in & security",
  "Aevidine console",
  "System",
] as const;
export type Area = (typeof AREAS)[number];

type Place = { area: Area; screen: string };

/**
 * Action code → where it lives. Explicit entries first; anything not named here falls through to
 * the prefix rules below, and anything those miss lands in "System" (which is honest — an
 * unrecognised action genuinely has no known home until someone gives it one).
 */
const PLACE: Record<string, Place> = {
  // ── Orders & bills ──────────────────────────────────────────────────────────────────────────
  order_place: { area: "Orders & bills", screen: "Take order" },
  order_add_item: { area: "Orders & bills", screen: "Edit an order" },
  order_item_qty: { area: "Orders & bills", screen: "Edit an order" },
  order_item_note: { area: "Orders & bills", screen: "Edit an order" },
  order_item_delete: { area: "Orders & bills", screen: "Edit an order" },
  order_item_move: { area: "Orders & bills", screen: "Edit an order" },
  order_item_removed: { area: "Orders & bills", screen: "Allergies" },
  order_allergies: { area: "Orders & bills", screen: "Allergies" },
  order_accept: { area: "Orders & bills", screen: "Kitchen tickets" },
  order_ready: { area: "Orders & bills", screen: "Kitchen tickets" },
  order_unready: { area: "Orders & bills", screen: "Kitchen tickets" },
  order_serve: { area: "Orders & bills", screen: "Kitchen tickets" },
  item_status: { area: "Orders & bills", screen: "Kitchen tickets" },
  order_cancel: { area: "Orders & bills", screen: "Kitchen tickets" },
  // ── "WAS THE FOOD ACTUALLY MADE?" (migration 340) ────────────────────────────────────────────
  // Both rows are written by app/api/editor/[...path]/route.ts when somebody answers that question
  // on a cancellation, so both happened on the MANAGER panel's kitchen tickets. They were declared
  // in components/admin/shared.tsx's ACT_LABEL and never here, so placeOf() fell through to
  // "System › Other" and the two rows lost their restaurant › panel › area › screen path in the
  // Activity log's detail card — against the standing rule that every row says where it happened
  // (owner, 2026-08-12). Found by T20, whose own territory did not include this file.
  cancel_classified:      { area: "Orders & bills", screen: "Kitchen tickets" },
  cancel_classify_failed: { area: "Orders & bills", screen: "Kitchen tickets" },
  order_uncancel: { area: "Orders & bills", screen: "Kitchen tickets" },
  kot_reprint_sent: { area: "Orders & bills", screen: "Kitchen tickets" },
  // A ticket actually reaching paper, and failing to (mig 269 recorded them; mig 335 made them
  // routine — one per KOT). Without a place here every one of them read "System › Other", which is
  // the opposite of the owner's rule that the Activity log must read as English.
  kot_printed: { area: "Orders & bills", screen: "Kitchen tickets" },
  kot_print_failed: { area: "Orders & bills", screen: "Kitchen tickets" },
  // Which screen is the printer (mig 338) — a settings-shaped decision made on a device, so it files
  // under the printing screen rather than under the tickets themselves.
  print_station_take: { area: "Settings & features", screen: "Printing" },
  print_station_release: { area: "Settings & features", screen: "Printing" },
  order_move: { area: "Orders & bills", screen: "Move an order" },
  order_delete: { area: "Orders & bills", screen: "Billing" },
  orders_delete: { area: "Orders & bills", screen: "Billing" },
  order_discount: { area: "Orders & bills", screen: "Discount" },
  bill_discount: { area: "Orders & bills", screen: "Discount" },
  bill_paid: { area: "Orders & bills", screen: "Settle the bill" },
  bill_split: { area: "Orders & bills", screen: "Settle the bill" },
  bill_restore: { area: "Orders & bills", screen: "Billing" },
  payment_revert: { area: "Orders & bills", screen: "Settle the bill" },
  payment_legs_reversed: { area: "Orders & bills", screen: "Settle the bill" },
  on_the_house: { area: "Orders & bills", screen: "Settle the bill" },
  close_unpaid: { area: "Orders & bills", screen: "Settle the bill" },
  invoice_generate: { area: "Orders & bills", screen: "Print the bill" },
  invoice_void: { area: "Orders & bills", screen: "Reopen the bill" },
  // A SETTLED bill coming back onto its own free table (mig 365) — a different act from voiding
  // a live bill's invoice above, and it reads differently in the log on purpose.
  table_reopened: { area: "Orders & bills", screen: "Reopen the table" },
  credit_note: { area: "Orders & bills", screen: "Reopen the bill" },
  order_tip: { area: "Orders & bills", screen: "Settle the bill" },
  khata_park: { area: "Orders & bills", screen: "Pay later (khata)" },
  khata_collect: { area: "Orders & bills", screen: "Pay later (khata)" },
  customer_saved: { area: "Orders & bills", screen: "Bill to a customer" },

  // ── The floor ───────────────────────────────────────────────────────────────────────────────
  table_open: { area: "The floor", screen: "Tables" },
  table_close: { area: "The floor", screen: "Tables" },
  table_open_all: { area: "The floor", screen: "Tables" },
  table_close_all: { area: "The floor", screen: "Tables" },
  table_shift: { area: "The floor", screen: "Move a table" },
  table_merge: { area: "The floor", screen: "Merge tables" },
  table_unmerge: { area: "The floor", screen: "Merge tables" },
  table_restart: { area: "The floor", screen: "Tables" },
  table_tag_set: { area: "The floor", screen: "Table marks" },
  table_tag_clear: { area: "The floor", screen: "Table marks" },
  table_sections_set: { area: "The floor", screen: "Waiter sections" },
  table_qr_regen: { area: "The floor", screen: "QR codes" },
  transfer_head: { area: "The floor", screen: "Guests at a table" },
  member_approve: { area: "The floor", screen: "Guests at a table" },
  member_remove: { area: "The floor", screen: "Guests at a table" },
  member_ban: { area: "The floor", screen: "Guests at a table" },
  auto_approve: { area: "The floor", screen: "Guests at a table" },
  call_attend: { area: "The floor", screen: "Waiter calls" },

  // ── The menu ────────────────────────────────────────────────────────────────────────────────
  menu_create: { area: "The menu", screen: "Edit menu" },
  menu_edit: { area: "The menu", screen: "Edit menu" },
  menu_delete: { area: "The menu", screen: "Edit menu" },
  sold_out_on: { area: "The menu", screen: "Sold out" },
  sold_out_off: { area: "The menu", screen: "Sold out" },

  // ── Parcel, banquet, platforms ──────────────────────────────────────────────────────────────
  parcel_place: { area: "Parcel & delivery", screen: "Parcel counter" },
  parcel_collect: { area: "Parcel & delivery", screen: "Parcel counter" },
  parcel_print: { area: "Parcel & delivery", screen: "Parcel counter" },
  platform_toggle: { area: "Parcel & delivery", screen: "Delivery platforms" },
  platform_channel: { area: "Parcel & delivery", screen: "Delivery platforms" },
  platform_status: { area: "Parcel & delivery", screen: "Delivery platforms" },
  platform_test_order: { area: "Parcel & delivery", screen: "Delivery platforms" },
  banquet_place: { area: "Banquet", screen: "Banquet order" },
  banquet_bill: { area: "Banquet", screen: "Banquet bill" },
  banquet_item_save: { area: "Banquet", screen: "Banquet items" },
  banquet_item_delete: { area: "Banquet", screen: "Banquet items" },

  // ── Stock & expenses ────────────────────────────────────────────────────────────────────────
  inv_purchase: { area: "Stock & expenses", screen: "Purchases" },
  inv_purchase_void: { area: "Stock & expenses", screen: "Purchases" },
  inv_waste: { area: "Stock & expenses", screen: "Waste" },
  inv_count_submit: { area: "Stock & expenses", screen: "Stock count" },
  inv_production: { area: "Stock & expenses", screen: "Production" },
  inv_recipe_save: { area: "Stock & expenses", screen: "Recipes" },
  expense_add: { area: "Stock & expenses", screen: "Expenses" },
  expense_void: { area: "Stock & expenses", screen: "Expenses" },

  // ── People & pay ────────────────────────────────────────────────────────────────────────────
  staff_create: { area: "People & pay", screen: "Users" },
  staff_delete: { area: "People & pay", screen: "Users" },
  staff_enable: { area: "People & pay", screen: "Users" },
  staff_disable: { area: "People & pay", screen: "Users" },
  staff_rename: { area: "People & pay", screen: "Users" },
  staff_set_role: { area: "People & pay", screen: "Users" },
  staff_reset_password: { area: "People & pay", screen: "Users" },
  staff_set_permissions: { area: "People & pay", screen: "Access & permissions" },
  manager_permissions: { area: "People & pay", screen: "Access & permissions" },
  access_change: { area: "People & pay", screen: "Access & permissions" },
  staff_profile_edit: { area: "People & pay", screen: "Staff profile" },
  staff_job_edit: { area: "People & pay", screen: "Job & pay" },
  staff_own_pay_visibility: { area: "People & pay", screen: "Job & pay" },
  staff_payment: { area: "People & pay", screen: "Pay ledger" },
  staff_payment_void: { area: "People & pay", screen: "Pay ledger" },
  payroll_add: { area: "People & pay", screen: "Pay list" },
  payroll_remove: { area: "People & pay", screen: "Pay list" },
  user_create: { area: "People & pay", screen: "Users" },
  user_delete: { area: "People & pay", screen: "Users" },
  user_enable: { area: "People & pay", screen: "Users" },
  user_disable: { area: "People & pay", screen: "Users" },
  user_set_role: { area: "People & pay", screen: "Users" },
  user_reset_password: { area: "People & pay", screen: "Users" },
  user_set_access: { area: "People & pay", screen: "Access & permissions" },
  user_set_permissions: { area: "People & pay", screen: "Access & permissions" },
  user_set_job: { area: "People & pay", screen: "Job & pay" },
  user_set_photo: { area: "People & pay", screen: "Staff profile" },
  user_set_pin: { area: "People & pay", screen: "Staff profile" },
  profile_setup: { area: "People & pay", screen: "Staff profile" },
  profile_update: { area: "People & pay", screen: "Staff profile" },
  pin_set: { area: "People & pay", screen: "Staff profile" },
  password_change: { area: "People & pay", screen: "Staff profile" },

  // ── Guests ──────────────────────────────────────────────────────────────────────────────────
  customer_erase: { area: "Guests", screen: "Guest list" },
  rating_handled: { area: "Guests", screen: "Ratings" },
  issue_raised: { area: "Guests", screen: "Complaints" },
  issue_resolved: { area: "Guests", screen: "Complaints" },
  issue_reopened: { area: "Guests", screen: "Complaints" },

  // ── Settings & features ─────────────────────────────────────────────────────────────────────
  module_toggle: { area: "Settings & features", screen: "Feature switches" },
  quick_feature: { area: "Settings & features", screen: "Feature switches" },
  feature_flip: { area: "Settings & features", screen: "Feature switches" },
  staff_feature: { area: "Settings & features", screen: "Feature switches" },
  google_review: { area: "Settings & features", screen: "Settings" },
  // P5 (T15, 2026-08-14): the screen is called "Menu maintenance" in the manager panel and
  // "maintenance" in the admin console — "Service mode" was a fifth name for one switch.
  maintenance_on: { area: "Settings & features", screen: "Menu maintenance" },
  maintenance_off: { area: "Settings & features", screen: "Menu maintenance" },
  retention_change: { area: "Settings & features", screen: "Settings" },
  printer_problem: { area: "Settings & features", screen: "Printing" },
  printer_problem_resolved: { area: "Settings & features", screen: "Printing" },
  // ── THE PRINT HELPER (migration 341, shipped 2026-08-20) ────────────────────────────────────
  // Six of these are written by app/api/admin/printing/[...path] — the admin console's Printing
  // screen, where a COMPUTER is given the paper. They were declared in ACT_LABEL and nowhere here,
  // so every one read "System › Other" in the Activity log's detail card, against the standing
  // rule that every row says where it happened (owner, 2026-08-12). Added on 2026-08-20 with the
  // two cancel_* rows above, which had the identical gap.
  print_helper_added: { area: "Aevidine console", screen: "Printing" },
  print_helper_recoded: { area: "Aevidine console", screen: "Printing" },
  print_helper_removed: { area: "Aevidine console", screen: "Printing" },
  print_routes_changed: { area: "Aevidine console", screen: "Printing" },
  print_switch: { area: "Aevidine console", screen: "Printing" },
  print_test: { area: "Aevidine console", screen: "Printing" },
  // These two are written when a bill or a banquet sheet actually goes to paper, so they happened
  // where the printing did — the manager panel (and, since mig 341, the waiter tablet), not the
  // console. The `_by_admin` twin is the same act done through act-as; its LABEL already says so,
  // and its place is still the screen the paper came out of.
  //
  // FILED UNDER "Print the bill", NOT "Kitchen tickets" (owner, 2026-08-28: "make log do that").
  // These two codes are written in exactly two places, and BOTH are the bill/banquet `print/send`
  // door — a kitchen ticket is `kot_reprint_sent` / `kot_printed`, which are different codes. So
  // filing them under Kitchen tickets put every bill print in the wrong drawer twice over: looking
  // under Bills for "where did that bill come out?" found nothing, and filtering Kitchen tickets
  // returned bills that were never kitchen tickets. "Print the bill" already exists as a screen
  // here (invoice_generate uses it), so this is a move, not a new name.
  print_sent: { area: "Orders & bills", screen: "Print the bill" },
  print_sent_by_admin: { area: "Orders & bills", screen: "Print the bill" },

  // ── Sign-in & security ──────────────────────────────────────────────────────────────────────
  // The admin stepping into a restaurant's own panel (act-as). Already red on main before the print
  // queue branch touched this file — one line, and the log stops filing it under "System › Other".
  admin_enter_panel: { area: "Sign-in & security", screen: "Sign in" },
  login: { area: "Sign-in & security", screen: "Sign in" },
  logout: { area: "Sign-in & security", screen: "Sign in" },
  login_failed: { area: "Sign-in & security", screen: "Sign in" },
  login_blocked: { area: "Sign-in & security", screen: "Sign in" },
  login_denied: { area: "Sign-in & security", screen: "Sign in" },
  rate_limited: { area: "Sign-in & security", screen: "Limits" },
  rate_limit_edit: { area: "Sign-in & security", screen: "Limits" },
  rate_limit_allow: { area: "Sign-in & security", screen: "Limits" },
  admin_block: { area: "Sign-in & security", screen: "Blocked devices" },
  admin_unblock: { area: "Sign-in & security", screen: "Blocked devices" },
  admin_lockout_clear: { area: "Sign-in & security", screen: "Blocked devices" },
  blocklist_add: { area: "Sign-in & security", screen: "Blocked devices" },
  blocklist_remove: { area: "Sign-in & security", screen: "Blocked devices" },

  // ── Aevidine console ────────────────────────────────────────────────────────────────────────
  restaurant_create: { area: "Aevidine console", screen: "Restaurants" },
  restaurant_settings: { area: "Aevidine console", screen: "Restaurants" },
  restaurant_branding: { area: "Aevidine console", screen: "Restaurants" },
  restaurant_logo: { area: "Aevidine console", screen: "Restaurants" },
  restaurant_export: { area: "Aevidine console", screen: "Restaurants" },
  restaurant_set_owner: { area: "Aevidine console", screen: "Restaurants" },
  restaurant_suspend: { area: "Aevidine console", screen: "Restaurants" },
  restaurant_reactivate: { area: "Aevidine console", screen: "Restaurants" },
  restaurant_soft_delete: { area: "Aevidine console", screen: "Recycle bin" },
  restaurant_restore: { area: "Aevidine console", screen: "Recycle bin" },
  restaurant_purge: { area: "Aevidine console", screen: "Recycle bin" },
  owner_create: { area: "Aevidine console", screen: "Owners" },
  owner_rename: { area: "Aevidine console", screen: "Owners" },
  owner_reset_password: { area: "Aevidine console", screen: "Owners" },
  owner_attach_restaurant: { area: "Aevidine console", screen: "Owners" },
  owner_detach_restaurant: { area: "Aevidine console", screen: "Owners" },
  owner_set_primary: { area: "Aevidine console", screen: "Owners" },
  owner_suspend: { area: "Aevidine console", screen: "Owners" },
  owner_restore: { area: "Aevidine console", screen: "Owners" },
  owner_soft_delete: { area: "Aevidine console", screen: "Recycle bin" },
  owner_restore_from_bin: { area: "Aevidine console", screen: "Recycle bin" },
  owner_purge: { area: "Aevidine console", screen: "Recycle bin" },
  billing_set_plan: { area: "Aevidine console", screen: "Billing" },
  billing_add_payment: { area: "Aevidine console", screen: "Billing" },
  billing_delete_payment: { area: "Aevidine console", screen: "Billing" },
  logs_cleanup: { area: "Aevidine console", screen: "Logs" },
  error_memory_cleared: { area: "Aevidine console", screen: "Logs" },
  fix_request: { area: "Aevidine console", screen: "Repair" },
  error_resolved: { area: "Aevidine console", screen: "Repair" },
  error_reopened: { area: "Aevidine console", screen: "Repair" },
  error_snoozed: { area: "Aevidine console", screen: "Repair" },
  errors_resolved_all: { area: "Aevidine console", screen: "Repair" },
  errors_snoozed_all: { area: "Aevidine console", screen: "Repair" },
  rate_limit_dismiss_all: { area: "Aevidine console", screen: "Repair" },
  repair_void_bill: { area: "Aevidine console", screen: "Repair" },
  repair_delete_order: { area: "Aevidine console", screen: "Repair" },
  repair_refire_order: { area: "Aevidine console", screen: "Repair" },
  repair_unstick_table: { area: "Aevidine console", screen: "Repair" },
  repair_edit_time: { area: "Aevidine console", screen: "Repair" },

  // ── System ──────────────────────────────────────────────────────────────────────────────────
  route_error: { area: "System", screen: "Server" },
  client_error: { area: "System", screen: "Screen error" },
  ui_taps: { area: "System", screen: "Button taps" },
  row_change: { area: "System", screen: "Direct database edit" },
  alert_sent: { area: "System", screen: "Alerts" },
  audit_record_failed: { area: "System", screen: "Server" },
};

/** Prefix fallbacks, for a code nobody has placed by hand yet. Order matters: first match wins. */
const PREFIX: [RegExp, Place][] = [
  [/^order_|^bill_|^invoice_|^payment_|^khata_|^credit_/, { area: "Orders & bills", screen: "Billing" }],
  [/^table_|^member_|^call_/, { area: "The floor", screen: "Tables" }],
  [/^menu_|^sold_out/, { area: "The menu", screen: "Edit menu" }],
  [/^parcel_|^platform_/, { area: "Parcel & delivery", screen: "Parcel counter" }],
  [/^banquet_/, { area: "Banquet", screen: "Banquet order" }],
  [/^inv_|^expense_/, { area: "Stock & expenses", screen: "Stock" }],
  [/^staff_|^user_|^payroll_|^profile_|^pin_|^password_/, { area: "People & pay", screen: "Users" }],
  [/^issue_|^rating_|^customer_/, { area: "Guests", screen: "Guests" }],
  [/^login|^logout|^rate_limit|^blocklist_|^admin_(block|unblock|lockout)/, { area: "Sign-in & security", screen: "Sign in" }],
  [/^restaurant_|^owner_|^billing_|^repair_|^error_|^logs_/, { area: "Aevidine console", screen: "Console" }],
  [/^maintenance_|^feature_|^quick_feature|^retention_|^access_/, { area: "Settings & features", screen: "Settings" }],
];

/**
 * THE SAME ACT, DONE FROM A DIFFERENT PANEL, HAPPENED ON A DIFFERENT SCREEN (2026-08-21).
 *
 * Two codes are written from BOTH the Aevidine console and the manager panel — `credit_note` and
 * `order_delete` — and the map above can only give a code one home. So an admin who issued a credit
 * note on the console's **Bills** page had their row filed under "Orders & bills › Reopen the bill":
 * an area the console does not have, and a screen that only exists in the manager panel. The whole
 * point of the trail is that it says where the person was standing (owner, 2026-08-12), so for those
 * two the answer has to depend on the panel as well as the code.
 *
 * Deliberately tiny and explicit rather than clever: only a code that is genuinely written from two
 * panels needs an entry, and `verify:t24-money-rules` fails when a new one appears without one. The
 * same reasoning the print rows above already carry (`print_sent` is the manager panel, the
 * `print_helper_*` twins are the console) — this just makes it work for a shared code.
 */
const PANEL_PLACE: Record<string, Record<string, Place>> = {
  admin: {
    // /aevinite/bill-audit — the page's own heading is "Bills". Not "Billing", which is the
    // console's SUBSCRIPTION screen (billing_set_plan et al.) and a different place entirely.
    credit_note: { area: "Aevidine console", screen: "Bills" },
    order_delete: { area: "Aevidine console", screen: "Bills" },
  },
};

/** Where in the app an action lives. Never throws; an unknown code lands in System.
 *
 *  `panel` is optional and only changes the answer for a code that is written from more than one
 *  panel (see PANEL_PLACE). Callers that only hold the code keep working exactly as before. */
export function placeOf(action: string | null | undefined, panel?: string | null): Place {
  const a = String(action || "").trim();
  if (!a) return { area: "System", screen: "Unknown" };
  const p = String(panel || "").trim().toLowerCase();
  if (p && PANEL_PLACE[p]?.[a]) return PANEL_PLACE[p][a];
  if (PLACE[a]) return PLACE[a];
  for (const [re, p2] of PREFIX) if (re.test(a)) return p2;
  return { area: "System", screen: "Other" };
}

/** The codes that need a panel to be placed correctly — read by the guard so a THIRD dual-written
 *  code cannot appear without one. */
export const PANEL_SPECIFIC_PLACES = PANEL_PLACE;

/** The panel, in words. An unknown panel prints itself rather than vanishing. */
export function panelName(panel: string | null | undefined): string {
  const p = String(panel || "").trim().toLowerCase();
  return PANEL_NAME[p] || (p ? p.charAt(0).toUpperCase() + p.slice(1) : "Unknown panel");
}

/**
 * WHAT the action was done TO — "Table 5", "Bill #212", "Paneer Tikka".
 *
 * Read from the columns that already carry it, in order of how specific they are. The quoted-string
 * sniff on `detail` is last and deliberately cautious: most detail lines put the thing they acted on
 * in double quotes (`created manager "ravi"`, `updated "Paneer Tikka"`), so pulling the first quoted
 * run is right far more often than not — and when there is no quote we simply say nothing rather
 * than guessing.
 */
export function targetOf(row: {
  table_number?: string | null; order_id?: string | null; detail?: string | null; action?: string | null;
}): string | null {
  const t = String(row.table_number || "").trim();
  if (t) return /^\d+$/.test(t) ? `Table ${t}` : t;
  const quoted = String(row.detail || "").match(/"([^"]{1,60})"/);
  if (quoted) return quoted[1];
  const billNo = String(row.detail || "").match(/\bbill\s*#?\s*(\d{1,7})\b/i);
  if (billNo) return `Bill #${billNo[1]}`;
  if (row.order_id) return `Order ${String(row.order_id).slice(0, 8)}`;
  return null;
}

export type LogTrail = {
  restaurant: string | null;
  panel: string;
  area: Area;
  screen: string;
  target: string | null;
  /** The whole path, ready to render as `a › b › c`. Restaurant is included when known. */
  crumbs: string[];
  /** The short form for a list row: the last two meaningful crumbs. */
  short: string;
};

/** Build the full trail for one log row. Pure — safe on the server and in the browser. */
export function trailOf(row: {
  panel?: string | null; action?: string | null; table_number?: string | null;
  order_id?: string | null; detail?: string | null; restaurant_name?: string | null;
}): LogTrail {
  // The PANEL is passed too: a code written from both the console and the manager panel is placed
  // on the screen the person was actually looking at (see PANEL_PLACE).
  const { area, screen } = placeOf(row.action, row.panel);
  const panel = panelName(row.panel);
  const target = targetOf(row);
  const restaurant = row.restaurant_name || null;
  const crumbs = [restaurant, panel, area, screen].filter(Boolean) as string[];
  // The list row has very little width, so it gets the two crumbs that actually narrow things down
  // (the area and the screen) plus the target — the panel and restaurant are usually already
  // obvious from the chip and the filter.
  const short = [screen, target].filter(Boolean).join(" · ");
  return { restaurant, panel, area, screen, target, crumbs, short };
}
