// verify-floor-per-row.mjs — the floor's tables-per-row rule, and the ban on sideways scrolling.
//
// THE RULE (owner, 2026-08-15, refined 2026-08-16). It REPLACED the opposite rule, which is exactly
// why it needs a guard: the old one was stated as law in three files and quoted back by two later
// sessions.
//
//     a mouse / trackpad (a laptop, at ANY window size) → the admin's number, exactly
//     a touchscreen under ~10.5" (long edge < 1150px)   → 4 upright, 4 turned      fixed
//     a touchscreen ~10.5" and over                     → the admin's number, CAPPED AT 6
//     and NOWHERE does the floor scroll sideways — "there should be only be vertical scroll"
//
// What this checks, and why each one can rot on its own:
//   1. the bands are scoped to `pointer: coarse`. This is the half that is easy to lose: a
//      width-only band draws a phone's floor in a half-width laptop window, which is the exact
//      complaint that produced this version;
//   2. the size test uses BOTH edges, so a tablet keeps its number when it is turned;
//   3. the panels write --per-row-pc, NOT --per-row. This is the whole mechanism: an inline
//      --per-row beats every stylesheet rule, so getting it wrong makes the bands silently do
//      nothing and the bug looks like "the CSS is ignored";
//   4. the bands do not apply inside the admin's layout preview;
//   5. nothing on the floor scrolls sideways — no x-scroll on the grid, no "→ N more" chip, no
//      measuring pass left behind;
//   6. both panels obey it. The manager floor and the waiter floor drifted apart once already.
//
// Read-only and offline. `npm run verify:floor-per-row`
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
let pass = true;
const ok = (m, d = "") => console.log(`  ok   ${m}${d ? " — " + d : ""}`);
const bad = (m, d = "") => { pass = false; console.log(`  FAIL ${m}${d ? " — " + d : ""}`); };
const check = (m, cond, why = "") => (cond ? ok(m) : bad(m, why));
const read = (rel) => (existsSync(`${ROOT}/${rel}`) ? readFileSync(`${ROOT}/${rel}`, "utf8") : "");

console.log("\nTABLES PER ROW FOLLOWS THE SCREEN, AND NOTHING SCROLLS SIDEWAYS\n");

const lib = read("lib/floorLayout.ts");
const mgrJs = read("public/panels/editor/app.js");
const mgrCss = read("public/panels/editor/style.css");
const tabJs = read("public/panels/tablet/app.js");
const tabCss = read("public/panels/tablet/style.css");

// ── 1 · one source for the numbers ──────────────────────────────────────────────────────────
check("lib/floorLayout.ts states the two fixed counts", /PER_ROW_PHONE\s*=\s*2/.test(lib) && /PER_ROW_PHONE_WIDE\s*=\s*4/.test(lib),
  "the bands drifted across three files last time because each one wrote the rule out in prose");
check("…and the long edge where a touchscreen gets the admin's number", /PER_ROW_TOUCH_BIG_PX\s*=\s*1150/.test(lib));
check("it explains why the POINTER decides before the width", /pointer: coarse/.test(lib) && /minimised/.test(lib),
  "a half-width laptop window is still a laptop — losing that is how this rule broke once already");
check("…and the tablet cap, in his words", /PER_ROW_TOUCH_MAX\s*=\s*6/.test(lib) && /THEN SIX WILL BE SHOWN/.test(lib));

// ── 1b · BOTH panels cap a touchscreen at 6 ────────────────────────────────────────────────
// This lived in the waiter panel alone for eleven days, so the same iPad showed a waiter 6 tiles
// and a manager 12 — and upright, the manager's came out at 57px squares with no room for the
// buttons. One instruction, one behaviour, both floors.
for (const [name, src] of [["manager", mgrJs], ["waiter tablet", tabJs]]) {
  check(`${name}: a touchscreen is capped at 6 per row`, /FLOOR_PER_ROW_TOUCH_MAX\s*=\s*6/.test(src)
    && /Math\.min\([^)]*FLOOR_PER_ROW_TOUCH_MAX\)/.test(src),
    "his rule for a tablet: \"if there is twelve, then six will be shown\"");
  check(`${name}: it asks the same question the CSS asks`, /matchMedia\("\(pointer: coarse\)"\)/.test(src),
    "if the JS and the CSS disagreed about what a touchscreen is, the count and the layout would drift");
}
check("the manager does NOT cap the admin's layout preview", /if \(FLOOR_PREVIEW\) return v;/.test(mgrJs),
  "that iframe exists to show the PC floor the admin is actually setting");
check("the CACHED first-paint number is his, not the capped one", /The number CACHED is his, uncapped/.test(mgrJs),
  "caching the capped value on a tablet would teach that browser to draw 6 everywhere");
