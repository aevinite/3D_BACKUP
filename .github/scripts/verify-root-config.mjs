#!/usr/bin/env node
/**
 * verify-root-config — the six files at the top of this repo that decide what the browser is
 * told, where the app runs, and what is uploaded. Nothing checked ANY of them.
 *
 * WHY THIS EXISTS (T29 sweep #7, 2026-08-27). `docs/GUARD-MAP.md` §11 answers "I changed this
 * file — which check covers it?" for `.vercelignore`, `.claude/settings.json`, `package.json`
 * dependencies, `scripts/`, and the rulebooks. It had **no row for `next.config.ts`**, and a
 * grep of every guard in this repo found not one that reads it. That file alone decides:
 *
 *   · the response headers every visitor gets (nosniff, Referrer-Policy, Permissions-Policy)
 *   · whether the content policy is REPORT-ONLY — the owner parked flipping it on 2026-08-16,
 *     and flipping it silently is how a screen goes blank in the middle of service
 *   · whether HSTS carries `preload`, which submits aevinite.shop to a browser-vendor list
 *     that is slow to come back off, and is not ours to commit the domain to
 *   · which eight surfaces refuse to be framed, and that the GUEST menu is deliberately not
 *     one of them, because a restaurant embedding its own menu would find it blank
 *   · which outside image hosts are granted at all
 *
 * Every one of those was verified by hand by a sweep, weeks apart, and by nothing in between.
 * This guard is the "in between". It also picks up the root-config facts the same sweep checks
 * every time by hand: the region the app is served from (the database is in Mumbai), that a
 * cached service worker can still update itself, that staff cannot be left on a weeks-old panel
 * file, that TypeScript is still strict, and that `.vercelignore` cannot 404 the manager panel
 * again the way an unanchored `/editor` line once did.
 *
 * DELIBERATELY STATIC AND REPO-ONLY: it reads the files as text. No database, no login, no
 * network, no `.env.local`, no running app — so it runs in CI on every push, in every worktree,
 * with no key. Reading the source rather than importing it is on purpose: importing
 * `next.config.ts` would run `withSentryConfig` and need the Next toolchain.
 *
 *   node .github/scripts/verify-root-config.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const R = (p) => path.join(ROOT, p);
const read = (p) => readFileSync(R(p), "utf8");

let fails = 0;
const ok = (m) => console.log("  ✓ " + m);
const bad = (m, d) => { fails++; console.log("  ✗ " + m + (d ? "\n      " + d : "")); };
const want = (cond, good, badMsg, detail) => (cond ? ok(good) : bad(badMsg, detail));

/* ── next.config.ts — what every browser is told ──────────────────────────────────────── */
const NEXT = read("next.config.ts");

for (const [key, why] of [
  ["X-Content-Type-Options", "a browser second-guessing a Content-Type is how an upload becomes something else"],
  ["Referrer-Policy", "without it, a full URL of ours travels to every outside site a page links to"],
  ["Permissions-Policy", "without it, every device power the browser has is open to any script on the page"],
]) {
  want(new RegExp(`key:\\s*"${key}"`).test(NEXT),
    `every response still carries ${key}`,
    `next.config.ts no longer sends ${key}`, why);
}

// The three device powers the app really uses stay allowed; everything else stays off.
{
  const block = NEXT.match(/key:\s*"Permissions-Policy"[\s\S]{0,900}?\]\s*\.join/);
  const pol = block ? block[0] : "";
  const allowed = ["camera=(self)", "microphone=(self)", "geolocation=(self)"];
  const missing = allowed.filter((a) => !pol.includes(a));
  want(missing.length === 0,
    "the guest QR scanner, the voice note on an issue and the at-the-table check are all still allowed",
    `Permissions-Policy no longer allows: ${missing.join(", ")}`,
    "Turning one of these off does not warn anybody — the feature simply stops working on a phone. " +
    "camera → the guest QR scanner · microphone → the voice note on an issue · geolocation → the at-the-table check.");
  want(/payment=\(\)/.test(pol) && /usb=\(\)/.test(pol),
    "everything the app does not use is still switched off",
    "Permissions-Policy has stopped switching off the powers the app never asks for");
}

