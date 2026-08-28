// When a NEW restaurant needs a `settings` row, the admin routes clone restaurant
// #1's row as a template (the cheapest way to satisfy every NOT-NULL column) and then
// override a few fields. Problem: a raw clone also copies #1's TENANT-SPECIFIC identity,
// tax and location — so the new restaurant silently inherited #1's printed-invoice name/
// address/phone/GSTIN and #1's geofence coordinates until someone re-entered them by hand
// (owner's recurring "#1 leaks onto restaurant #2" class; QA 2026-07-03).
//
// cleanClonedSettings() strips exactly those columns so a cloned template carries only the
// generic, safe defaults. Identity/GST fields → null (they read with sensible fallbacks,
// e.g. tax_rate → 5%); geo → null (location-gating stays OFF until the owner sets it, so a
// new restaurant's guests are never geofenced to #1's address); table_count → a modest 10.
// Callers still override id / restaurant_id / the specific flag they're toggling.

import { MODULE_DEFS, TABLET_PERM_KEYS } from "@/lib/accessModel";
// The channel defaults are DERIVED from the Access screen's own rows, so "what the ⓘ says is the
// default" and "what a new restaurant actually gets" are one sentence (see below).
import { CHANNEL_DEFAULTS, MODULE_ALLOWED_DEFAULTS } from "@/lib/accessTree";

// Columns that must NEVER be inherited from the template restaurant. (Only REAL, nullable
// settings columns — verified against the live schema.)
// NULLABLE tenant-specific columns — cleared to null so the new restaurant starts blank
// (they all read with a sensible fallback, e.g. tax_rate → 5%, name → menu wordmark).
const NULL_COLUMNS = [
  "restaurant_name", "restaurant_address", "restaurant_phone", // printed on the tax invoice
  "gstin", "invoice_prefix",                                   // invoice identity
  "bill_footer",                                               // printed sign-off (mig 124)
  "tax_label",                                                 // on-screen tax word (mig 125)
  "tax_rate",                                                  // each restaurant sets its own
  "geo_lat", "geo_lng",                                        // location gate center → else #1's café coords leak in
] as const;

// Default guest "leave a review" link for a BRAND-NEW restaurant. A raw clone copied #1's
// google_review_url, so a happy guest at a new restaurant was nudged to review LITTLE FRENCH
// HOUSE on Google (the "#1 leaks onto restaurant #2" class — QA 2026-07-24). Instead of just
// blanking it, new restaurants default to our own Instagram (@aevinite) until the owner sets
// their own Google review page in the admin. The guest nudge (ItemClient) detects an
// instagram.com link and shows Instagram wording/icon, so the label matches the destination.
export const DEFAULT_REVIEW_URL = "https://instagram.com/aevinite";

