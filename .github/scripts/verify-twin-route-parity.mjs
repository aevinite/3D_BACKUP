#!/usr/bin/env node
/**
 * verify-twin-route-parity — a panel exists at TWO addresses, and both must say the same thing.
 *
 * Every staff panel has a twin: `/manager` (reached from the admin console) and
 * `/r/<slug>/manager` (the restaurant's OWN address, which is what its own staff use). The pair
 * renders the same iframe through the same gate — and drifts, because a fix goes into whichever
 * file the person had open. `docs/CLAUDE-DETAIL.md` records the shape ("twin panel routes drift —
 * fix all three"); `npm run verify:twins` covers the same idea for the panels' own behaviour.
 *
 * WHY THIS FILE (T29 sweep, 2026-08-22). The T15 sweep, 2026-08-05, gave `/manager`, `/kitchen` and
 * `/tablet` each their own browser-tab name, because a manager with all three open had three
 * identical tabs to pick from mid-service. The three twins never got the line. So the tabs a
 * restaurant's own staff use — the ones a real waiter is switching between during a rush — ALL read
 * "Aevidine — Restaurant OS", the root layout's default. Watched in a browser before the fix: three
 * identical titles. The fault is small and it is exactly the kind that comes back, because nothing
 * looks wrong in either file on its own; only the PAIR is wrong.
 *
 * What it asserts: for each panel, both route files declare a tab title, and the two titles match.
 * Read-only, repo-only: no server, no database, no key. Runs in CI on every push.
 *
 *   node .github/scripts/verify-twin-route-parity.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
let fails = 0;
const ok = (m) => console.log("  ✓ " + m);
const bad = (m, d) => { fails++; console.log("  ✗ " + m + (d ? "\n      " + d : "")); };

// The tab title is a static `export const metadata = { title: "…" }` on both sides, so it can be
// read without running Next. A page that switched to `generateMetadata` is reported rather than
// silently passed — that is a real change and this guard should be re-taught, not bypassed.
const titleOf = (file) => {
  const src = readFileSync(path.join(ROOT, file), "utf8");
  const m = src.match(/export const metadata\s*(?::[^=]*)?=\s*\{[^}]*title:\s*"([^"]+)"/s);
  if (m) return m[1];
  if (/export async function generateMetadata|export function generateMetadata/.test(src)) return "__DYNAMIC__";
  return null;
};

const PANELS = [
  ["manager", "app/manager/page.tsx", "app/r/[restaurant]/manager/page.tsx"],
  ["kitchen", "app/kitchen/page.tsx", "app/r/[restaurant]/kitchen/page.tsx"],
  ["tablet", "app/tablet/page.tsx", "app/r/[restaurant]/tablet/page.tsx"],
];

for (const [panel, plain, tenant] of PANELS) {
  for (const f of [plain, tenant]) {
    if (!existsSync(path.join(ROOT, f))) { bad(`${f} does not exist — re-teach this guard`); }
  }
  if (!existsSync(path.join(ROOT, plain)) || !existsSync(path.join(ROOT, tenant))) continue;

  const a = titleOf(plain), b = titleOf(tenant);
  if (!a) { bad(`${plain} declares no browser-tab title`, "every panel tab must name itself — three identical tabs is the fault this guards"); continue; }
  if (!b) {
    bad(`${tenant} declares no browser-tab title, but its twin ${plain} says "${a}"`,
      `The restaurant's OWN address is the one its staff use. Without this line the tab falls back to the root\n      ` +
      `layout's "Aevidine — Restaurant OS", so the manager panel, the kitchen screen and the waiter view are three\n      ` +
      `identical tabs during a rush. Add: export const metadata = { title: "${a}" };`);
    continue;
  }
  if (a === "__DYNAMIC__" || b === "__DYNAMIC__") { ok(`${panel}: one side builds its title per restaurant — compared by hand, not here`); continue; }
  a === b
    ? ok(`${panel}: both addresses name the tab "${a}"`)
    : bad(`${panel}: the two addresses disagree on the tab name`, `${plain} → "${a}"\n      ${tenant} → "${b}"`);
}

// The three titles must also differ FROM EACH OTHER, or naming them achieved nothing.
const names = PANELS
  .filter(([, p, t]) => existsSync(path.join(ROOT, p)) && existsSync(path.join(ROOT, t)))
  .map(([, , t]) => titleOf(t))
  .filter((x) => x && x !== "__DYNAMIC__");
new Set(names).size === names.length
  ? ok(`the ${names.length} tenant-address panel tabs are all named differently`)
  : bad("two tenant-address panels share a tab name", names.join(" · ") + " — a person still cannot tell the tabs apart");

// And neither side may fall back to the root default, which is what "no title" looks like on screen.
const ROOT_DEFAULT = "Aevidine — Restaurant OS";
const wrong = PANELS.flatMap(([, p, t]) => [p, t])
  .filter((f) => existsSync(path.join(ROOT, f)) && titleOf(f) === ROOT_DEFAULT);
wrong.length
  ? bad(`${wrong.length} panel route(s) hard-code the root default as their own title`, wrong.join("\n      "))
  : ok(`no panel route uses the root layout's generic "${ROOT_DEFAULT}" as its tab name`);

// BOTH ADDRESSES MUST BUILD THE IFRAME URL THE SAME WAY (added 2026-08-22).
//
// panelIframeSrc() carries three admin-only pins into the panel — rid (which restaurant), view=real
// (show the role's real, un-X-rayed panel) and as=<staff id> ("Visit their panel"). The /r/<slug>/…
// doors used to build that URL by hand and carried only rid, so the SAME tab behaved differently
// depending on which address it was opened at, and nothing said so. A hand-built URL is how that
// happens, so this fails on one: the builder is the single place those pins are defined and
// validated, and it is also what makes them safe (it returns the bare URL when there is no admin).
for (const [panel, plain, tenant] of PANELS) {
  for (const f of [plain, tenant]) {
    if (!existsSync(path.join(ROOT, f))) continue;
    // COMMENTS STRIPPED FIRST. The first version of this check grepped the raw source and went red
    // on the very comment that EXPLAINS the rule — the comment quotes the hand-built URL it is
    // warning you off. A guard that fails on its own documentation is a guard people switch off.
    const src = readFileSync(path.join(ROOT, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    if (/index\.html"\s*\+/.test(src)) {
      bad(`${f} builds its panel URL by hand instead of through panelIframeSrc()`,
        `Only rid survives a hand-built URL; view=real and as=<staff id> are silently dropped, so the\n      ` +
        `same tab does two different things at /${panel} and at /r/<slug>/${panel}. Use\n      ` +
        `panelIframeSrc("/panels/…/index.html", admin ? restaurantId : null, { as, view }).`);
    } else if (!/panelIframeSrc\(/.test(src)) {
      bad(`${f} neither builds its panel URL by hand nor calls panelIframeSrc() — re-teach this guard`, f);
    } else {
      ok(`${f} builds its panel URL through panelIframeSrc()`);
    }
  }
}

// The two CONSOLES have one layout each, covering every page under them, and they must name their
// tab too — the admin console was the last surface still falling back to the root default, across
// all 23 of its pages.
for (const [what, file] of [["the owner console", "app/owner/layout.tsx"], ["the admin console", "app/aevinite/layout.tsx"]]) {
  if (!existsSync(path.join(ROOT, file))) { bad(`${file} does not exist — re-teach this guard`); continue; }
  const t = titleOf(file);
  if (!t) bad(`${what} (${file}) declares no browser-tab title`,
    "every page under it then falls back to the root layout's generic name, so it cannot be told from a panel tab");
  else if (t === ROOT_DEFAULT) bad(`${what} hard-codes the root default as its own title`, file);
  else ok(`${what} names its tab "${t}"`);
}

console.log(fails
  ? `\n❌ verify-twin-route-parity — ${fails} problem(s). A panel that exists at two addresses must behave the same at both.`
  : "\n✅ verify-twin-route-parity — every panel names its tab, and its twin agrees");
process.exit(fails ? 1 : 0);