// The content policy is REPORT-ONLY on purpose. Flipping it is the owner's decision, not a tidy-up.
want(/key:\s*"Content-Security-Policy-Report-Only"/.test(NEXT) && !/key:\s*"Content-Security-Policy"/.test(NEXT),
  "the content policy is still REPORT-ONLY, as the owner parked it on 2026-08-16",
  "the content policy is no longer report-only",
  "Enforcing it is a real decision with a real failure mode: anything the allow-list misses stops loading, " +
  "on a live screen, mid-service, with nothing on the page to say why. docs/SECURITY-CHECKLIST.md §3 records " +
  "that he parked it. If this is deliberate, he said so — update this check in the same commit.");

// HSTS: production only, and never `preload`.
{
  // Match to the closing `];` of the ternary, NOT to the first semicolon: the header VALUE
  // itself contains one ("max-age=…; includeSubDomains"), and a lazy match stopped inside the
  // string — so the first draft of this check could not see a `preload` added right after it.
  const hsts = (NEXT.match(/const HSTS\s*=[\s\S]*?\]\s*:\s*\[\s*\]\s*;/) || [""])[0];
  want(/NODE_ENV\s*===\s*"production"/.test(hsts),
    "HSTS is still production-only, so `npm run dev` stays reachable",
    "HSTS is no longer gated on production",
    "A browser that learns 'localhost is HTTPS-only' makes the dev server unreachable, and undoing that " +
    "by hand in every developer's browser is genuinely painful.");
  want(!/preload/.test(hsts),
    "HSTS still carries no `preload`",
    "HSTS has gained `preload`",
    "preload submits the domain to a browser-vendor list that is slow to come back off. It is a commitment " +
    "about aevinite.shop, not a header tweak.");
}

