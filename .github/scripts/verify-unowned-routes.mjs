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
 * THE FAULT THAT PROMPTED IT. The Allow page's "Choose which printer prints what →" button pointed
 * at `/aevinite/printing` for EVERYBODY. The printing board lives in two places (mig 367): that
 * admin console, and the restaurant's own Manager panel under Settings → Printing. The person
 * pressing Allow is usually the manager, and `/aevinite` redirects them to a password prompt —
 * so the setup ended at a login screen that reads like their own sign-in had just failed, at the
 * exact moment the guide says to choose which printer prints what.
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
  // STRUCTURAL, not "both strings appear somewhere in the file". The first draft asked only whether
  // the page mentioned `who === "admin"` AND mentioned the console link — which stays true when the
  // two have nothing to do with each other, and so would have passed the very shape it exists to
  // catch. Each console link is now judged by the line it is written on.
  const lines = page.split("\n");
  const unguarded = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => /href="\/aevinite/.test(l) && !/^\s*(\/\/|\*)/.test(l))
    .filter(({ l, i }) => !/who === "admin"/.test(l) && !/who === "admin"/.test(lines[i - 1] || ""));
  want(unguarded.length === 0,
    "the console link on this page is shown only to the admin; a manager is sent to their own panel",
    `the Allow page links into /aevinite on ${unguarded.length} line(s) without checking who is pressing it` +
    (unguarded.length ? `\n      line ${unguarded[0].i + 1}: ${unguarded[0].l.trim().slice(0, 100)}` : ""),
    "The printing board is in TWO places (mig 367). /aevinite redirects a manager to a staff-password\n      " +
    "prompt, so a link everybody sees ends the setup at a login screen that reads like their own sign-in\n      " +
    "failed. Branch it on `who`, and send a manager to their own panel's Settings → Printing.");
  want(!/who === "admin"/.test(page) || /Settings → Printing|Settings &rarr; Printing/.test(page),
    "…and the manager is told WHERE it is, in words, not just handed a link",
    "the manager's route to the printing board no longer names Settings → Printing",
    "The panel has no deep link to that section, so the words ARE the direction.");

  // The API must answer the page's own question on every branch that draws that button.
  const alreadyBranch = (api.match(/already:\s*true[^\n]*/) || [""])[0];
  want(/who/.test(alreadyBranch),
    "an already-linked machine is still told WHO is asking, so the button can point the right way",
    "GET /api/pair's already-linked answer no longer carries `who`",
    "Without it the page cannot tell an admin from a manager on that screen, and falls back to the\n      " +
    "console link for both.");

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
