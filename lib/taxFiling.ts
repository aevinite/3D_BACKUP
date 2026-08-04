// ONE source of truth for how a tax total is split for FILING.
//
// Three copies of `splitTax` used to exist (the reports route, the reports page, the section
// exporter) and a fourth rule lived inside the filing table, which is how the Tax/GST report
// ended up printing TWO different CGST figures for the same period: "The split" panel rounded
// the period total ONCE (₹207,887.50) while the filing table rounded EVERY DAY to a whole rupee
// and summed 30 of them (₹207,888.50) — ₹2 apart on the total tax, on a table captioned "ready
// to copy into a return" (owner-panel sweep, 2026-08-04). `docs/COMPLIANCE-GUARDRAILS.md`
// requires the numbers to reconcile to the rupee, so the fix is not a nicer rounding rule —
// it is having only one.
//
// The two primitives below are all any caller needs:
//   splitTax()     — divide ONE amount across tax lines by rate, to the paise, last line
//                    absorbing the remainder so the parts ALWAYS add back exactly.
//   allocateWhole() — divide ONE whole-rupee amount across N rows in proportion to weights,
//                    by largest remainder, so the rows ALWAYS add back exactly.
//
// Composed (allocate the period's rounded tax across periods, then split each period across
// tax lines) every number on the report reconciles in BOTH directions: a row's lines sum to
// that row's tax, a column sums to the period's line total, and the grand total equals the
// KPI tile.

/** Round to paise. */
const p2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

/**
 * Split `target` across `rates` proportionally, to the paise. The LAST line absorbs the
 * rounding remainder, so `sum(result) === p2(target)` exactly — a GST return where
 * CGST + SGST ≠ total tax is wrong.
 */
export function splitTax(rates: number[], target: number): number[] {
  if (!rates.length) return [];
  const sum = rates.reduce((a, r) => a + (Number(r) || 0), 0) || 1;
  let running = 0;
  return rates.map((r, i) => {
    const amt = i === rates.length - 1 ? p2(target - running) : p2(target * ((Number(r) || 0) / sum));
    running = p2(running + amt);
    return amt;
  });
}

/**
 * Spread a WHOLE-RUPEE `total` across rows in proportion to `weights`, by largest remainder.
 * Every returned value is an integer and they sum to EXACTLY `Math.round(total)` — which is
 * what lets a per-period filing table add up to the headline figure instead of drifting a
 * rupee per row. With all-zero weights the total lands on the first row rather than vanishing.
 */
export function allocateWhole(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (!n) return [];
  const target = Math.round(Number(total) || 0);
  const w = weights.map((x) => Math.max(0, Number(x) || 0));
  const wSum = w.reduce((a, x) => a + x, 0);
  if (wSum <= 0) {
    const out = new Array(n).fill(0);
    out[0] = target;
    return out;
  }
  const exact = w.map((x) => (x / wSum) * target);
  const base = exact.map((x) => Math.floor(x));
  let left = target - base.reduce((a, x) => a + x, 0);
  // hand the leftover rupees to the biggest fractional parts first (largest remainder)
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) base[order[k].i] += 1;
  // a negative leftover (target below the floors) can only happen on a negative total
  for (let k = order.length - 1; left < 0 && k >= 0; k--, left++) base[order[k].i] -= 1;
  return base;
}

/**
 * The TAXABLE value of one money row — the figure a GST return is filed on, not total sales.
 * Recovered from the tax itself (`tax = taxable × rate`), which stays right when a period
 * mixes taxed and MRP/exempt lines, and capped at net sales so a rounding wobble can never
 * make it exceed what was actually sold. With no rate configured (composition scheme) there
 * is no taxable supply at all — net sales is returned so the caller can label it honestly.
 * Shared so the screen, the export and the printed sheet cannot each derive it differently.
 */
export function taxableValue(row: { tax: number; subtotal: number; discount: number }, pct: number | null): number {
  const net = (Number(row.subtotal) || 0) - (Number(row.discount) || 0);
  if (!pct) return net;
  return Math.min((Number(row.tax) || 0) / (pct / 100), net);
}

export type FilingLine = { label: string; rate: number };
export type FilingRow<T> = { row: T; tax: number; parts: number[] };

/**
 * Build the per-period filing rows AND their column totals from one set of money rows.
 * `taxOf(row)` reads that period's raw tax. The result reconciles in both directions:
 *   · every row's `parts` sum to that row's whole-rupee `tax`
 *   · `columnTotals[j]` is the sum of column j, and all columns sum to `total`
 *   · `total === Math.round(sum of raw taxes)` — the same figure the KPI tile shows
 */
export function buildFiling<T>(rows: T[], lines: FilingLine[], taxOf: (row: T) => number): {
  rows: FilingRow<T>[]; columnTotals: number[]; total: number;
} {
  const raw = rows.map((r) => Number(taxOf(r)) || 0);
  const total = Math.round(raw.reduce((a, x) => a + x, 0));
  const perRow = allocateWhole(total, raw);
  const out = rows.map((row, i) => ({ row, tax: perRow[i], parts: splitTax(lines.map((l) => l.rate), perRow[i]) }));
  const columnTotals = lines.map((_, j) => p2(out.reduce((a, r) => a + (r.parts[j] ?? 0), 0)));
  return { rows: out, columnTotals, total };
}
