// verify-panel-canvas.mjs — a staff panel must always paint its OWN background, edge to edge.
//
// THE BUG THIS EXISTS FOR (owner, 2026-08-26, reported with a photo of his phone):
//
//   He scrolled the floor on a Galaxy A35 and a dark strip appeared under the last row of tiles,
//   above the Android nav bar. Measured on the running panel: the manager panel's `body` computed
//   to `background-color: rgba(0, 0, 0, 0)` — TRANSPARENT — while the page hosting the frame is
//   `rgb(10, 12, 16)`. The near-black host was showing THROUGH the panel.
//
//   The cause is the CSS shorthand trap, in TWO rules that each restated the whole background and
//   dropped the colour — overriding a third, earlier rule that had always been correct:
//
//       body { background: <gradient>, <gradient>, var(--bg); }             /* line ~904  — FINE */
//       body { background: radial-gradient(…) fixed; }                      /* line ~2109 — blanked it */
//       html[data-theme="light"] body { background: radial-gradient(…) fixed; }   /* ~3680 — blanked it again */
//
//   `background: <image>` RESETS background-color to transparent and sets only an image. With
//   `fixed`, that image is sized to the VIEWPORT — so anywhere it does not reach (past the fold on
//   a long scroll, and the safe-area inset strip under an edge-to-edge nav bar) nothing is painted
//   at all and whatever sits behind the frame shows through. The light rule is the one that was
//   actually biting, because LIGHT is the panels' default skin — and it had re-blanked the colour
//   the dark rule above it had just been given.
//
// WHAT IT CHECKS, per panel stylesheet:
//
//   A. `html` carries a background colour. The canvas takes its colour from `html` first, and that
//      is the only thing that covers the inset strip the body box never reaches.
//   B. No rule targeting `html` or `body` uses the `background:` SHORTHAND with an image and no
//      colour. That is the exact shape that blanks it, and it is invisible in review — the page
//      looks right until someone scrolls on a phone.
//
// It reads stylesheets only. No server, no browser, no database, well under a second.
//
// Usage: node scripts/verify-panel-canvas.mjs
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (m, extra) => { pass++; console.log(`  ✅ ${m}${extra ? ` — ${extra}` : ""}`); };
const bad = (m, extra) => { fail++; console.log(`  ❌ ${m}${extra ? ` — ${extra}` : ""}`); };

// Only panels that are hosted FULL-SCREEN in their own frame. A panel embedded inside the owner
// console is a different case on purpose — there the shell paints the skin and the panel is meant
// to be see-through (see applyEmbedSkin / "the embed skin has ONE writer").
const SHEETS = [
  ["the manager panel", "public/panels/editor/style.css"],
  ["the waiter tablet", "public/panels/tablet/style.css"],
  ["the kitchen screen", "public/panels/kitchen/style.css"],
];

console.log("→ every staff panel paints its own background, edge to edge\n");

// Comments are blanked first: this file's own explanation quotes the broken pattern, and so do the
// warnings now written into the stylesheets. A guard that reads its own warning as the fault is
// the mistake verify:rejected already made once.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

/**
 * Is this selector's SUBJECT the page itself?
 *
 * ⚠️ The first cut of this guard asked "does the selector contain html or body", and accused
 * thirteen perfectly correct rules — `html[data-theme="light"] .ftile`, `.tile`, `.topbar`,
 * a tag ribbon. A gradient with no colour is exactly right on a TILE; it is only wrong on the
 * PAGE. So: split on commas, take each selector's LAST simple selector, and require it to be
 * `html` or `body` itself once its attributes, classes and pseudos are stripped.
 */
const targetsThePage = (sel) => sel.split(",").some((one) => {
  const last = one.trim().split(/[\s>+~]+/).filter(Boolean).pop() || "";
  const bare = last.replace(/\[[^\]]*\]/g, "").replace(/[:.#][^\s]*/g, "").trim();
  return bare === "html" || bare === "body";
});

for (const [name, rel] of SHEETS) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) { bad(`${name}: ${rel} is not there`, "re-point this list"); continue; }
  const css = stripComments(readFileSync(abs, "utf8"));

  const pageRules = [];
  const RULE = /(^|\})\s*([^{}@]*?)\{([^{}]*)\}/gm;
  for (const m of css.matchAll(RULE)) {
    const sel = m[2].trim();
    if (!sel || !targetsThePage(sel)) continue;
    pageRules.push({ sel, body: m[3], line: css.slice(0, m.index).split("\n").length });
  }

  // A. SOMETHING paints the canvas. `html` with a colour is the surest, because the canvas takes
  //    its colour from html first and that is what covers the inset strip the body box never
  //    reaches — but a plain background-COLOR on `body` propagates to the canvas too when html has
  //    none, and that is equally safe. Either satisfies this; neither is not an opinion, it is the
  //    dark band the owner photographed.
  const paints = pageRules.filter((r) => /(?:^|;)\s*background(-color)?\s*:\s*(?!none\b|transparent\b)[^;}]+/.test(r.body)
    && !/(?:^|;)\s*background\s*:\s*[^;}]*(gradient|url)\s*\(/.test(r.body));
  if (paints.length) ok(`${name}: the page carries a background colour`, `${paints.length} rule(s) — the canvas can never fall through to the host page`);
  else bad(`${name}: nothing gives html or body a plain background colour`,
    "on a phone the strip under the nav bar is then painted by whatever is BEHIND the frame — the dark band the owner photographed on 2026-08-26");

  // B. no PAGE rule sets the background shorthand to an image with no colour.
  const offenders = [];
  for (const r of pageRules) {
    const sh = r.body.match(/(?:^|;)\s*background\s*:\s*([^;}]+)/);
    if (!sh) continue;
    const value = sh[1].trim();
    if (!/(gradient|url)\s*\(/i.test(value)) continue;      // `background: var(--bg)` is a colour
    // A COLOUR AS THE LAST LAYER IS CORRECT AND MUST NOT BE FLAGGED, including `var(--bg)`.
    // ⚠️ The second cut of this guard rejected a var() colour there and accused
    // `public/panels/editor/style.css:904`, which has been right all along —
    // `background: <gradient>, <gradient>, var(--bg)` sets the colour perfectly well. What made
    // the page transparent was never that rule; it was the two LATER rules that restated the
    // shorthand with no colour at all and overrode it. Judge the value, not the syntax style.
    const colourLast = /,\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|var\(\s*--[\w-]+[^)]*\)|transparent|[a-z]+)\s*$/i.test(value);
    if (!colourLast) offenders.push(`${rel}:${r.line}  ${r.sel.replace(/\s+/g, " ").slice(0, 56)} { background: ${value.slice(0, 56)}… }`);
  }
  if (!offenders.length) ok(`${name}: no page rule blanks the colour with an image-only shorthand`, `${pageRules.length} html/body rule(s) checked`);
  else bad(`${name}: ${offenders.length} page rule(s) set an image-only background shorthand`,
    offenders.join("\n      ")
      + "\n      `background: <image>` resets background-color to TRANSPARENT. Split it: `background-color:` and"
      + "\n      `background-image:` on their own lines, so nothing can silently blank the page again.");
}

console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
