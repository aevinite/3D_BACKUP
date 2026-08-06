// ONE way to shorten a rupee figure, for the whole owner console.
//
// There used to be two, and they disagreed on the same amount: the chart kit's `compact()`
// stopped at lakhs, so ₹1,20,00,000 drew as "₹120.0L" on an axis, while the dashboard's
// restaurant dropdown had its own `money()` that went one step further and wrote "₹1.2Cr" for
// the identical number, right beside it (T5 sweep, 2026-08-06).
//
// The owner picked the crore form — "do 1.2 Cr, it will look great" — so that is what everything
// uses now. Full-precision money is still `inr()` in components/admin/shared (en-IN); this is
// only for places where a full figure will not fit: chart axes, bar labels, list chips.
//
// Rules, chosen so the short form is never misleading:
//   · one decimal, and a trailing ".0" is dropped   → ₹1.2Cr, ₹5L (not ₹5.0L)
//   · thresholds are the Indian ones                → 1 Cr = 1,00,00,000 · 1 L = 1,00,000
//   · below ₹1,000 it is written out in full        → ₹850, never ₹0.9k
//   · negatives keep their sign                     → −₹1.2Cr (a refund-heavy bucket)

const CRORE = 10_000_000;
const LAKH = 100_000;
const THOUSAND = 1_000;

/** 1.2 / 5 / 0.9 — one decimal, trailing ".0" dropped. */
const oneDp = (n: number) => n.toFixed(1).replace(/\.0$/, "");

/**
 * Short rupee form for tight spaces: ₹1.2Cr · ₹38.8L · ₹4.5k · ₹850.
 * `sign: false` (the default) still shows a minus for negative values — pass nothing.
 */
export function compactINR(value: number): string {
  const v = Number(value) || 0;
  const neg = v < 0;
  const a = Math.abs(v);
  const body =
    a >= CRORE ? `${oneDp(a / CRORE)}Cr`
    : a >= LAKH ? `${oneDp(a / LAKH)}L`
    : a >= THOUSAND ? `${oneDp(a / THOUSAND)}k`
    : Math.round(a).toString();
  return `${neg ? "−" : ""}₹${body}`;
}

/**
 * Round "nice" tick values for a chart axis, INSIDE the given domain.
 *
 * The owner's rule is that a chart must FILL its box, so the y-domain ends at the exact data
 * max — and recharts then labels that max, printing it right on top of the last round tick
 * (measured: ₹7.1L sitting directly above ₹6L while every other gap was a full ₹2L). Handing
 * recharts an explicit set of round ticks keeps the data touching the top AND stops the axis
 * labelling the ragged number. Returns an empty array when nothing sensible fits, so the caller
 * can simply omit `ticks` and get the old behaviour.
 */
export function roundTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const span = max - min;
  const rough = span / Math.max(2, target - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  // 1 / 2 / 2.5 / 5 / 10 × the magnitude — the steps that read as round to a human
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= target) ?? 10 * mag;
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step) {
    // guard against float drift turning 400000.00000000006 into a silly label
    out.push(Math.round(t * 1e6) / 1e6);
  }
  // A single tick is not an axis; two or more is.
  return out.length >= 2 ? out : [];
}
