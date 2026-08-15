// Floor layout — the ONE place the "tables per row" rules live (mig 226).
//
// The admin sets how many table tiles sit on a row in the manager's floor view. Everything that
// touches that number reads these constants so they can never drift apart: the admin form
// (components/admin/RestaurantSettings.tsx), the admin save route
// (app/api/admin/restaurants/settings/route.ts) and the manager panel's own settings write
// (app/api/editor/[...path]/route.ts) all clamp through clampPerRow below.
//
// ── WHOSE NUMBER, AND ON WHICH SCREENS (owner, 2026-08-15 — THIS REPLACED THE OLD LAW) ─────────
// The number below is the number for a REAL SCREEN. Below that, the floor uses fixed counts that
// belong to the device, and it NEVER scrolls sideways:
//
//     phone, upright      →  2 per row      (fixed; not settable, not negotiable)
//     phone, turned / small tablet → 4      (fixed)
//     from ~10 inches up  →  EXACTLY the number set below, at every width above it
//
// His words: "table per row in the phone should be, like, two tables per row only. And whenever you
// tilt it, make it horizontal, it will be four table. It is fixed and it is rule … We don't need
// twelve, it is only for PC and stuff like that … till ten inch it's okay, but after ten inch you
// have to follow whatever is given — if I have tell twelve, there should be twelve listed. There
// shouldn't be horizontal scroll anywhere. There should be only be vertical scroll."
//
// ⚠️ THIS IS A REVERSAL, AND THE OLD RULE IS WHY THIS BOX IS SO LONG. Until today this file, the
// panel stylesheet and app.js all stated the OPPOSITE as law — "EXACTLY --per-row columns, at every
// width, on every device", justified by him twice ("adjust according to screen size and all that
// shit doesn't count here"), with a phone keeping all 12 columns and scrolling sideways inside a
// 332px window. He has now ruled the other way, in more detail, and the newer instruction wins. Do
// NOT restore the sideways scroll on the strength of the older quote: it was about the number not
// being silently reduced ON A DESKTOP, and it is answered above — above ~10 inches his number is
// obeyed exactly and nothing hands columns back.
//
// WHY WIDTH AND NOT INCHES. A browser cannot read the physical size of a screen; it reads CSS
// pixels. 1024px is the honest proxy for "ten inches": a 10" tablet held sideways is 1024 CSS px,
// and every laptop is above it. So the cut is at 1024px, and that is a stated approximation rather
// than a measurement of the glass.
//
// WHAT IT COSTS. On a phone the tiles are now big and everything on them is legible, but a
// 30-table floor is 15 rows of vertical scrolling instead of one dense screen. That is the trade he
// chose. Above 1024px a very dense setting still makes small tiles — the container queries in the
// panel stylesheet shed detail in priority order (the decorative ＋, the sub-line, the button
// labels, then the whole action row) while the table number and its state COLOUR always survive.
//
// The bands are implemented in CSS, not JavaScript: app.js writes the admin's number to the grid as
// `--per-row-pc`, and the stylesheet turns it into the effective `--per-row` per band. Nothing
// measures anything, and a rotation is instant because it is just a media query.
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
// ~145px per tile at 1920px, ~95px at 1280px, and ~85px at 1024px (the narrowest screen this number
// applies to at all — below that the fixed 2 / 4 bands take over). The button labels drop below
// ~88px of tile (see the container queries in the panel stylesheet), so on a 1280px laptop the
// default already lands in the icon-only band.

// The two fixed counts, and the width where the admin's number takes over. Exported so the panel
// stylesheet's bands, the admin form's helper text and the guard script all quote ONE source — the
// old rule drifted across three files precisely because each of them stated it in prose.
export const PER_ROW_PHONE = 2;          // a phone held upright
export const PER_ROW_PHONE_WIDE = 4;     // a phone turned sideways, and a small/upright tablet
export const PER_ROW_SET_FROM_PX = 1024; // ~10 inches: at and above this, the admin's number is used

/** Clamp anything (form input, DB value, URL param) into the allowed range. */
export function clampPerRow(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return FLOOR_PER_ROW_DEFAULT;
  return Math.min(Math.max(n, FLOOR_PER_ROW_MIN), FLOOR_PER_ROW_MAX);
}
