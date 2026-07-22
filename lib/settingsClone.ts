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
  // Waiter-tablet billing capabilities: NEW restaurants must start with these OFF, never
  // copy whatever #1 has switched on (audit 2026-07-06 — #1 had mark-paid + invoice ON, so
  // every new tenant's waiters could settle bills / issue invoices with no admin grant).
  base.tablet_discount = "off";
  base.tablet_mark_paid = "off";
  base.tablet_invoice = "off";
  // The banquet tablet capability is a tri-state cap like the three above — same rule: a new
  // restaurant starts OFF and never inherits #1's, so a later `banquet_allowed` grant doesn't
  // arrive with waiters already able to create banquet bills. (mig 130.)
  base.tablet_banquet = "off";
  // Admin ENTITLEMENTS must default OFF for a new restaurant (NEW-FEATURE-CHECKLIST: "new
  // modules default OFF"). A raw clone copied #1's values, so if the flagship had banquet
  // billing or auto-print-KOT switched on, a brand-new restaurant was born with them enabled
  // (e.g. the manager panel showed the 🎪 Banquet tab) with no admin grant. (migs 130/107.)
  base.banquet_allowed = false;
  // Banquet's full ladder (mig 167): a new restaurant starts with the admin holding
  // the switch (no transfer) and the owner toggle at its neutral ON.
  base.banquet_owner_control = false;
  base.banquet_enabled = true;
  base.auto_print_kot_allowed = false;
  // Table types (VIP/Family/Guest) + khata (mig 166): the whole ladder starts at the
  // admin's feet for a new restaurant — feature off, no owner transfer, tablet rungs off.
  base.table_tags_allowed = false;
  base.table_tags_owner_control = false;
  base.table_tags_enabled = true;
  base.tablet_table_tags = "off";
  base.tablet_khata = "off";
  // The auto-print-KOT capability itself (not just its entitlement) must also start OFF, so a
  // later entitlement grant doesn't immediately auto-print KOTs without the owner choosing to. (mig 107.)
  base.auto_print_kot = false;
  // service_mode = maintenance switch (true = closed). A new restaurant must open LIVE, never
  // inherit the flagship's maintenance state — else creating a restaurant while #1 is in
  // maintenance would silently ship the new one offline. (mig 004.)
  base.service_mode = false;
  // Guest feature flags: start empty so the new restaurant uses the code defaults
  // (lib/features.ts), not #1's current on/off choices.
  base.features = {};
  return base;
}
