// Floor layout — the ONE place the "tables per row" rules live (mig 226).
//
// The admin sets how many table tiles sit on a row in the manager's floor view.
// Everything that touches that number (the admin form, the admin save route, the
// live preview, and the manager panel CSS) reads these constants so they can
// never drift apart.
//
// Why a range at all: below 2 a floor map stops being a map, and past 12 a tile
// gets narrower than its own text in the manager's floor area (measured ~1150px
// with the side rail open, ~1550px collapsed — 12 tiles + gaps lands right on the
// 104px readable floor). The number is a TARGET, not a hard rule: the panel CSS
// asks for this many per row but never squeezes a tile below TILE_MIN_PX, so a
// phone or a narrow window shows fewer per row instead of a row of slivers.
export const FLOOR_PER_ROW_MIN = 2;
export const FLOOR_PER_ROW_MAX = 12;
export const FLOOR_PER_ROW_DEFAULT = 6; // reproduces the old "M" density most closely

// The narrowest a table tile may ever get before the grid drops a column instead.
// Mirrored in public/panels/editor/style.css (--ftile-floor); keep them in step.
export const TILE_MIN_PX = 116;

/** Clamp anything (form input, DB value, URL param) into the allowed range. */
export function clampPerRow(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return FLOOR_PER_ROW_DEFAULT;
  return Math.min(Math.max(n, FLOOR_PER_ROW_MIN), FLOOR_PER_ROW_MAX);
}
