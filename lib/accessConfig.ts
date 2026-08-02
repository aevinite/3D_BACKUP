// lib/accessConfig.ts — the CANONICAL admin-editable access lists, shared by the
// per-restaurant Access editor (retired 2026-07-31 — Access is lib/accessTree.ts now) AND the create-
// restaurant flow (app/api/admin/restaurants) so the two can never drift.
//
// These mirror docs/ACCESS-MODEL.md. Keep the DEFAULTS matching the migrations —
// enforcement (managerCan) reads an ABSENT manager-permission key as false, so display
// and truth must agree.

import { MANAGER_GRANT_DEFAULTS, managerGrantValue } from "@/lib/accessTree";
import { MANAGER_POWER_FLAGS } from "@/lib/accessModel";

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
  // TWO separate features (mig 259): Platforms (Zomato/Swiggy/own website) and the counter
  // Parcel. One switch each — see the box at the top of lib/tableTags.ts.
  "takeaway_allowed", "takeaway_owner_control",
  "parcel_allowed", "parcel_owner_control",
] as const;

// The owner's grant baseline for the manager powers (restaurants.manager_permissions).
// edit_menu/give_discounts/view_dashboard ON; money-risk + newer powers OFF.
// The owner's grant baseline for a NEW restaurant (restaurants.manager_permissions).
//
// DERIVED, not hand-typed (2026-08-01). The hand-typed list had drifted from what the Access
// screen displays — it wrote `false` for view_ratings, table_tags, take_orders, table_ops and
// void_bills while the screen showed all five ON, so every restaurant created here was born
// disagreeing with its own permissions screen, and a manager was refused things the admin could
// see switched on. This file's own comment already said the rule: display and truth must agree.
// So the defaults now come from the ONE place that decides what an unset permission means.
//
// Powers with no row on the screen any more (khata, banquet, parcel, platform, table_assign…)
// are seeded TRUE: their module toggle in Main / Extra features is the switch, and nothing can
// grant them individually, so seeding them off would strand a manager the moment an admin turns
// the module on.
// …EXCEPT the three payroll powers. lib/staffProfileShared.ts already decides what an unset one
// means, and it decided deliberately: fixing a phone number or handing over a cash advance reads
// as ON, but SEEING everyone's salary reads as OFF until it is handed over on purpose. Seeding
// them here would overrule that and put every manager inside the pay ledger the moment Payroll
// is switched on. Not seeded = that module's own rule still applies.
const OWNED_BY_PAYROLL = new Set(["see_staff_pay", "record_staff_payment", "edit_staff_profiles"]);

export const MP_DEFAULT: Record<string, boolean> = Object.fromEntries(
  [...new Set([...MANAGER_POWER_FLAGS, ...Object.keys(MANAGER_GRANT_DEFAULTS)])]
    .filter((flag) => !OWNED_BY_PAYROLL.has(flag))
    .map((flag) => [flag, managerGrantValue(flag, undefined)]),
);

// New-restaurant DEFAULT tablet caps (mirrors lib/settingsClone.ts). take_orders 'on'.
export const TABLET_CAP_DEFAULTS: Record<string, "off" | "on" | "pin"> = {
  tablet_discount: "off", tablet_mark_paid: "off", tablet_invoice: "off",
  tablet_banquet: "off", tablet_table_tags: "off", tablet_khata: "off",
  tablet_table_ops: "off", tablet_take_orders: "on", tablet_parcel: "off",
};

export const isTri = (v: unknown): v is "off" | "on" | "pin" =>
  v === "off" || v === "on" || v === "pin";