// Which surfaces refuse to be framed — and the guest menu deliberately does not.
{
  const line = (NEXT.match(/const STAFF_PATHS\s*=\s*\[([^\]]*)\]/s) || [, ""])[1];
  const paths = [...line.matchAll(/"\/([\w-]+)/g)].map((m) => m[1]);
  const missing = paths.filter((p) => !existsSync(R(`app/${p}`)));
  want(paths.length > 0 && missing.length === 0,
    `all ${paths.length} framed-refusing surfaces are routes that exist`,
    `STAFF_PATHS names ${missing.length} route(s) that are not in this checkout: ${missing.join(", ")}`,
    "A header aimed at a path that does not exist protects nothing and reads as though it does.");
  want(!/"\/menu|"\/r\/|"\/q\//.test(line),
    "the guest menu is still left out of the frame refusal, on purpose",
    "the guest menu has been added to STAFF_PATHS",
    "These are restaurants with their own websites. The first one to put its menu in an iframe would find " +
    "it blank with no clue why, and nothing on the guest menu is private — so the header buys nothing and " +
    "can break a client's site. The reasoning is written above that line.");
  want(/X-Frame-Options"\s*,\s*value:\s*"SAMEORIGIN"/.test(NEXT),
    "the staff surfaces still refuse an OUTSIDE frame while the app can still frame itself",
    "the frame refusal is no longer SAMEORIGIN",
    "DENY would break every panel: /manager and /editor embed public/panels/editor/, the owner console " +
    "embeds the panel and the menu editor, and printing goes through a hidden iframe.");
}

// An outside image host is granted only if something actually loads from it.
{
  const hosts = [...NEXT.matchAll(/hostname:\s*"([^"]+)"/g)].map((m) => m[1]);
  const haystack = ["public/content/starter-menu.json", "lib/starterMenu.ts"]
    .filter((f) => existsSync(R(f))).map(read).join("\n");
  const unused = hosts.filter((h) => !haystack.includes(h) && !NEXT.includes(`// ${h}`));
  want(unused.length === 0,
    `all ${hosts.length} outside image host(s) granted are hosts the app really loads from`,
    `${unused.length} image host(s) are granted but nothing loads from them: ${unused.join(", ")}`,
    "A grant nobody uses is a permission nobody remembers giving. Remove it, or say in a comment what uses it.");
}

// …and the other direction: an outside host the app DOES load from must be granted.
{
  const hosts = [...NEXT.matchAll(/hostname:\s*"([^"]+)"/g)].map((m) => m[1]);
  const menu = existsSync(R("public/content/starter-menu.json")) ? read("public/content/starter-menu.json") : "";
  const used = [...new Set([...menu.matchAll(/https:\/\/([^/"]+)/g)].map((m) => m[1]))];
  const ungranted = used.filter((h) => !hosts.includes(h));
  want(ungranted.length === 0,
    `all ${used.length} outside host(s) the starter menu loads from are granted`,
    `${ungranted.length} host(s) the starter menu loads from are NOT in images.remotePatterns: ${ungranted.join(", ")}`,
    "public/content/starter-menu.json is the ready-made menu a BRAND-NEW restaurant starts with. An ungranted\n      " +
    "host costs nothing while dish cards render a plain <img> — and breaks the moment one moves to next/image,\n      " +
    "for brand-new restaurants only, which is the hardest case to notice. 62 of 72 photos were ungranted.");
}

// `root:` alone is not enough — `root: undefined` matched the first version of this check and
// left the workspace root un-pinned. Assert it RESOLVES to something.
want(/turbopack:\s*\{[\s\S]{0,200}root:\s*path\.(join|resolve)\(/.test(NEXT),
  "the workspace root is still pinned to this folder",
  "next.config.ts no longer pins turbopack.root",
  "A stray package-lock.json in the user's home folder otherwise makes the dev server infer the wrong root, " +
  "which has caused intermittent dev 500s.");

/* ── vercel.json — where it runs, and what a browser is allowed to keep ───────────────── */
{
  const V = JSON.parse(read("vercel.json"));
  want(JSON.stringify(V.regions) === '["bom1"]',
    "the app is still served from Mumbai, beside the database",
    `vercel.json serves from ${JSON.stringify(V.regions)}, not ["bom1"]`,
    "Every query would cross a continent and back. The database is in Mumbai.");
  const headers = JSON.stringify(V.headers || []);
  // NO `||` FALLBACK. The first version ended `|| /must-revalidate/.test(headers)`, so ANY other
  // rule carrying that word kept this green while /sw.js itself was given a year-long cache —
  // proven by breaking it. Find the /sw.js rule and read ITS header.
  const swRule = (V.headers || []).find((h) => /sw\.js/.test(h.source || ""));
  const swCache = (swRule?.headers || []).find((x) => /cache-control/i.test(x.key || ""))?.value || "";
  want(/must-revalidate/.test(swCache) && /max-age=0/.test(swCache),
    "the service worker is still served must-revalidate, so it can update itself",
    `vercel.json serves /sw.js with "${swCache || "no cache-control at all"}"`,
    "A cached service worker never updates. Every phone and tablet keeps running the old app, and there is " +
    "no way to push a fix to them.");
  want(/max-age=\d{1,3}\b/.test(headers),
    "panel files still carry a short cache, so staff cannot be left on a weeks-old panel",
    "vercel.json no longer gives the panel files a short max-age",
    "Staff run public/panels/* directly. A long cache leaves a tablet on last month's panel with no sign of it.");
}

/* ── .vercelignore — what is uploaded, and the line that once 404'd the manager panel ─── */
{
  const VI = read(".vercelignore");
  want(/^\/editor\b/m.test(VI),
    "the /editor exclusion is still anchored with a leading slash",
    ".vercelignore's /editor exclusion has lost its leading slash",
    "An unanchored `editor` matches public/panels/editor/ too, which 404'd the whole manager panel on every " +
    "deploy. The story is written into that file.");
  const md = VI.indexOf("/*.md"), keep = VI.indexOf("!/README.md");
  want(md >= 0 && keep > md,
    "README.md is still kept while the other root documents are excluded",
    ".vercelignore's README.md exception no longer follows the /*.md exclusion",
    "An exception written BEFORE its exclusion does nothing — order matters in this file.");
  want(!/^\/scripts\b/m.test(VI),
    "scripts/ is still uploaded, so the build's own prebuild step can run",
    ".vercelignore now excludes /scripts",
    "prebuild runs scripts/set-glb-cache.mjs. Excluding scripts/ removes the file the build is about to run.");
}

/* ── package.json — the port he looks at, and a prebuild that cannot fail a deploy ────── */
{
  const S = JSON.parse(read("package.json")).scripts;
  want(/\b4000\b/.test(S.dev || "") && /\b4000\b/.test(S.start || ""),
    "the app still comes up on port 4000 by default — the window the owner keeps open",
    `dev/start no longer default to port 4000 (dev: ${S.dev})`,
    "He checks localhost:4000. A different default means he is looking at a stale window and does not know it.");
  want(/\|\|\s*exit 0/.test(S.prebuild || ""),
    "prebuild still cannot fail a deploy",
    "package.json's prebuild no longer ends with `|| exit 0`",
    "It is a cache-warming step. Letting it fail turns a nice-to-have into an outage.");
  want(/tsconfig\.typecheck\.json/.test(S.typecheck || ""),
    "typecheck still uses its own config, so a stale .next/types cannot mask a real error",
    "npm run typecheck no longer uses tsconfig.typecheck.json");
}

/* ── tsconfig — strict, and the frozen snapshot stays out ─────────────────────────────── */
{
  const T = read("tsconfig.json");
  want(/"strict"\s*:\s*true/.test(T), "TypeScript is still strict",
    "tsconfig.json is no longer strict",
    "Strict is what makes `npm run typecheck` worth running at all.");
  want(/reference/.test(T), "the frozen pre-rewrite snapshot in reference/ is still excluded",
    "tsconfig.json no longer excludes reference/",
    "That folder is a snapshot of the old app. Type-checking it fails loudly and means nothing.");
}

/* ── .github/workflows/checks.yml — one red step must not hide the rest ──────────────────── */
// From 2026-10-04 main was red on `static guards`, and GitHub stops a job at its first red step —
// so `dependency advisories` never ran and two new high-rated advisories sat unreported behind it
// (sweep #10 T39 item 3). Every step after the install must carry the run-anyway condition.
{
  const W = read(".github/workflows/checks.yml");
  const steps = W.split(/\n      - /).slice(1).map((b) => "- " + b);
  const at = steps.findIndex((b) => /\bid:\s*install\b/.test(b) && /npm ci\b/.test(b));
  const after = at < 0 ? [] : steps.slice(at + 1).filter((b) => /\n\s+run:/.test(b));
  const COND = /\n\s+if:\s*\$\{\{\s*!cancelled\(\)\s*&&\s*steps\.install\.outcome\s*==\s*'success'\s*\}\}/;
  const missing = after.filter((b) => !COND.test(b)).map((b) => (b.match(/name:\s*([^\n]+)/) || [, b.slice(0, 40)])[1]);
  want(at >= 0 && after.length >= 8 && missing.length === 0,
    `every one of CI's ${after.length} checks still runs when an earlier check fails`,
    at < 0 ? "checks.yml has no `id: install` npm ci step to key the run-anyway condition on"
      : after.length < 8 ? `only ${after.length} check step(s) found after the install — the scan found nothing to judge`
      : `checks.yml step(s) without the run-anyway condition: ${missing.join(", ")}`,
    "GitHub stops at the first red step, so every check behind it goes silent and the page shows one failure where there are several.");
}

/* ── one Node version: the site, the checker and package.json (sweep #10 T39 item 52) ─────────── */
// The backup site builds on Vercel's Node 24.x and CI checked on Node 24, but nothing in the repo
// said so: the Vercel number lived only in its dashboard, and a change there would have made CI test
// on a different engine from the one the site runs. package.json's "engines" is the one place Vercel
// reads it from (it overrides the dashboard), so the repo now owns the number and CI must agree.
{
  const eng = (JSON.parse(read("package.json")).engines || {}).node || "";
  const W = read(".github/workflows/checks.yml");
  const ci = (W.match(/node-version:\s*["']?(\d+)/) || [])[1] || "";
  const engMajor = (eng.match(/^(\d+)/) || [])[1] || "";
  want(!!engMajor && engMajor === ci,
    `package.json engines (${eng}) and CI (Node ${ci}) name the same Node major — the one the site builds on`,
    `Node versions disagree: package.json engines "${eng || "(none)"}", CI node-version "${ci || "(none)"}"`,
    "Vercel builds with package.json's engines.node; CI must test on that same major or a green check means nothing for the site.");
}

/* ── the lint warning count can only go down (sweep #10 T39 item 65) ─────────────────────────── */
// 1,132 warnings (1,101 plus 31 in scripts/t17-harness, merged the same day) had piled up because nothing stopped the next one. `--max-warnings` makes a new
// one fail CI; this check stops the cap itself being quietly deleted or raised past the number it
// was set at.
{
  const lint = String(JSON.parse(read("package.json")).scripts?.lint || "");
  const cap = Number((lint.match(/--max-warnings[= ](\d+)/) || [])[1]);
  want(Number.isFinite(cap) && cap <= 115,
    `the lint script caps warnings at ${cap} (it may only go down from 115)`,
    `the lint script has no warning cap, or raised it: "${lint}"`,
    "Without the cap the warning count only ever grows; lower it when warnings are cleaned up, never raise it.");
}

console.log(fails
  ? `\n❌ verify-root-config — ${fails} problem(s) in the files that decide what the browser is told.`
  : "\n✅ verify-root-config — the browser headers, the region, the upload list and the build settings all still say what they are supposed to say");
process.exit(fails ? 1 : 0);
