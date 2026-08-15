// verify-floor-per-row.mjs — the floor's tables-per-row rule, and the ban on sideways scrolling.
//
// THE RULE (owner, 2026-08-15). It REPLACED the opposite rule, which is exactly why it needs a
// guard: the old one was stated as law in three files and quoted back by two later sessions.
//
//     phone, upright                →  2 per row      fixed
//     phone turned / small tablet   →  4 per row      fixed
//     ~10 inches (1024px) and up    →  the admin's number, exactly
//     and NOWHERE does the floor scroll sideways — "there should be only be vertical scroll"
//
// What this checks, and why each one can rot on its own:
//   1. the bands exist, in CSS, at the right widths — in JS they would need a resize listener and
//      would lag a rotation;
//   2. the panels write --per-row-pc, NOT --per-row. This is the whole mechanism: an inline
//      --per-row beats every stylesheet rule, so getting this wrong makes the bands silently do
//      nothing and the bug looks like "the CSS is ignored";
//   3. the bands do not apply inside the admin's layout preview, where the point is to see the PC
//      floor whatever size the iframe is;
//   4. nothing on the floor scrolls sideways any more — no x-scroll on the grid, no "→ N more"
//      chip, no measuring pass left behind;
//   5. both panels obey it. The manager floor and the waiter floor drifted apart once already.
//
// Read-only and offline. `npm run verify:floor-per-row`
import { readFileSync, existsSync } from "node:fs";

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
check("…and where the admin's number takes over", /PER_ROW_SET_FROM_PX\s*=\s*1024/.test(lib));
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
  check(`${name}: a phone gets 2 per row`, /@media\s*\(max-width:\s*599px\)[\s\S]{0,220}--per-row:\s*2/.test(css),
    "his fixed rule for a phone held upright");
  check(`${name}: turned sideways gets 4`, /@media\s*\(min-width:\s*600px\)\s*and\s*\(max-width:\s*1023px\)[\s\S]{0,220}--per-row:\s*4/.test(css),
    "his fixed rule for a phone on its side (and a small/upright tablet)");
  check(`${name}: above 1023px nothing overrides the set number`,
    !/@media\s*\(min-width:\s*1024px\)[\s\S]{0,200}--per-row:\s*\d/.test(css),
    "from ~10 inches up the number he set must be drawn exactly");
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
check("the admin card says small screens ignore the number", /Small screens ignore this number/.test(adminCard),
  "otherwise the first question is \u201cI set 12, why does my phone show 2?\u201d");
check("…and no longer claims it applies to any screen", !/on this screen and on\s*\n?\s*any other/.test(adminCard));

console.log(pass
  ? "\n✅ PASS — 2 on a phone, 4 turned, his number from ~10 inches up, and no sideways scroll"
  : "\n❌ FAIL — the floor is not drawing the number the owner's rule says it should");
process.exit(pass ? 0 : 1);
