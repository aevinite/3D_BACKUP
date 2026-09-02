// Sweep #8 · T5 round 2 · band R5 (P95151–P95200) — SABOTAGE.
//
// This repo's own recorded lesson is that a guard is judged by BREAKING what it defends, never by
// reading it: "a guard can stay GREEN when you break what it defends" and "a guard can pass against
// its own comment" are both in the memory index, and round 1 of this very terminal found a guard
// that had asserted nothing for weeks. So every fix this terminal shipped, and every guard it
// extended, is deliberately broken here and the guard has to go RED.
//
//   node scripts/sweep/t5/round2-sabotage.mjs
//
// EVERY FILE IS RESTORED, on success, on failure, and on Ctrl-C. Nothing is left mutated.
import { check, report, ROOT } from "./lib.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const originals = new Map();
const save = (f) => { const p = path.join(ROOT, f); if (!originals.has(f)) originals.set(f, fs.readFileSync(p, "utf8")); };
const restoreAll = () => { for (const [f, body] of originals) fs.writeFileSync(path.join(ROOT, f), body); originals.clear(); };
for (const sig of ["SIGINT", "SIGTERM", "uncaughtException"])
  process.on(sig, (e) => { restoreAll(); if (e) console.error(e); process.exit(1); });

/** Break `file` by replacing `from` with `to`, run EVERY runner, and hand back whether one went red.
 *
 * Both runners are always used. The first version named ONE per case and a third of the run came
 * back "the guard stayed GREEN" — which was true of the runner I happened to point at, and false
 * of the product: the check that catches it lived in the other file. A sabotage band that has to
 * guess where its own coverage lives is measuring my bookkeeping, not the guards. */
