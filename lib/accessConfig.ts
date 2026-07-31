// lib/accessConfig.ts — the CANONICAL admin-editable access lists, shared by the
// per-restaurant Access editor (retired 2026-07-31 — Access is lib/accessTree.ts now) AND the create-
// restaurant flow (app/api/admin/restaurants) so the two can never drift.
//
// These mirror docs/ACCESS-MODEL.md. Keep the DEFAULTS matching the migrations —
// enforcement (managerCan) reads an ABSENT manager-permission key as false, so display
// and truth must agree.

// Tablet capability tri-states (settings.*), off | on | pin. tablet_take_orders
// defaults 'on' (order-taking is the tablet's core function, mig 178); the rest 'off'.
export const TABLET_CAPS = [
  "tablet_discount", "tablet_mark_paid", "tablet_invoice", "tablet_banquet",
  "tablet_table_tags", "tablet_khata", "tablet_table_ops", "tablet_take_orders",
  "tablet_parcel",
] as const;

// Feature-ladder switches on settings (mig 166): the feature's admin "allowed" switch +
// the admin "power transfer" (may the OWNER toggle it). Booleans, default OFF.
export const FEATURE_SWITCHES = [
  "table_tags_allowed", "table_tags_owner_control",
  "banquet_allowed", "banquet_owner_control",
  "table_ops_allowed", "table_ops_owner_control",
  "take_orders_allowed", "take_orders_owner_control",
  // Takeaway & delivery is ONE module since mig 235 (it replaced parcel_* + platform_*).
  "takeaway_allowed", "takeaway_owner_control",
] as const;

// The owner's grant baseline for the manager powers (restaurants.manager_permissions).
// edit_menu/give_discounts/view_dashboard ON; money-risk + newer powers OFF.
// banquet is OFF: mig 167 backfilled "banquet":true ONLY onto restaurants that existed
// then, and the mig-091 column default doesn't include it, so a restaurant created after
// mig 167 has NO banquet key → managerCan reads absent as false. A `true` default made the
// admin switch show GRANTED while managers were refused (403) on new restaurants (QA
// 2026-07-24). Keep matching the migrations — display and truth must agree.
export const MP_DEFAULT: Record<string, boolean> = {
  manage_staff: false, edit_menu: true, give_discounts: true, view_dashboard: true,
  void_bills: false, edit_settings: false, view_ratings: false, table_tags: false,
  // parcel: ON for managers by default (owner 2026-07-26 — common counter task; admin can
  // still switch the module off per restaurant). Its tablet cap stays 'off' below.
  // platform: ON for managers by default (matches parcel — the board was manager-visible
  // everywhere before mig 209). The module itself is off for NEW restaurants, so the whoami
  // overlay hides it until the admin turns the module on; then the manager has it immediately.
  // table_assign: ON for managers (owner 2026-07-29 — managers run the floor, so they can
  // hand out sections out of the box; the owner can still revoke it). Matches the mig-221
  // backfill, which wrote the same `true` onto every restaurant that already existed —
  // display and truth agree. Harmless until the admin turns the module itself on.
  khata: false, banquet: false, table_ops: false, take_orders: false, parcel: true, platform: true,
  table_assign: true,
};

// New-restaurant DEFAULT tablet caps (mirrors lib/settingsClone.ts). take_orders 'on'.
export const TABLET_CAP_DEFAULTS: Record<string, "off" | "on" | "pin"> = {
  tablet_discount: "off", tablet_mark_paid: "off", tablet_invoice: "off",
  tablet_banquet: "off", tablet_table_tags: "off", tablet_khata: "off",
  tablet_table_ops: "off", tablet_take_orders: "on", tablet_parcel: "off",
};

export const isTri = (v: unknown): v is "off" | "on" | "pin" =>
  v === "off" || v === "on" || v === "pin";
