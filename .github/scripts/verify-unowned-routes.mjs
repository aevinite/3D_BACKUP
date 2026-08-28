#!/usr/bin/env node
/**
 * verify-unowned-routes — the pages this repo's own testing plan never gave to anybody.
 *
 * WHY THIS EXISTS (T29 sweep #7, 2026-08-27). `.claude/sweep/LEDGER/INDEX.md` keeps a list titled
 * "Still genuinely unassigned", and it is not an administrative detail: a file no territory names
 * is a file that gets checked by luck rather than on purpose. `/pair` and `/api/pair` are the
 * newest members of that list — they landed after the territories were drawn — and between them
 * they are the whole of the zero-typing handshake a restaurant uses to let its own computer print.
 *
 * THE FAULT THAT PROMPTED IT. Every button label on the Allow page sat flush against the TOP edge
 * of its 52px button with 34px of dead space underneath, on every viewport. The rule asked for a
 * `line-height` and then, three declarations later, `font: inherit` — a SHORTHAND, which resets
 * line-height to `normal`. Nothing else was wrong: the markup, the class names, the colours and the
 * tap target were all correct, which is exactly why no other guard could see it.
 *
 * It also holds the two crash boundaries and the root layout, which are load-bearing in a way that
 * leaves no trace when they break: an error page that imports the app's CSS shows nothing when the
 * app's CSS is what failed, and a boundary that names a restaurant shows the wrong restaurant's
 * name to the one that crashed.
 *
 * DELIBERATELY STATIC AND REPO-ONLY — no database, no login, no network, no running app — so it
 * runs in CI on every push, in every worktree, with no key.
 *
 *   node .github/scripts/verify-unowned-routes.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const R = (p) => path.join(ROOT, p);
const read = (p) => (existsSync(R(p)) ? readFileSync(R(p), "utf8") : "");

let fails = 0;
const ok = (m) => console.log("  ✓ " + m);
const bad = (m, d) => { fails++; console.log("  ✗ " + m + (d ? "\n      " + d : "")); };
const want = (c, good, badMsg, detail) => (c ? ok(good) : bad(badMsg, detail));

/* ── /pair — the one screen a program opens on a shop's own computer ──────────────────── */
{
  const page = read("app/pair/page.tsx");
  const api = read("app/api/pair/route.ts");
  want(page && api, "the Allow page and its door are both present",
    "app/pair/page.tsx or app/api/pair/route.ts is missing",
    "Without them a restaurant cannot let its own computer print at all.");

  // The console link must be reachable only for the person who can actually open the console.
  // The two halves of the permission rule, restated here because this file is the one that reads
  // the page: verify:print-helper covers the door, nothing covered the screen.
  want(/tokenIsValid/.test(api) && /managerCan/.test(api) && /print_setup/.test(api),
    "only the admin, or a manager who may set the printers up, can allow a computer",
    "app/api/pair no longer asks both questions",
    "This is the whole boundary of the handshake: the helper describes itself, but a signed-in human\n      " +
    "decides which restaurant it joins.");
  want(/who\.kind === "admin" \? String\(body\.rid/.test(api) || /who\.restaurantId/.test(api),
    "a manager can still only ever adopt a computer into their OWN restaurant",
    "app/api/pair now takes the restaurant from the request body for a staff member too",
    "Trusting the body's rid would let any manager attach a machine to somebody else's shop.");
  want(!/secret/.test(read("app/pair/page.tsx")),
    "the Allow page never handles the pairing's private secret",
    "app/pair/page.tsx now mentions the pairing secret",
    "Only the helper holds it. A browser that can see it is a browser that can adopt a machine.");
}

  // A LABEL MUST SIT IN THE MIDDLE OF ITS BUTTON. The `font:` shorthand RESETS line-height to
  // `normal`, so a `line-height` written BEFORE it is silently thrown away. That is exactly what
  // happened here: .pr-btn asked for `line-height: 52px` and then `font: inherit`, and every label
  // on the page rendered flush against the top edge of a 52px button with 34px of dead space under
  // it — measured on both a phone and a desktop, and invisible to every other guard, because the
  // markup, the class names and the colours were all correct.
  {
    const pg = read("app/pair/page.tsx");
    const blocks = [...pg.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
    const clobbered = blocks.filter((b) => {
      const lh = b.search(/(^|[;\s])line-height\s*:/);
      const fo = b.search(/(^|[;\s])font\s*:\s*(?!inherit\s*;?\s*$)|(^|[;\s])font\s*:\s*inherit/);
      return lh >= 0 && fo >= 0 && fo > lh;
    });
    want(clobbered.length === 0,
      "no rule on the Allow page sets a line-height that the font shorthand then throws away",
      `${clobbered.length} rule(s) declare line-height BEFORE a font shorthand, which resets it`,
      (clobbered[0] || "").trim().slice(0, 140) +
      "\n      Either move the line-height AFTER the shorthand, or centre with grid/flex — which also survives a\n      " +
      "label that wraps to two lines, where a tall line-height would push the second line out of the box.");
  }

/* ── the two crash boundaries — what a person sees when everything else has failed ────── */
{
  const err = read("app/error.tsx");
  const glob = read("app/global-error.tsx");
  want(err && glob, "both crash boundaries exist", "app/error.tsx or app/global-error.tsx is missing",
    "Without them a crash shows Next's own developer page to a guest.");
  want(/reset\(\)/.test(err) && /reset\(\)/.test(glob),
    "both crash pages still offer a way out instead of being a dead end",
    "a crash boundary has lost its 'Try again'",
    "A dead-end error page on a phone at a table means closing the tab and re-scanning the QR code.");
  // NARROWED after the first draft cried wolf: it also flagged `@/lib/errorReport`, which is how the
  // page files the crash at all — a tiny module with no imports of its own. What actually matters is
  // that the page carries its OWN styling and pulls in no component or stylesheet, because the app's
  // CSS may be exactly the thing that failed.
  want(!/className=/.test(glob) && !/import .*"@\/components/.test(glob) && !/\.css"/.test(glob),
    "the outermost crash page still styles itself inline — no app CSS, no app components",
    "app/global-error.tsx now leans on the app's own styling",
    "It is the page that shows when the app itself failed to load. A class name it cannot resolve or a\n      " +
    "stylesheet that never arrived leaves an unreadable page at the worst possible moment.");
  want(/colorScheme|color-scheme|Canvas/.test(err),
    "the crash page still follows the device's own light or dark setting",
    "app/error.tsx no longer uses system colours",
    "It cannot know whose restaurant failed, so it cannot use a restaurant's palette — and a fixed one\n      " +
    "is white-on-white for half the people who see it.");
  want(!/french|aangan|little/i.test(err) && !/french|aangan|little/i.test(glob),
    "neither crash page shows one particular restaurant's branding",
    "a crash boundary names a specific restaurant",
    "Every restaurant is genuinely different, and the boundary cannot know which one crashed. Showing\n      " +
    "restaurant #1's name to another tenant is this project's oldest recurring fault.");
}

/* ── the first paint — the root layout, and the dish page that renders outside it ─────── */
{
  // A DISH PAGE RENDERS OUTSIDE AppShell, so everything the shell does for the menu has to be
  // repeated on it by hand: maintenance mode, the menu switch, the accent — and the restaurant's
  // DEFAULT light/dark. The fourth was missing for months and left no trace, because tapping
  // through from the menu puts the choice in localStorage first. Only a FULL load of a dish URL —
  // a shared link, a refresh, a QR straight to a dish — showed it, and only for a restaurant whose
  // admin had chosen dark, which neither test restaurant had. Measured: with the default flipped
  // to dark, a cold load of the dish URL came back light. The two pages must emit the SAME line.
  const menu = read("app/r/[restaurant]/menu/page.tsx");
  const dish = read("app/r/[restaurant]/item/[slug]/page.tsx");
  const LINE = /menuDefaultMode === "dark"/;
  const BOOT = /localStorage\.getItem\('lfh_theme'\)[\s\S]{0,80}setAttribute\('data-theme','dark'\)/;
  want(LINE.test(menu) && BOOT.test(menu),
    "the menu page still applies a restaurant's own default light/dark before it paints",
    "app/r/[restaurant]/menu/page.tsx has lost its default-skin boot script");
  want(LINE.test(dish) && BOOT.test(dish),
    "…and so does the dish page, which renders outside the shell and has to repeat it",
    "app/r/[restaurant]/item/[slug]/page.tsx no longer applies the restaurant's default light/dark",
    "A dish opened by a shared link, a refresh or a QR code will come up LIGHT on a restaurant whose\n      " +
    "admin chose dark. Tapping through from the menu hides it, because the choice is already saved by\n      " +
    "then — so this is a fault nobody reports and nobody sees in testing.");
  want(!LINE.test(dish) || /only act when nothing is saved|nothing is saved|has saved nothing/.test(dish),
    "…and both still leave a guest who has chosen for themselves alone",
    "the dish page's default-skin script no longer says it defers to the guest's own choice");
}

/* ── the root layout — the first paint, before anything else has run ──────────────────── */
{
  const layout = read("app/layout.tsx");
  const bodyAt = layout.indexOf("<body");
  const themeAt = layout.indexOf("lfh_theme");
  want(themeAt > -1 && (bodyAt === -1 || themeAt < bodyAt),
    "the saved light/dark choice is still applied before the first paint",
    "app/layout.tsx's theme boot script no longer runs before <body>",
    "Moving it later brings back the white flash on every load for anyone using light mode — and an\n      " +
    "unstyled flash is a CSS-DELIVERY fault, not a styling one, so it is easy to chase in the wrong file.");
  want(/OfflineShell|serviceWorker/.test(layout),
    "every surface still registers the offline layer from the root layout",
    "app/layout.tsx no longer registers the service worker",
    "One missing registration is the whole offline layer, on every panel and every guest door.");
}

console.log(fails
  ? `\n❌ verify-unowned-routes — ${fails} problem(s) on pages no territory owns.`
  : "\n✅ verify-unowned-routes — the Allow page, the two crash boundaries and the first paint all still behave");
process.exit(fails ? 1 : 0);
