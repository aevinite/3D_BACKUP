// lib/accessConfig.ts — the CANONICAL admin-editable access lists, shared by the
// per-restaurant Access editor (retired 2026-07-31 — Access is lib/accessTree.ts now) AND the create-
// restaurant flow (app/api/admin/restaurants) so the two can never drift.
//
// These mirror docs/ACCESS-MODEL.md. Keep the DEFAULTS matching the migrations —
// enforcement (managerCan) reads an ABSENT manager-permission key as false, so display
// and truth must agree.

import { MANAGER_GRANT_DEFAULTS, managerGrantValue } from "@/lib/accessTree";
import { MANAGER_POWER_FLAGS } from "@/lib/accessModel";

// ── WHAT LEFT THIS FILE ON 2026-08-06 (sweep T6) ────────────────────────────────────────────
// `TABLET_CAPS`, `FEATURE_SWITCHES` and `TABLET_CAP_DEFAULTS` all went with the create form's
// access block. The last of the three was the dangerous one: it still claimed the waiter's FLOOR
// capabilities default 'off' — the pre-migration-295 answer — while lib/settingsClone.ts (which
// its own comment said it mirrored) writes them 'on'. It had no caller, which was the only
// reason nothing was broken; it was a trap for the next person who reached for "the
// new-restaurant tablet defaults". The one true answer now lives in exactly two places:
// lib/accessTree.ts (what the screen shows) and lib/settingsClone.ts (what a new row gets).
//
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
