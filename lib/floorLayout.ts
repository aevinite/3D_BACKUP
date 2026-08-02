// Floor layout — the ONE place the "tables per row" rules live (mig 226).
//
// The admin sets how many table tiles sit on a row in the manager's floor view.
// Everything that touches that number (the admin form, the admin save route, the
// live preview, and the manager panel CSS) reads these constants so they can
// never drift apart.
//
// THE OWNER'S NUMBER WINS (owner, 2026-07-31: "I will tell you how much tables I want in a
// particular row — you have to make it dynamic, such that even if you have to make it very
// small, you will make it very small"). It used to be a polite TARGET: the grid refused to
// squeeze a tile below a readability floor and quietly handed back FEWER columns than asked
// for, so setting 16 got you 14 and nobody could see why. Now the tile shrinks to fit and
// sheds detail as it goes (the panel CSS drops the decorative ＋, then the sub-line, then the
// button's label, then the status text — the state COLOUR and the table number always survive).
//
// TILE_MIN_PX is no longer a readability limit, it is the last-resort TAPPABILITY limit: only
// when the asked-for columns would make a tile smaller than a finger does the grid give back a
// column. On a desktop that never triggers for a sane number; on a 390px phone it is what stops
// "16 per row" turning into 16 unusable slivers.
// ⚠️ THE DATABASE HAS THE SAME RANGE AS A CHECK CONSTRAINT (settings_floor_per_row_range).
// When these numbers change, change the constraint in the SAME pull request. They drifted once:
// this file went to 30 on 2026-07-31 and the constraint stayed at migration 226's 12, so the
// screen invited a number the database refused — and because that came back as a 500, the
// panel's offline queue took it for "the server is busy", saved it, and retried it forever under
// "Sending 3 saved changes… made while you were offline". Migration 260 widened the constraint;
// lib/dbRefusal.ts makes any future mismatch a visible refusal instead of a silent retry loop.
export const FLOOR_PER_ROW_MIN = 2;
export const FLOOR_PER_ROW_MAX = 30;
export const FLOOR_PER_ROW_DEFAULT = 12; // compact by default (owner, 2026-07-31): the floor is
// full-width now that the right-hand panel is gone, so 12 lands each tile around 115px — the
// dense "see the whole restaurant at once" look he asked for. Was 6, which reproduced the old
// S/M/L "M" density back when a 300–460px rail ate the width.

// The narrowest a table tile may ever get before the grid gives a column back. 44px is the
// touch-target minimum — below it a tile is not a button any more, whatever it displays.
// Mirrored in public/panels/editor/style.css (--ftile-floor); keep them in step.
export const TILE_MIN_PX = 44;

/** Clamp anything (form input, DB value, URL param) into the allowed range. */
export function clampPerRow(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return FLOOR_PER_ROW_DEFAULT;
  return Math.min(Math.max(n, FLOOR_PER_ROW_MIN), FLOOR_PER_ROW_MAX);
}
