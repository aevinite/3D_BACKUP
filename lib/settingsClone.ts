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
  return base;
}
