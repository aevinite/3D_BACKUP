// ONE identity colour per restaurant, for every surface of the owner console.
//
// The owner asked for distinct colours at the 4+ tier because most restaurants default to the
// same gold accent, so several bars and lines were "the identical washed-out yellow"
// (2026-07-27). That palette then lived inside app/owner/page.tsx and was keyed by the
// restaurant's POSITION in the list — which drifts the moment a chart sorts a copy — while the
// SHELL's sidebar and top-strip switcher kept using each restaurant's own brand accent. So one
// restaurant could be blue in the chart, blue in the table, and orange in the sidebar three
// inches to the left (T5 sweep, 2026-08-06/07).
//
// Keyed by ID: stable across sorts, across reloads, across pages, and across the shell/page
// boundary — which is the whole point of putting it here rather than in either component.

/** Vibrant, clearly-different hues. Emerald first: it is the console's own brand green. */
export const PORTFOLIO_COLORS = [
  "#34d399", // emerald
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#ef4444", // red
  "#eab308", // yellow
  "#f97316", // orange
  "#06b6d4", // cyan
];

/**
 * The colour for a restaurant. Pass its **id** — that is what makes it stable.
 *
 * A number is still accepted for the handful of call sites that legitimately colour by position
 * (the 2–3 restaurant green-shades tier picks its own palette and never calls this).
 */
export function portfolioColor(idOrIndex: string | number): string {
  if (typeof idOrIndex === "number") return PORTFOLIO_COLORS[idOrIndex % PORTFOLIO_COLORS.length];
  let h = 0;
  for (let i = 0; i < idOrIndex.length; i++) h = (h * 31 + idOrIndex.charCodeAt(i)) >>> 0;
  return PORTFOLIO_COLORS[h % PORTFOLIO_COLORS.length];
}
