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

type TaxSettings = { tax_components?: unknown; tax_rate?: unknown; tax_exempt?: unknown } | null | undefined;

/** Does this restaurant charge NO tax at all?
 *
 * There was no way to say this, and it is not a rare case: a composition-scheme restaurant
 * (turnover ≤ ₹1.5 cr, flat 5% paid by the restaurant) may NOT pass GST to the diner and must
 * print no tax line — docs/COMPLIANCE-GUARDRAILS.md. Deleting every row under "Tax lines on the
 * print" is the only thing the admin screen offers, and that left `tax_components: []` with a
 * null `tax_rate`, which every one of the three implementations reads as "not configured" and
 * substitutes 5%. So the card said "Total tax: 0%" and the printer charged 5% anyway.
 *
 * Fixing the 0-means-0 case alone would have been wrong: a restaurant sitting on `tax_rate = 0`
 * today is being charged 5% and would silently drop to zero the moment this shipped. So it is an
 * EXPLICIT opt-in flag instead — nothing changes for anyone until an admin ticks it. */
export function taxExempt(raw: TaxSettings): boolean {
  return (raw as { tax_exempt?: unknown } | null | undefined)?.tax_exempt === true;
}

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
export function taxComponents(raw: TaxSettings): { label: string; rate: number }[] {
  return taxExempt(raw) ? [] : components(raw);   // no tax ⇒ no tax lines on the paper
}

/** The effective tax rate as a DECIMAL (e.g. 0.05 for 5%). */
export function effectiveTaxRate(raw: TaxSettings): number {
  if (taxExempt(raw)) return 0;   // "we don't charge tax" — the one way to mean it (see taxExempt)
  const comps = components(raw);
  if (comps.length) return comps.reduce((a, c) => a + c.rate, 0) / 100;
  const rate = Number((raw as { tax_rate?: unknown })?.tax_rate) || 0.05;
  return rate;
}

/** The effective tax rate as a PERCENT for display (e.g. 5 or 12.5). */
export function effectiveTaxPct(raw: TaxSettings): number {
  return Math.round(effectiveTaxRate(raw) * 10000) / 100;
}
