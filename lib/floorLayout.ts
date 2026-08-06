// Floor layout — the ONE place the "tables per row" rules live (mig 226).
//
// The admin sets how many table tiles sit on a row in the manager's floor view. Everything that
// touches that number reads these constants so they can never drift apart: the admin form
// (components/admin/RestaurantSettings.tsx), the admin save route
// (app/api/admin/restaurants/settings/route.ts) and the manager panel's own settings write
// (app/api/editor/[...path]/route.ts) all clamp through clampPerRow below.
//
// THE OWNER'S NUMBER WINS, AND IT IS NOT A TARGET (owner, 2026-07-31: "I will tell you how much
// tables I want in a particular row — you have to make it dynamic, such that even if you have to
// make it very small, you will make it very small"; and 2026-08-01: "I want how much table can I
// put in a particular one row … adjust according to screen size and all that shit doesn't count
// here"). The grid draws EXACTLY this many columns at every width:
// `grid-template-columns: repeat(var(--per-row), minmax(0, 1fr))`.
//
// ⚠️ WHAT IT DOES **NOT** DO — this box said the opposite until 2026-08-06 and the wrong version
// was quoted in two other files (T3 sweep). It does NOT hand back columns on a narrow screen.
// There is no auto-fill and no tappability floor deciding the column count. On a phone the floor
// keeps all N columns and **scrolls sideways** instead (the `@media (max-width: 1040px)` block in
// public/panels/editor/style.css pins each tile to a measured 72px minimum and puts the x-scroll on
// the GRID, never an ancestor, so the floor header stays still while only the tables move).
// Measured on a 360px phone at 12 per row: 12 columns, 72px tiles, 930px of grid inside a 332px
// window. What shrinking DOES cost is detail, shed in priority order by container queries in that
// stylesheet: the decorative ＋, then the sub-line, then the button labels, then the whole action
// row — the table number and its state COLOUR always survive.
//
// (There is no TILE_MIN_PX here any more. It claimed to be that give-a-column-back limit, was
// imported by nothing, and pointed at a CSS variable `--ftile-floor` that has never existed. The
// real minimum is the 72px in the stylesheet's 1040px block, measured against the point where the
// action row collapses to 0×0 — one number, in the file that enforces it.)
//
// THE ALLOWED CHOICES — and there is no typing anywhere. The owner picked "2 up to 12 only" on
// 2026-08-02 ("don't keep a number where I can add anything"), so the ONE screen that sets this
// renders a DROP-DOWN of exactly these values: the admin's Floor layout card. The MANAGER panel
// only ever READS the number — its own card was removed on 2026-08-02 ("that will be only set by
// admin"). (The editor API still clamps `floor_per_row` if it is ever posted; that is deliberate
// defence in depth, not a second door for a person.)
//
// ⚠️ THE DATABASE'S CHECK CONSTRAINT (settings_floor_per_row_range) IS THE OUTER BOUND, and
// migration 265 set it to 2..30. Keep the constraint >= the max below — WIDER than the UI is
// safe, NARROWER is the bug that cost an evening: this file went to 30 on 2026-07-31 while the
// constraint stayed at migration 226's 12, so the screen invited a number the database refused,
// that came back as a 500, and the panel's offline queue took a 500 for "the server is busy",
// saved the write and retried it forever under "Sending 3 saved changes… made while you were
// offline". lib/dbRefusal.ts now makes any such mismatch a visible refusal instead of a silent
// retry loop, but the real fix is to keep the constraint the looser of the two.
export const FLOOR_PER_ROW_MIN = 2;
export const FLOOR_PER_ROW_MAX = 12;
export const FLOOR_PER_ROW_DEFAULT = 12; // compact by default (owner, 2026-07-31): the floor is
// full-width now that the right-hand panel is gone, so 12 lands each tile around 115px on a wide
// monitor — the dense "see the whole restaurant at once" look he asked for. Was 6, which reproduced
// the old S/M/L "M" density back when a 300–460px rail ate the width.
// NOTE the width dependence, because it decides whether the tile can carry WORDS: 12 per row is
// ~145px per tile at 1920px, ~95px at 1280px, and 72px on a phone. The button labels drop below
// ~88px of tile (see the container queries in the panel stylesheet), so on a 1280px laptop the
// default already lands in the icon-only band.

/** Clamp anything (form input, DB value, URL param) into the allowed range. */
export function clampPerRow(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return FLOOR_PER_ROW_DEFAULT;
  return Math.min(Math.max(n, FLOOR_PER_ROW_MIN), FLOOR_PER_ROW_MAX);
}