function sabotage(file, from, to, cmd, argsList) {
  save(file);
  const p = path.join(ROOT, file);
  const body = originals.get(file);
  if (!body.includes(from)) return { applied: false, red: false, why: `the sabotage target is not in ${file}` };
  fs.writeFileSync(p, body.replace(from, to));
  let red = false, out = "", caughtBy = "";
  try {
    for (const args of argsList) {
      try { execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
      catch (e) { red = true; caughtBy = args[0]; out = String(e.stdout || "") + String(e.stderr || ""); break; }
    }
  } finally { fs.writeFileSync(p, body); }
  return { applied: true, red, out, caughtBy };
}
const node = process.execPath;
// Every case is run against BOTH of this terminal's runners plus whichever repo guard is named.
const BOTH = [["scripts/sweep/t5/static.mjs"], ["scripts/sweep/t5/round2.mjs"]];
const S = BOTH, R2 = BOTH;
const withGuard = (g) => [[g], ...BOTH];

// R5's slice is P95151-95195 (see the band map in round2.mjs).
let id = 95151;
const CASES = [
  // ── the six fixes this terminal shipped ──
  ["item 1 — /pair back in the guest chrome", "components/GuestChrome.tsx",
    '"owner", "pair"]', '"owner"]', withGuard("scripts/verify-guest-doors.mjs")],
  ["item 1 — the whole staff list emptied", "components/GuestChrome.tsx",
    'const STAFF_SEGMENTS = ["aevinite"', 'const STAFF_SEGMENTS = ["zzz-nothing"', withGuard("scripts/verify-guest-doors.mjs")],
  ["item 3 — a dead dictionary key put back", "lib/i18n.ts",
    "  noMatch: string;", "  prepTime: string;\n  noMatch: string;", withGuard("scripts/verify-i18n-scope.mjs")],
  ["item 4 — the note on the dead never-cache patterns removed", "public/sw.js",
    "MATCHES NOTHING TODAY", "was here once", S],
  ["item 5 — the opening name's wrap taken away", "components/IntroSplash.tsx",
    'flexWrap: "wrap",', 'flexWrap: "nowrap",', R2],
  ["item 5 — the word groups collapsed back to loose letters", "components/IntroSplash.tsx",
    "if (ch.isSpace) { out.push(cur); cur = []; }", "// no grouping", R2],
  ["item 6 — the offline card back on the registered name", "components/AppShell.tsx",
    'stripBrandMarkers(logoText || "").trim() || (brandName || "").trim()', '(brandName || "").trim()', S],
  ["item 8 — the app-up preflight taken out again", "scripts/verify-t24b-live.mjs",
    'await requireUp(BASE, "the T24 money-rules live walk");', "// no preflight", withGuard("scripts/verify-guards-alive.mjs")],
  ["a guest's chosen language wiped by restaurant #1's list", "components/Header.tsx",
    "if (!ready) return;\n    if (menuLangs && menuLangs.length", "if (menuLangs && menuLangs.length",
    withGuard("scripts/verify-guest-doors.mjs")],
  ["the header back on the bare id, so it reads #1 on every tenant page", "components/Header.tsx",
    "const { id: restaurantId, ready } = useRestaurantMeta();", "const restaurantId = useRestaurantMeta().id, ready = true;",
    withGuard("scripts/verify-guest-doors.mjs")],
  ["the rule DELETED instead of gated, so a guest keeps a switched-off language", "components/Header.tsx",
    "if (menuLangs && menuLangs.length && !menuLangs.includes(getLanguage().code)) setLanguage(menuLangs[0] as LanguageMeta[\"code\"]);",
    "/* removed */", withGuard("scripts/verify-guest-doors.mjs")],
  // ── the offline layer's own promises ──
  ["a write no longer freshens the reads that follow it", "public/sw.js",
    "lastWriteAt[apiFamily(u.pathname)] = Date.now();", "/* forgotten */", S],
  ["a forced Refresh answered from the device", "public/sw.js",
    "{ noFallback: true, clientId: event.clientId }", "{ clientId: event.clientId }", S],
  ["the stale window opened to a week", "public/sw.js",
    "const MAX_STALE_MS = 2 * 60 * 60 * 1000;", "const MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;", S],
  ["the branded page's cache folded back into the wiped one", "public/sw.js",
    "const FALLBACK = `lfh-fallback-${VERSION}`;", "const FALLBACK = SHELL;", S],
  ["a sign-in route allowed into the saved reads", "public/sw.js",
    "/^\\/api\\/(staff-)?login/, ", "", S],
  ["ignoreVary dropped, so every saved read silently misses", "public/sw.js",
    "cache.match(key, { ignoreVary: true, ...(opts || {}) })", "cache.match(key, opts || {})", S],
  ["the table number back in the saved page's key", "public/sw.js",
    'const TABLE_PARAMS = ["table", "t"];', "const TABLE_PARAMS = [];", R2],
  ["big media raced against a timeout again", "public/sw.js",
    'isBigMedia = (p) => p.startsWith("/models/")', "isBigMedia = (p) => false && p.startsWith(\"/models/\")", R2],
  // ── the last-resort page ──
  ["the way out taken off the no-internet page", "public/offline.html",
    '<button type="button" class="act ghost" id="home">', '<button type="button" class="act ghost" id="nohome">', S],
  ["the retry loop's handle dropped, so every 'online' adds a timer", "public/offline.html",
    "if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }", "/* no handle */", S],
  ["the jitter removed, so every device in the room retries in lockstep", "public/offline.html",
    "Math.round(wait * (0.75 + Math.random() * 0.5))", "wait", S],
  ["the page allowed to name a cause it has not tested", "public/offline.html",
    '<p class="why-line" id="why"></p>', '<p class="why-line" id="why">No internet right now</p>', S],
  ["the meter given a request of its own", "public/offline.html",
    "sawProbe: function (p) {", "sawProbe: function (p) { fetch('/api/health');", S],
  // ── the guest surfaces ──
  ["the offline strip promising a queue on a screen with none", "components/OfflineNotice.tsx",
    'Changes you make now may not save until you\'re back.', "Anything you send is saved and goes by itself.", S],
  ["the strip made tappable, so it swallows the button under it", "components/OfflineNotice.tsx",
    'pointerEvents: "none",', 'pointerEvents: "auto",', S],
  ["the exit guard taken off the printed QR menu", "components/BackQuitDialog.tsx",
    "const QR_MENU = /^\\/q\\/[^/]+\\/?$/;", "const QR_MENU = /^\\/zzz$/;", R2],
  ["the exit guard taken off the tenant menu", "components/BackQuitDialog.tsx",
    "const TENANT_MENU = /^\\/r\\/[^/]+\\/menu\\/?$/;", "const TENANT_MENU = /^\\/zzz$/;", R2],
  ["a dish card advertising 3D it cannot deliver", "components/FoodCard.tsx",
    "item.is4d && features.model3d && item.modelSmallUrl && item.modelOptimizedUrl",
    "item.is4d && features.model3d", S],
  ["the per-dish ceiling dressed as a success again", "components/FoodCard.tsx",
    'variant: "info", duration: 1400', "duration: 1400", S],
  ["an invented prep time back on every card", "components/FoodCard.tsx",
    'features.prep_time ? (item.time || "") : ""', 'features.prep_time ? (item.time || "25-30 min") : ""', R2],
  ["the guest socket unscoped from its restaurant", "components/RealtimeProvider.tsx",
    "if (rid && evRid && evRid !== rid) return;", "/* keep everyone's */", S],
  ["the idle drop taken off the guest socket", "components/RealtimeProvider.tsx",
    "const IDLE_MS = 120000;", "const IDLE_MS = 1e12;", S],
  ["the settings poll sped past the 60-second backstop", "components/AppShell.tsx",
    "}, 60000);", "}, 5000);", R2],
  ["the shared cart's poll sped past it too", "components/SessionCartSync.tsx",
    "iv = setInterval(tick, RT_BACKUP_MS);", "iv = setInterval(tick, 2000);", R2],
  ["a storage read left unwrapped, so a phone with cookies off gets an error screen", "lib/i18n.ts",
    'try {\n    return (localStorage.getItem("lfh_language") as LanguageCode) || "en";\n  } catch {\n    return "en";\n  }',
    'return (localStorage.getItem("lfh_language") as LanguageCode) || "en";', withGuard("scripts/verify-i18n-scope.mjs")],
  // Aimed at the INPUT, not at the header comment that explains it. `String.replace` takes the
  // FIRST match, and this file's own note says "tabIndex={-1} means it cannot be reached with the
  // Tab key" — so the first version of this case broke a sentence and left the code untouched,
  // then reported the guard as asleep. Same trap this repo has recorded three times, met from the
  // other side: a SABOTAGE can hit a comment too.
  ["the trap field made reachable by Tab", "components/BotTrap.tsx",
    'name={BOT_TRAP_FIELD}\n        defaultValue=""\n        tabIndex={-1}', 'name={BOT_TRAP_FIELD}\n        defaultValue=""\n        tabIndex={0}', S],
  ["a toast host added, so the app has two notification surfaces", "components/MiniCart.tsx",
    'window.addEventListener("lfh:cart-updated", onCart);',
    'window.addEventListener("lfh:toast", onCart);\n    window.addEventListener("lfh:cart-updated", onCart);', R2],
  ["a class rendered with no rule anywhere", "components/VegIcon.tsx",
    'className="veg-box"', 'className="veg-box-typo"', R2],
  ["an event fired that nothing listens for", "components/ChefCallButton.tsx",
    'new Event("lfh:chef-call")', 'new Event("lfh:nobody-listens")', R2],
  ["a helper imported that is not exported", "components/MiniCart.tsx",
    'import { unitDisplay, formatAmount, getCurrency, type CurrencyMeta } from "@/lib/format";',
    'import { unitDisplay, formatAmount, getCurrency, notARealExport, type CurrencyMeta } from "@/lib/format";', R2],
  ["a guest widget lazily imported that does not exist", "components/GuestChrome.tsx",
    'import("@/components/MiniCart")', 'import("@/components/MiniCartTypo")', R2],
  ["the offline strip un-muted on the panel hosts, so two bars say the same thing", "components/OfflineNotice.tsx",
    "/^\\/(manager|kitchen|tablet)(\\/|$)/.test(path)", "false", R2],
  ["the last-resort page's brand check dropped, so A's name can show on B's screen", "public/offline.html",
    'if (String(stored.slug || "").toLowerCase() !== restSlug) return;', "/* trust it */", S],
];
for (const [why, file, from, to, cmd] of CASES) {
  const r = sabotage(file, from, to, node, cmd);
  check(`P${id++}`, `SABOTAGE — ${why} — is caught`, () =>
    (r.applied && r.red) || (!r.applied ? r.why : "NOTHING went red with the fault put back — no guard covers this"));
}
const touchedAtStart = new Map(originals);
restoreAll();
// Nothing may be left mutated — proved, not assumed.
check(`P${id++}`, "every file this band broke is byte-identical again afterwards", () => {
  // `--porcelain` lists UNTRACKED files too, and this band's own new scripts are untracked — so
  // the first version reported itself. Only a MODIFIED tracked file means something was left broken.
  // Compared against what this band SAVED, not against git — a file edited for other reasons in
  // the same working tree is not something this band left broken.
  const bad = [...touchedAtStart].filter(([f, body]) => fs.readFileSync(path.join(ROOT, f), "utf8") !== body);
  return bad.length === 0 || `left modified: ${bad.map(([f]) => f).join(", ")}`;
});
((id <= 95196) || (() => { throw new Error(`R5 overran its slice: it ended at P${id}`); })(), report("T5 round 2 — R5 sabotage"));
