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

/** The 2–3 tier's palette. The owner asked for the theme's green family here rather than the
 *  vibrant identity colours: "only brown doesn't make sense" (round-2, 2026-07-27). */
export const GREEN_SHADES = ["#34d399", "#0f766e", "#a3e635"];

/**
 * ── ONE COLOUR PER RESTAURANT, ON EVERY SURFACE, AT EVERY TIER (owner, 2026-10-04) ──────────
 * He sent a screenshot: in "My restaurants" at the bottom left Aevidine was ORANGE, and three
 * inches away in the chart legend and the league table it was light green. Exactly the fault
 * the header of this file says it exists to prevent — reappearing at a tier the fix never
 * covered.
 *
 * What had happened: with 2–3 restaurants the dashboard swaps to GREEN_SHADES (the owner's own
 * instruction), and that palette lived inside app/owner/page.tsx, so the SHELL — which cannot
 * see it — went on calling portfolioColor() and drew from the vibrant list. Worse, the two
 * green surfaces keyed differently from each other: the chart by POSITION in
 * `restaurantRevenue`, the table by REVENUE RANK. Re-sort the table and its dots change colour.
 *
 * So the tier decision and the key both move here, and every surface calls the same function.
 * The assignment is by SORTED ID — never by the caller's order — which is what makes it hold
 * across a sort, a reload, and the shell/page boundary.
 */
export function restaurantPalette(ids: readonly string[]): Map<string, string> {
  const uniq = [...new Set(ids)].sort();
  const out = new Map<string, string>();
  // 2-3: the theme's greens. 4+: a distinct hue each, because most restaurants default to the
  // same gold accent and several bars came out "the identical washed-out yellow".
  if (uniq.length <= 3) uniq.forEach((id, i) => out.set(id, GREEN_SHADES[i % GREEN_SHADES.length]));
  else uniq.forEach((id) => out.set(id, portfolioColor(id)));
  return out;
}

/** One restaurant's colour, given the estate it belongs to. */
export function restaurantColor(id: string, ids: readonly string[]): string {
  return restaurantPalette(ids).get(id) || portfolioColor(id);
}

/**
 * The colour for a restaurant when the estate is not to hand. Prefer `restaurantColor(id, ids)`:
 * this one cannot know the tier, so at 2-3 restaurants it answers from the wrong palette.
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
