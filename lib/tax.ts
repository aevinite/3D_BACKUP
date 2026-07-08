// Single source of truth for a restaurant's EFFECTIVE tax rate.
//
// A restaurant sets its tax as either a set of NAMED components (CGST/SGST/… — mig 117,
// each a percent) whose SUM is the total rate, OR, if none are configured, a single
// fallback `tax_rate` (a decimal like 0.05), and if that's blank too, 5%.
//
// This mirrors, byte-for-byte, taxModel() in public/panels/editor/app.js and the SQL
// lfh_effective_tax_rate() (migration 119). They MUST agree — the printed bill, the
// manager pay screen, the guest cart, the Z-report, the dashboard and the server-stored
// order totals all derive their tax from this one rule, so a bill can never show four
// different totals (the "cosmetic multi-tax" bug, 2026-07-04).

type TaxSettings = { tax_components?: unknown; tax_rate?: unknown } | null | undefined;

/** Named components with a real label + a positive rate — the only ones that count. */
function components(raw: TaxSettings): { label: string; rate: number }[] {
  const list = raw && Array.isArray((raw as { tax_components?: unknown }).tax_components)
    ? ((raw as { tax_components: unknown[] }).tax_components)
    : [];
  return list
    .map((c) => ({ label: String((c as { label?: unknown })?.label ?? "").trim(), rate: Number((c as { rate?: unknown })?.rate) || 0 }))
    .filter((c) => c.label && c.rate > 0);
}

/** Named tax components (CGST/SGST/…), each rate a PERCENT — for display + splitting a tax
 *  total into its parts. Empty when the restaurant uses a single flat rate instead. */
export function taxComponents(raw: TaxSettings): { label: string; rate: number }[] { return components(raw); }

/** The effective tax rate as a DECIMAL (e.g. 0.05 for 5%). */
export function effectiveTaxRate(raw: TaxSettings): number {
  const comps = components(raw);
  if (comps.length) return comps.reduce((a, c) => a + c.rate, 0) / 100;
  const rate = Number((raw as { tax_rate?: unknown })?.tax_rate) || 0.05;
  return rate;
}

/** The effective tax rate as a PERCENT for display (e.g. 5 or 12.5). */
export function effectiveTaxPct(raw: TaxSettings): number {
  return Math.round(effectiveTaxRate(raw) * 10000) / 100;
}
