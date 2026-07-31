// ── CUSTOM FLOOR PLANS — hand-written, one per restaurant (owner, 2026-07-31) ──────────────
//
// This file is DATA, not logic. The owner writes a restaurant's real floor shape here — where the
// window tables are, which ones sit in the A/C section, where the counter is — and the manager's
// Tables view draws exactly that when the restaurant's layout mode is set to **Custom**
// (admin → the restaurant → Settings → Floor layout). On **Classic** this file is ignored and the
// floor stays the plain "tables in order, N per row" grid.
//
// WHY IT'S A FILE AND NOT A SCREEN: he asked for it that way — "it will be hardcoded by me
// according to restaurant structure … I will hardcode that, so you don't need to do that". No
// editor, no drag-and-drop, nothing generated behind his back.
//
// ── HOW TO WRITE ONE ───────────────────────────────────────────────────────────────────────
//
//   window.LFH_FLOOR_LAYOUTS["restaurant-slug"] = {
//     cols: 12,                                  // how many columns wide the plan is
//     zones: [                                   // optional captions — a row heading
//       { label: "A/C",     y: 1 },
//       { label: "Non A/C", y: 5 },
//     ],
//     tables: [                                  // where each table sits
//       { t: 1, x: 1, y: 2 },                    // table 1 → column 1, row 2
//       { t: 2, x: 2, y: 2 },
//       { t: 9, x: 1, y: 3, w: 2 },              // a wide table (spans 2 columns)
//       { t: 10, x: 3, y: 3, w: 2, h: 2 },       // a big one (2 wide, 2 tall)
//     ],
//   };
//
//   · slug   — the restaurant's slug, exactly as in its URL (/r/<slug>/menu).
//   · x / y  — 1-based grid position. x = column, y = row. Leave gaps where the room has gaps;
//              an empty cell just stays empty, which is how you draw an aisle or the kitchen.
//   · w / h  — how many columns/rows the table covers. Both default to 1.
//   · zones  — a caption that spans the full width above row `y`. Pure labelling.
//
// RULES THE PANEL ENFORCES, so a half-finished plan can never lose a table:
//   · A table you haven't placed yet still appears, in an "Not placed on the plan yet" row under
//     the map. Nothing about a table's live state depends on this file.
//   · Two tables on the same cell is fine (they'll overlap visually) — it's your plan, but the
//     tile stays the same size and shape it would be anywhere else.
//   · A plan for a restaurant that no longer exists is simply never read.
//   · No plan for a restaurant that IS set to Custom → the floor draws Classic and says so on
//     screen, rather than showing an empty room.
//
// Nothing is enabled by adding a plan here: the restaurant also has to be switched to Custom.

window.LFH_FLOOR_LAYOUTS = window.LFH_FLOOR_LAYOUTS || {};

// ── EXAMPLE (commented out on purpose — delete the comment marks to try it) ─────────────────
// A 30-table room split into two sections, the way the reference POS screenshot lays it out.
//
// window.LFH_FLOOR_LAYOUTS["french-house"] = {
//   cols: 11,
//   zones: [{ label: "A/C", y: 1 }, { label: "Non A/C", y: 4 }],
//   tables: [
//     { t: 1, x: 1, y: 2 },  { t: 2, x: 2, y: 2 },  { t: 3, x: 3, y: 2 },  { t: 4, x: 4, y: 2 },
//     { t: 5, x: 5, y: 2 },  { t: 6, x: 6, y: 2 },  { t: 7, x: 7, y: 2 },  { t: 8, x: 8, y: 2 },
//     { t: 9, x: 9, y: 2 },  { t: 10, x: 10, y: 2 }, { t: 11, x: 11, y: 2 },
//     { t: 12, x: 1, y: 3 }, { t: 13, x: 2, y: 3 }, { t: 14, x: 3, y: 3 }, { t: 15, x: 4, y: 3 },
//     { t: 16, x: 5, y: 3 }, { t: 17, x: 6, y: 3 }, { t: 18, x: 7, y: 3 }, { t: 19, x: 8, y: 3 },
//     { t: 20, x: 9, y: 3 }, { t: 21, x: 10, y: 3 }, { t: 22, x: 11, y: 3 },
//     { t: 23, x: 1, y: 5 }, { t: 24, x: 2, y: 5 }, { t: 25, x: 3, y: 5 }, { t: 26, x: 4, y: 5 },
//     { t: 27, x: 5, y: 5 }, { t: 28, x: 6, y: 5 }, { t: 29, x: 7, y: 5 }, { t: 30, x: 8, y: 5 },
//   ],
// };