export function cleanClonedSettings(
  templateRow: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const base: Record<string, unknown> = templateRow ? { ...templateRow } : { bubbles_enabled: true };
  delete base.updated_at;
  // Clear the nullable tenant-specific columns so the new restaurant doesn't impersonate #1.
  for (const col of NULL_COLUMNS) base[col] = null;
  // geo_radius_m is NOT NULL, so it can't be nulled — reset it to the app default (250m).
  // Harmless while geo_lat/geo_lng are null (no center point → location gating stays OFF).
  base.geo_radius_m = 250;
  // A new restaurant shouldn't inherit #1's floor size.
  base.table_count = 10;
  // …nor #1's per-table NAMES (e.g. "Patio", "Banquet Hall") — those are #1's identity and
  // would otherwise show on the new tenant's tiles/bills/floor map for tables 1–10 until
  // renamed by hand (the "#1 leaks onto restaurant #2" class). Start with none. (mig 131.)
  base.table_names = {};
  // NOT-NULL tenant-specific columns can't be nulled — reset them to their safe "blank"
  // default instead, so a new restaurant does NOT inherit #1's current values.
  // ── WHAT A NEW RESTAURANT'S WAITERS CAN DO (rewritten 2026-08-04) ──────────────────────────
  // MONEY: off. The two the owner named stay off until an admin hands them over on
  // Access → Waiter → Permission for waiter — that is his whole rule ("they can only mark as
  // paid, only if permission is given"). Never copied from #1, which has them on.
  base.tablet_discount = "off";
  base.tablet_mark_paid = "off";
  base.tablet_invoice = "off";   // never grantable at all — see WAITER_NEVER in lib/accessTree.ts
  // FLOOR: on. These are how the tablet does its job, and the model always SAID they were
  // permanently on for the panel that owns them — but writing 'off' here made that a lie for a
  // waiter, because tabletPerm reads a stored 'off' as a refusal and no screen had a row to undo
  // it. Eight of nine restaurants shipped with their waiters unable to move a table or use khata.
  // Each now has its own row on Access → Waiter (default ON), and a new restaurant is born
  // matching that default. A module that is off still removes its own (khata/banquet/parcel).
  base.tablet_take_orders = "on";
  base.tablet_table_ops = "on";
  base.tablet_table_tags = "on";
  base.tablet_khata = "on";
  base.tablet_parcel = "on";
  base.tablet_banquet = "on";
  // Admin ENTITLEMENTS must default OFF for a new restaurant (NEW-FEATURE-CHECKLIST: "new
  // modules default OFF"). A raw clone copied #1's values, so if the flagship had banquet
  // billing or auto-print-KOT switched on, a brand-new restaurant was born with them enabled
  // (e.g. the manager panel showed the 🎪 Banquet tab) with no admin grant. (migs 130/107.)
  // banquet_allowed is seeded by the derived loop below, from its own row on the Access screen.
  // Banquet's full ladder (mig 167): a new restaurant starts with the admin holding
  // the switch (no transfer) and the owner toggle at its neutral ON.
  base.banquet_owner_control = false;
  base.banquet_enabled = true;
  base.auto_print_kot_allowed = false;
  // ── EVERY MODULE'S ADMIN RUNG COMES FROM THE SCREEN, NOT FROM #1 (2026-08-28) ───────────────
  //
  // TWO FAULTS, ONE CAUSE. `base` is a COPY of restaurant #1's row, so a module column that is not
  // explicitly reset here is INHERITED from the flagship — the "#1 leaks onto restaurant #2" class
  // this file's own header was written about. Only banquet and auto-print were ever reset, and:
  //
  //   · khata_allowed and payroll_allowed were never reset, and French House has BOTH ON. So every
  //     restaurant created was born with Pay later and Payroll switched on while the Access screen
  //     said they start off. Payroll is the one that matters: it unlocks the staff pay ledger,
  //     salary visibility and the pay cards on every person's page. Measured on the backup stack
  //     2026-08-28 — the template row really does have both true.
  //   · table_ops_allowed and table_tags_allowed WERE reset, to false, so every new restaurant was
  //     born unable to move a party between tables, join two tables or mark a table VIP. Seven are
  //     still sitting like that. The owner's word, 2026-08-28: they start ON. They are not premium
  //     add-ons — lib/accessTree says of this exact pair that "moving/merging/splitting … is how the
  //     floor RUNS — a restaurant that switched them off could not trade", which is the same reason
  //     take_orders has always been seeded on.
  //
  // So the list is DERIVED rather than hand-typed, exactly like CHANNEL_DEFAULTS above: each
  // module's admin rung is seeded from the `def` on its own row in lib/accessTree.ts, which is the
  // value the ⓘ promises. A module added to that screen tomorrow is seeded correctly with no line
  // written here, and a module that is never reset cannot exist. verify:access check 55 refuses a
  // module whose seed and screen disagree. Owner transfer stays OFF and _enabled stays true —
  // only the admin rung is decided here.
  for (const [col, on] of Object.entries(MODULE_ALLOWED_DEFAULTS)) base[col] = on;
  base.table_tags_owner_control = false;
  base.table_tags_enabled = true;
  base.table_ops_owner_control = false;
  base.table_ops_enabled = true;
  // Order-taking module (mig 179): unlike the modules above, _allowed starts ON for a NEW
  // restaurant too — taking orders is the app's core function, not a premium add-on. The
  // admin can still switch it off per restaurant. (Its tablet cap defaults 'on' above.)
  // take_orders_allowed is seeded by the derived loop above, from its own row (which says ON).
  base.take_orders_owner_control = false;
  base.take_orders_enabled = true;
  // PARCEL — the counter parcel (migs 197-198, its own module again since 259). ON for a new
  // restaurant (owner 2026-07-26 — a common counter task, and the admin can switch it off per
  // restaurant), owner-transfer off, and the TABLET cap OFF (waiters don't get it by default).
  // PLATFORMS (takeaway_*) is the DIFFERENT feature below — Zomato/Swiggy/own website. It is
  // deliberately not defaulted here in the same breath: see the box at the top of
  // lib/tableTags.ts before touching either.
  // Parcel + Platforms are ONE PERMANENT feature (owner, 2026-08-03, mig 263) — a new
  // restaurant is born with both on because there is no switch to turn either off. Which
  // delivery CHANNELS are live is the real per-restaurant choice and lives in
  // settings.platform_channels, not here.
  base.takeaway_allowed = true;
  base.takeaway_owner_control = false;
  base.takeaway_enabled = true;
  base.parcel_allowed = true;      // permanent (mig 263) — the counter always sells parcels
  base.parcel_owner_control = false;
  base.parcel_enabled = true;
  // Platform board module (mig 209): unlike existing restaurants (backfilled ON), a NEW
  // restaurant starts OFF — it's opt-in (admin turns it on once the restaurant is on the
  // delivery apps). Channels start empty (none live). owner-transfer off, owner toggle neutral-ON.
  base.platform_allowed = false;
  base.platform_owner_control = false;
  base.platform_enabled = true;
  // ── THE CHANNELS COME FROM THE ACCESS SCREEN'S OWN DEFAULTS (sweep T6, 2026-08-10) ────────────
  // This was `{}`, and every reader treats an absent channel as OFF (lib/accessState, the editor's
  // simulate path, lib/aggregators) — so a new restaurant was born with "Own website" OFF while
  // that row's ⓘ printed "On by default." Worse, `scripts/set-access-defaults.mjs` writes
  // `node.def`, so "reset this restaurant to factory defaults" would have switched an inbound
  // order channel ON — a screen and a repair tool disagreeing about the same fact, which is the
  // dead-switch family this model exists to remove. Derived from CHANNEL_DEFAULTS (own website ON,
  // Zomato + Swiggy OFF — each needs that company's account), so a channel added to the tree is
  // seeded correctly on the day it is added, with no second list to keep in step.
  //
  // Behaviour-safe: the website channel has NO inbound path at all today — the only webhook is
  // /api/aggregators/webhook/[source], which accepts zomato|swiggy only, is dormant behind the
  // backend-only `aggregators` flag, and requires a shared secret. This makes the SCREEN honest;
  // it does not open a door.
  base.platform_channels = { ...CHANNEL_DEFAULTS };

  // ── NOT A PROBLEM — REJECTED (owner, 2026-08-11): a new restaurant DOES inherit restaurant #1's
  // guest-menu settings, and that is deliberate ─────────────────────────────────────────────────
  // Sweep T6 reported it as a fault (2026-08-10): `menu_enabled`, `sessions_enabled`,
  // `bubbles_enabled`, `menu_default_layout`, `menu_default_mode`, `menu_languages`,
  // `menu_currencies` and the three `qop_*` switches have NO explicit default in this file, so a
  // new restaurant is cloned with whatever the template restaurant has — today three menu
  // languages and dining sessions ON, neither of which is the factory default the Access screen
  // states. The owner's answer was that this is wanted: a new restaurant starting as a copy of the
  // flagship's guest-menu setup is a useful starting point, and the admin changes what differs on
  // the Access screen afterwards. So do NOT add explicit defaults for these columns, and do not
  // "fix" the drift they show against `node.def` — see docs/REJECTED-IDEAS.md R8. The tax, tablet,
  // module and channel columns above are a different matter and stay explicit: those are money,
  // permissions and third-party accounts, not a look-and-feel starting point.
  // The auto-print-KOT capability itself (not just its entitlement) must also start OFF, so a
  // later entitlement grant doesn't immediately auto-print KOTs without the owner choosing to. (mig 107.)
  base.auto_print_kot = false;
  // GST and prices (mig 270) — a new restaurant must NOT inherit another's tax posture. Copying
  // the template's price_tax_mode is the "#1 leaks onto restaurant #2" class in its most
  // expensive form: a brand-new restaurant born on 'composition' would print no tax line at all,
  // and one born on 'incl' would quietly declare GST out of prices its owner typed as net. So all
  // three start at the migration's own defaults — GST added on top, per-dish modes off, no GST
  // declared on an MRP line — which is exactly today's behaviour for everyone.
  //
  base.price_tax_mode = "excl";
  base.item_tax_modes_allowed = false;
  base.mrp_tax_treatment = "none";
  // The RATE itself, in both the forms it can take. `tax_rate` is nulled above ("each
  // restaurant sets its own") — and tax_components is the SAME fact written differently, so
  // inheriting it was simply inconsistent: effectiveTaxRate() PREFERS components over
  // tax_rate, which meant a restaurant cloned from an 18% template silently charged 18% while
  // its own tax_rate read blank. That is the "#1 leaks onto restaurant #2" class aimed
  // straight at the money.
  // Blanking both lands the new restaurant on the app's documented 5% fallback — exactly what
  // a clone got before named components existed, and a number its owner can then set.
  base.tax_components = [];
  base.banquet_tax_components = [];
  // service_mode = maintenance switch (true = closed). A new restaurant must open LIVE, never
  // inherit the flagship's maintenance state — else creating a restaurant while #1 is in
  // maintenance would silently ship the new one offline. (mig 004.)
  base.service_mode = false;
  // Phone OTP before ordering: OFF. Migration 018 shelved the feature and turned it off on
  // restaurant #1, but left the COLUMN default at true — and `lfh_place_order` refuses every
  // guest order with 'otp_required' while it is on. Today a clone inherits #1's `false`, so this
  // line changes nothing; it exists so the safety is a written decision instead of a property of
  // whatever the flagship happens to be set to. (Mig 304 fixes the column default to match.)
  base.require_otp = false;
  // Guest feature flags: start empty so the new restaurant uses the code defaults
  // (lib/features.ts), not #1's current on/off choices.
  base.features = {};
  // Review link: never inherit #1's Google page — default to our own Instagram (see above).
  // The admin's google-review route later overrides this with the restaurant's own link.
  base.google_review_url = DEFAULT_REVIEW_URL;
  // Google-review MODE (mig 187): a new restaurant starts with the Google invite OFF — guests
  // see only the normal in-menu reviews until the admin picks a Google mode. (owner 2026-07-24)
  base.google_review_mode = "off";
  // Drift guard (2026-07-26): every ladder column the access model knows must have an
  // EXPLICIT default above — a missing one means a new restaurant silently inherits the
  // template restaurant's switch (the "#1 leaks onto restaurant #2" class). Warn loudly
  // in the server log; deliberately no throw (creating a restaurant must never fail
  // over a missing default — the warn is the tripwire).
  for (const col of [...MODULE_DEFS.flatMap((m) => [m.allowed, m.control, m.enabled]), ...TABLET_PERM_KEYS]) {
    if (!(col in base)) console.warn(`[settingsClone] no explicit default for ladder column "${col}" — new restaurants will inherit the template's value; add one above.`);
  }
  return base;
}
