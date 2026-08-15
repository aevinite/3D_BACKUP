// Floor layout — the ONE place the "tables per row" rules live (mig 226).
//
// The admin sets how many table tiles sit on a row in the manager's floor view. Everything that
// touches that number reads these constants so they can never drift apart: the admin form
// (components/admin/RestaurantSettings.tsx), the admin save route
// (app/api/admin/restaurants/settings/route.ts) and the manager panel's own settings write
// (app/api/editor/[...path]/route.ts) all clamp through clampPerRow below.
//
// ── WHOSE NUMBER, AND ON WHICH SCREENS (owner, 2026-08-15, refined 2026-08-16) ────────────────
// The question the floor asks is "am I on a computer, or in someone's hand?" — NOT "how wide is
// this window":
//
//     a mouse or trackpad (a laptop / desktop)  →  EXACTLY the number set below, at ANY window size
//     a touchscreen, long edge under ~10.5"     →  2 per row upright, 4 turned sideways   (fixed)
//     a touchscreen, long edge ~10.5" and over  →  EXACTLY the number set below
//
// and NOWHERE does the floor scroll sideways — "there should be only be vertical scroll".
//
// WHY IT IS THE INPUT AND NOT THE WIDTH (owner, 2026-08-16): "sometimes in the laptop also the
// screen is not full, like minimised — so if it is in laptop, I want it to show 12. If it is in
// touchscreen, it should be shown according to screen size." A half-width window on a 14-inch
// laptop is still a laptop, with a mouse and a proper screen; measuring the WINDOW made it draw a
// phone's floor. So `pointer: coarse` — the browser's own answer to "is the main pointing device a
// finger?" — decides first, and the screen bands only ever apply to a touchscreen. He gave a
// width-only fallback ("if you can't do that, then till 10.5 inch by screen") and it is not needed:
// the pointer test is one media query and every browser we support answers it.
//
// WHY 10.5 INCHES IS 1150 CSS PIXELS OF LONG EDGE. A browser cannot read the physical size of a
// screen; a tablet's CSS pixel is roughly a 160dpi reference pixel, so the LONG edge is the closest
// honest proxy, and 1150 is where the real devices separate:
//     iPhone 14 Pro Max 430×932 → 932   phone bands
//     iPad mini 8.3"    744×1133 → 1133  phone bands   (under 10.5", correctly)
//     iPad 10.9"        820×1180 → 1180  the set number
//     iPad Pro 11"      834×1194 → 1194  the set number
// It is stated as an approximation, not a measurement of glass, and the mini/10.9 gap it sits in is
// only 47px wide — an unusual Android tablet could land on the wrong side. Say so rather than
// implying precision.
//
// ⚠️ THIS IS A REVERSAL of the rule that stood until 2026-08-15, and the old one was written in
// capitals in this file, in the panel stylesheet and in app.js: "EXACTLY --per-row columns, at every
// width, on every device", with a phone keeping all 12 columns and scrolling sideways inside a 332px
// window. Do NOT restore the sideways scroll from the older quote ("adjust according to screen size
// and all that shit doesn't count here") — that was about the number not being silently reduced ON A
// COMPUTER, and it is answered above: on a computer his number is now obeyed at ANY window size,
// which the width-only version briefly was not.
//
// WHAT IT COSTS. On a phone the tiles are big and everything on them is legible, but a 30-table
// floor is 15 rows of vertical scrolling instead of one dense screen. On a computer a very dense
// setting in a narrow window makes small tiles — the container queries in the panel stylesheet shed
// detail in priority order (the decorative ＋, the sub-line, the button labels, then the whole
// action row) while the table number and its state COLOUR always survive.
//
// The bands are implemented in CSS, not JavaScript: app.js writes the admin's number to the grid as
// `--per-row-pc`, and the stylesheet turns it into the effective `--per-row`. Nothing measures
// anything, and a rotation is instant because it is just a media query.
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
export const PER_ROW_PHONE = 2;          // a TOUCH screen held upright
export const PER_ROW_PHONE_WIDE = 4;     // a TOUCH screen turned sideways
// The long edge, in CSS pixels, at which a touchscreen counts as "about 10.5 inches" and stops
// using the fixed counts. Not a measurement of glass — see the box above for the devices it
// separates and how narrow the gap is.
export const PER_ROW_TOUCH_BIG_PX = 1150;

/** Clamp anything (form input, DB value, URL param) into the allowed range. */
export function clampPerRow(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return FLOOR_PER_ROW_DEFAULT;
  return Math.min(Math.max(n, FLOOR_PER_ROW_MIN), FLOOR_PER_ROW_MAX);
}