check("it records that this REVERSED the old rule", /REVERSAL/.test(lib),
  "without the history, the previous law's own comments read as the current one");

// ── 2 · the mechanism: the inline property must NOT be --per-row ────────────────────────────
for (const [name, src] of [["manager", mgrJs], ["waiter tablet", tabJs]]) {
  check(`${name}: writes --per-row-pc inline`, /--per-row-pc/.test(src));
  check(`${name}: never writes --per-row inline`, !/(style="--per-row:|setProperty\("--per-row",)/.test(src),
    "an inline --per-row beats every stylesheet rule, so the bands would do nothing at all");
}

// ── 3 · the bands, in CSS, at the right widths ──────────────────────────────────────────────
for (const [name, css] of [["manager", mgrCss], ["waiter tablet", tabCss]]) {
  check(`${name}: the grid reads --per-row-pc`, /--per-row:\s*var\(--per-row-pc/.test(css));
  // Anchor on the FULL opener: `@media (pointer: coarse)` on its own also opens unrelated blocks
  // (the manager stylesheet widens its sidebar grab-handle for a finger 1000 lines earlier), and
  // slicing from the first one made this guard read the wrong rules and fail a correct floor.
  const BAND_OPEN = "@media (pointer: coarse) and (max-width: 1149px)";
  // TAKE THE WHOLE BLOCK, NOT A FIXED 900 CHARACTERS. A comment written inside the band pushed the
  // second rule past that window on 2026-09-03 and this guard reported a correct floor as broken —
  // a guard that fails because somebody EXPLAINED a rule is a guard people learn to ignore. Walk
  // the braces instead, so the band is however long it needs to be.
  const band = (() => {
    const i = css.indexOf(BAND_OPEN);
    if (i < 0) return "";
    let depth = 0, j = css.indexOf("{", i);
    if (j < 0) return "";
    for (let k = j; k < css.length; k++) {
      if (css[k] === "{") depth++;
      else if (css[k] === "}") { depth--; if (depth === 0) return css.slice(i, k + 1); }
    }
    return css.slice(i);
  })();
  check(`${name}: the fixed counts apply to a TOUCHSCREEN only`, /@media\s*\(pointer:\s*coarse\)/.test(css),
    "without this, a laptop window made small draws a phone's floor — the complaint this version fixes");
  check(`${name}: …and only under ~10.5 inches, measured on BOTH edges`,
    /\(max-width:\s*1149px\)\s*and\s*\(max-height:\s*1149px\)/.test(band),
    "one edge only would drop a big tablet to 4 per row the moment it was turned");
  // FOUR UPRIGHT since 2026-09-03. The number moved twice that day and both moves were his, from
  // real screenshots of his own A35: two was the old rule (six tables on screen, mostly scrolling),
  // he picked THREE off a side-by-side ("i like 3 one"), then asked for the tile to get smaller so
  // more would fit down the screen. That was first tried by making the tile WIDE (3:2), which he
  // turned down — "kepp square format only if require make 4 colum in a row" — so the density comes
  // from the column count with the square intact. Counted with the compressed header and the
  // shrunken tile contents: 3 square = 15 tables on screen, 4 = 28, 5 = 31. Four is the last size
  // that keeps an order button on the tile (79px of tile holds the action row, 62px does not), and
  // at all three the number, the seat count, the state word and the tag ribbon survive on every tile.
  check(`${name}: a touchscreen upright gets 4 per row`, /@media\s*\(max-width:\s*599px\)[\s\S]{0,900}--per-row:\s*4/.test(band),
    "the owner picked four on 2026-09-03: 'kepp square format only if require make 4 colum in a row'");
  check(`${name}: turned sideways gets 4`, /@media\s*\(min-width:\s*600px\)[\s\S]{0,300}--per-row:\s*4/.test(band));
  check(`${name}: nothing overrides the set number on a fine pointer`,
    !/@media\s*\(pointer:\s*fine\)[\s\S]{0,200}--per-row:\s*\d/.test(css),
    "a laptop must draw his number at every window size");
}
// ── A PHONE-WIDTH CHECK THAT DOES NOT SAY "FINGER" IS TESTING A LAPTOP ──────────────────────
//
// The rule above turns on `@media (pointer: coarse)` — the browser's own answer to "is the main
// pointing device a finger?". Playwright reports a MOUSE unless the context is created with
// `hasTouch` (and, for a phone, `isMobile`). So a script that opens a 360px window WITHOUT them
// gets the laptop floor squeezed into a phone-sized frame: a layout no phone has ever drawn.
//
// This is not hypothetical. On 2026-09-03 a sweep terminal did exactly that, measured 7 tiles per
// row with the table number squeezed to 0px, and reported it to the owner as a phone fault — with
// a screenshot. It was the test rig. He had said he trusted it rather than checking himself, which
// is precisely why a lying check is worse than no check.
//
// So: any script that opens a browser at a phone width must also say "finger". Anything at 600px+
// is free to be a laptop, because that is a real thing to test.
{
  const dirs = [join(ROOT, "scripts"), join(ROOT, "scripts/sweep")];
  for (const d of readdirSync(join(ROOT, "scripts/sweep"), { withFileTypes: true }))
    if (d.isDirectory()) dirs.push(join(ROOT, "scripts/sweep", d.name));
  const offenders = [], soft = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".mjs"))) {
      const src = readFileSync(join(dir, f), "utf8");
      if (!/newContext\s*\(/.test(src)) continue;
      // every viewport this file opens; only the phone-width ones are held to the rule
      const widths = [...src.matchAll(/width:\s*(\d{3,4})\s*,\s*height:/g)].map((m) => +m[1]);
      const phone = widths.filter((w) => w > 0 && w < 600);
      if (!phone.length) continue;
      if (/hasTouch/.test(src)) continue;
      // FAIL only where it actually changes what is drawn — a script that opens a FLOOR. Everywhere
      // else (a guest menu, an admin page, a 404) `pointer: coarse` changes nothing, so a hard red
      // there would be this guard crying wolf, and a guard that cries wolf is one people switch off.
      // Those are listed as a note instead, because they are still worth tidying.
      const drivesFloor = /\.ftile|ftile-grid|data-floor-table|data-tab=.tables|\.tiles\b/.test(src);
      (drivesFloor ? offenders : soft).push(`${f} (opens ${[...new Set(phone)].join(", ")}px)`);
    }
  }
  check("every browser check that drives a FLOOR at phone width emulates a finger",
    offenders.length === 0,
    offenders.length
      ? `${offenders.length} do not: ${offenders.join(" · ")} — without hasTouch the panel serves the LAPTOP floor at phone width, so the check is measuring a screen no phone shows`
      : "");
  if (soft.length) console.log(`  note  ${soft.length} phone-width check(s) do not emulate a finger, but none of them drives a floor, so nothing they measure changes: ${soft.join(" · ")}`);
}

