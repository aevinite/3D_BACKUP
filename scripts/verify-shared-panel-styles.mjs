#!/usr/bin/env node
/* verify:shared-panel-styles — A SCRIPT TWO PANELS LOAD MUST HAVE ITS LOOK SOMEWHERE BOTH LOAD.
 *
 * WHAT WENT WRONG, AND WHY THIS GUARD IS NARROW ON PURPOSE (T11, sweep #8, 2026-09-06).
 * `public/panels/billcustomer.js` — the "Who is this bill for?" box — is loaded by the manager's
 * panel AND by the tablet's, and both call it on the ordinary path to generating a bill. Every
 * one of its style rules lived in `editor/style.css`. Measured by rendering the real box under
 * each panel's real stylesheet at 390px:
 *
 *     editor   position:fixed · a backdrop · z-index 1100 · the box at y=15   ← a modal
 *     tablet   position:static · NO backdrop · z-index auto · the box at y=437 ← in the page flow
 *
 * Nothing was red. The panel loaded, the script ran, the box appeared — it just was not a modal.
 * That is the shape of fault this guard exists for: a shared script whose look is owned by one of
 * its owners.
 *
 * It asserts three things, and deliberately nothing more:
 *   1. every panel that loads a SHARED panel script also loads that script's stylesheet;
 *   2. the class names that stylesheet is responsible for are not ALSO defined in one panel's own
 *      stylesheet (that is the copy that drifts);
 *   3. the `?v=` on the link matches the file on disk, so a staff device cannot run an old look.
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// script → its stylesheet. Add a row when a panel script becomes shared.
const SHARED = [["billcustomer.js", "billcustomer.css"]];
const PANELS = ["editor", "tablet", "kitchen"];

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m, d) => { fails++; console.log(`  FAIL ${m}`); if (d) console.log(`         ${d}`); };

for (const [js, css] of SHARED) {
  if (!existsSync(join(ROOT, "public/panels/" + css))) { bad(`public/panels/${css} is missing`); continue; }
  const sheet = read("public/panels/" + css);
  const hash = createHash("sha1").update(sheet).digest("hex").slice(0, 8);
  const owners = PANELS.filter((p) => existsSync(join(ROOT, `public/panels/${p}/index.html`)) && read(`public/panels/${p}/index.html`).includes(js));
  if (owners.length < 2) { ok(`${js} is loaded by ${owners.length} panel(s) — nothing to share yet`); continue; }

  for (const p of owners) {
    const html = read(`public/panels/${p}/index.html`);
    const m = new RegExp(`${css.replace(".", "\\.")}(?:\\?v=([A-Za-z0-9_-]+))?`).exec(html);
    if (!m) { bad(`${p} loads ${js} but not ${css}`, "the box renders with no look at all in that panel"); continue; }
    if (!m[1]) bad(`${p} links ${css} with no ?v= stamp`, "a staff device can keep a weeks-old look");
    else if (m[1] !== hash) bad(`${p} asks for ${css}?v=${m[1]}, the file on disk hashes to ${hash}`);
    else ok(`${p} loads ${css} at the right version`);
  }

  // The classes this sheet owns must not be re-declared in any one panel's own stylesheet.
  const owned = [...new Set([...sheet.matchAll(/\.((?:bcust|bc)-[a-z-]+)/g)].map((x) => x[1]))];
  for (const p of PANELS) {
    const f = `public/panels/${p}/style.css`;
    if (!existsSync(join(ROOT, f))) continue;
    const own = read(f);
    const dupes = owned.filter((c) => new RegExp(`^\\s*[^/\\n]*\\.${c}\\b[^\\n]*\\{`, "m").test(own));
    if (dupes.length) bad(`${f} declares ${dupes.length} class(es) that ${css} owns`, `a second copy of one look: ${dupes.slice(0, 5).join(", ")}`);
    else ok(`${f} holds no second copy of ${css}'s classes`);
  }

  // And the sheet really must carry what makes it a modal — the fault that started this.
  for (const need of ["position: fixed", "z-index", "background"])
    if (!sheet.includes(need)) bad(`${css} has no "${need}"`, "the box would render in the page flow again");
  if (/position: fixed/.test(sheet)) ok(`${css} still makes the box an overlay, not a block in the page`);
}
console.log(fails ? `\n❌ verify:shared-panel-styles — ${fails} problem(s)` : "\n✅ verify:shared-panel-styles — every panel that loads a shared script loads its look too");
process.exit(fails ? 1 : 0);