check("the manager's bands are switched off in the admin layout preview", /body:not\(\.floor-preview\)\s*\.ftile-grid/.test(mgrCss),
  "the preview exists to show the PC floor, whatever size that iframe is");

// ── 4 · nothing scrolls sideways ────────────────────────────────────────────────────────────
const gridBlock = mgrCss.slice(mgrCss.indexOf(".ftile-grid {"), mgrCss.indexOf(".ftile-grid {") + 1400);
check("the floor grid has no x-scroll", !/overflow-x:\s*auto/.test(gridBlock),
  "the whole point of the bands is that a small screen no longer has a floor too wide to show");
check("no 72px minimum column is left", !/minmax\(72px/.test(mgrCss),
  "that minimum existed only to keep a sideways-scrolling floor tappable");
check("the \u201c\u2192 N more\u201d chip is gone from the markup", !/data-ftile-more/.test(mgrJs));
check("…and its measuring pass with it", !/function syncFloorMore\(/.test(mgrJs),
  "a per-tile getBoundingClientRect pass on every render, for a scroll that no longer exists");
check("…and its styles", !/^\s*\.ftile-more\s*\{/m.test(mgrCss));
check("the header's stat chips wrap instead of scrolling", !/\.floor-head \.floor-stats[^}]*overflow-x:\s*auto/.test(mgrCss));
check("the editor keeps its x-hidden backstop", /\.editor:has\(\.floor-wrap\)\s*\{\s*overflow-x:\s*hidden/.test(mgrCss),
  "if the grid is ever made too wide again this is what stops the page itself sliding");

// ── 5 · the admin screen no longer promises the number on every device ──────────────────────
const adminCard = read("components/admin/RestaurantSettings.tsx");
check("the admin card names the tablet cap", /never more than <b>6<\/b> a row/.test(adminCard),
  "otherwise the next question is \"I set 12, why does my iPad show 6?\"");
check("the admin card says touchscreens ignore the number", /Touchscreens ignore this number/.test(adminCard),
  "otherwise the first question is \u201cI set 12, why does my phone show 2?\u201d");
check("…and no longer claims it applies to any screen", !/on this screen and on\s*\n?\s*any other/.test(adminCard));
check("…and promises a computer keeps it even in a small window", /even with the window made small/.test(adminCard),
  "that promise IS the rule he asked for on 2026-08-16");

console.log(pass
  ? "\n✅ PASS — a laptop gets his number at any size, a touchscreen gets 4, nothing scrolls sideways"
  : "\n❌ FAIL — the floor is not drawing the number the owner's rule says it should");
process.exit(pass ? 0 : 1);
