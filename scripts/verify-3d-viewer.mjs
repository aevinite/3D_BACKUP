// verify:3d-viewer — the standing regression check for the 3D dish viewer and the dish page.
//
// Sweep #6, terminal 2 (2026-08-17). Every assertion below is a fault that was MEASURED on this
// app, fixed, and would otherwise come back the next time somebody tidies one of these files.
// It is a source-level guard on purpose: it needs no dev server, no database and no browser, so
// it can run in a pre-push hook and in CI in well under a second, and it can never leave a row
// behind. The behaviours that genuinely need a running app are covered by verify:cache and
// verify:slow-load; this file guards the *shape of the code* those two rely on.
//
//   node scripts/verify-3d-viewer.mjs
//
// Exit 0 = every check passed. Exit 1 = a fix has been undone.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const VIEWER = "app/view/[folder]/ViewerClient.tsx";
const PUBLIC_MV = "components/PublicModelViewer.tsx";
const LOADER = "lib/modelLoader.ts";
const ITEM_CLIENT = "app/item/[slug]/ItemClient.tsx";
const ITEM_PAGE_1 = "app/item/[slug]/page.tsx";
const ITEM_PAGE_R = "app/r/[restaurant]/item/[slug]/page.tsx";
const TENANT_STORAGE = "lib/tenantStorage.ts";
const MENU_VIEW = "components/MenuView.tsx";

const src = Object.fromEntries(
  [VIEWER, PUBLIC_MV, LOADER, ITEM_CLIENT, ITEM_PAGE_1, ITEM_PAGE_R, TENANT_STORAGE, MENU_VIEW].map((f) => [f, read(f)])
);

let failures = 0;
const ok = (msg) => console.log("  ok   " + msg);
const bad = (msg, why) => { failures++; console.log("  FAIL " + msg + "\n         → " + why); };
const check = (msg, pass, why) => (pass ? ok(msg) : bad(msg, why));

console.log("\n── the 3D screen ─────────────────────────────────────────────────────────────");

// 1. Every Add button in the app goes through the table gate. The 3D screen was the one that
//    did not, so a diner who had not joined their table had the dish accepted in silence and
//    only met the rule at Place Order.
check(
  "the 3D screen's Add to order calls gateAddToCart, like every other Add path",
  /import \{ gateAddToCart \} from "@\/lib\/tableConnection"/.test(src[VIEWER]) &&
    /const addToOrder = \(\) => \{[\s\S]*?gateAddToCart\(/.test(src[VIEWER]),
  `${VIEWER} → addToOrder must wrap the lfh:open-order-confirm dispatch in gateAddToCart(...), ` +
    "the same gate components/FoodCard.tsx, ItemClient.tsx and components/CartPanel.tsx use."
);

// 2. The loading panel is styled `position:fixed; inset:0; z-index:100` with an OPAQUE background
//    in app/globals.css, while #topbar and #bar are both z-index:30. Left alone it covers the BACK
//    button: a real tap hit #load and the address never changed.
{
  const m = src[VIEWER].match(/<div id="load" style=\{\{\s*zIndex:\s*(\d+)\s*\}\}>/);
  check(
    "the 3D loading panel sits UNDER the top bar, so BACK stays tappable while the model loads",
    !!m && Number(m[1]) < 30,
    `${VIEWER} → the <div id="load"> inside the main return needs an inline zIndex below 30 ` +
      "(#topbar and #bar are z-index:30 in app/globals.css; #load's own rule is z-index:100). " +
      (m ? `Found zIndex: ${m[1]}.` : "No inline zIndex found at all.")
  );
}

// 3. A slow model must not hide the dish. The bar carries the name, the price and the Add button,
//    all of which are already in memory long before the GLB arrives.
check(
  "the dish bar appears on its own when the model is slow (SLOW_BAR_GRACE_MS)",
  /SLOW_BAR_GRACE_MS\s*=\s*\d+/.test(src[VIEWER]) &&
    /setTimeout\(\(\) => \{ if \(!modelSeenRef\.current\) setBarVisible\(true\); \}, SLOW_BAR_GRACE_MS\)/.test(src[VIEWER]),
  `${VIEWER} → keep the grace-period effect that reveals #bar once menuItem is known and the ` +
    "model has not arrived. Without it the guest sees an opaque spinner and nothing else."
);

// 4. …but do not tell somebody to drag a model that is not on screen yet.
check(
  "the 'drag to turn it around' hint waits for the model, not just for the bar",
  /if \(!barVisible \|\| loaderVisible\) return;/.test(src[VIEWER]),
  `${VIEWER} → the hint effect must bail while loaderVisible is true, now that the bar can arrive ` +
    "before the model does."
);

// 5. The "your 3D is ready" ticket must name the dish the diner tapped, not the static config's
//    folder title (which belongs to restaurant #1's flagship) and not the raw folder slug.
check(
  "the 3D-ready ticket is titled from the LIVE menu item first",
  /title: menuItem\?\.title \|\| config\.title \|\| folder/.test(src[VIEWER]),
  `${VIEWER} → modelWatchlist.watch({ title: ... }) must prefer menuItem?.title. Measured before ` +
    'the fix: opening "Avocado & Cream Cheese" produced the ticket "Croissant Sandwich in 3D".'
);

// 6. /view has no /r/<slug> in its path, so the tab's tenant memory is the only thing keeping a
//    cold-opened 3D link's cart in the right restaurant. The key literal must match its owner.
{
  const owner = src[TENANT_STORAGE].match(/const LAST_SLUG_KEY = "([^"]+)"/);
  const used = src[VIEWER].match(/sessionStorage\.setItem\("([^"]+)", r\.slug\)/);
  check(
    "the 3D screen records the tab's restaurant under the SAME key lib/tenantStorage.ts owns",
    !!owner && !!used && owner[1] === used[1],
    `${TENANT_STORAGE} calls it ${owner ? `"${owner[1]}"` : "(not found)"}; ${VIEWER} writes ` +
      `${used ? `"${used[1]}"` : "(nothing)"}. They must be the same string, or a 3D link opened ` +
      "cold puts the diner's dish into restaurant #1's basket."
  );
}

console.log("\n── the <model-viewer> element ────────────────────────────────────────────────");

// 7. Without crossOrigin the preload Next emits and the module script disagree on credentials
//    mode, so the browser downloads the 253 KB file twice on the first 3D open.
// `<Script\s` (not `<Script`) so the prose "<Script>" in this file's own header comment cannot
// satisfy the check — it did, on the first draft, which would have made this guard decorative.
const scriptEl = (src[PUBLIC_MV].match(/<Script\s[\s\S]*?\/>/) || [""])[0];
check(
  "the model-viewer CDN script is fetched once, not twice (crossOrigin matches the preload)",
  /crossOrigin="anonymous"/.test(scriptEl),
  `${PUBLIC_MV} → the <Script> needs crossOrigin="anonymous". A <script type="module"> is always ` +
    "fetched in CORS mode; a preload without crossorigin is not, so the preloaded copy is thrown " +
    "away and the file arrives twice (measured: 2 × 253,368 bytes)."
);
check(
  "the CDN version stays pinned, never a floating latest",
  /model-viewer\/\d+\.\d+\.\d+\/model-viewer\.min\.js/.test(src[PUBLIC_MV]),
  `${PUBLIC_MV} → keep an explicit version in the CDN URL.`
);
check(
  "a blocked CDN still reaches the parent's onScriptError",
  /onError=\{\(\) => onScriptError\?\.\(\)\}/.test(src[PUBLIC_MV]) &&
    /onScriptError=\{\(\) => \{ if \(!modelSeenRef\.current\) setLoadFailed\(true\); \}\}/.test(src[VIEWER]),
  "Without this pair a network that blocks the CDN leaves the guest on a spinner forever."
);
check(
  'the element keeps id="mv" — verify:cache and verify:slow-load both select on it',
  /id: "mv"/.test(src[PUBLIC_MV]),
  `${PUBLIC_MV} → renaming this id silently blinds two other guards.`
);
check(
  'touch-action stays "none", so vertical orbit responds from the first touch',
  /"touch-action": "none"/.test(src[PUBLIC_MV]),
  `${PUBLIC_MV} → "pan-y" gives vertical gestures back to page-scroll and the dish stops turning.`
);

console.log("\n── the download-once loader ──────────────────────────────────────────────────");

check(
  "the loader is still a singleton on globalThis (this is what 'no re-fetch on navigation' IS)",
  /globalThis\.__lfh_modelLoader = loader/.test(src[LOADER]) &&
    /var __lfh_modelLoader: ModelLoader \| undefined/.test(src[LOADER]),
  `${LOADER} → one instance per tab, kept on globalThis, or every dish re-downloads its GLB.`
);
check(
  "calling a download off is not counted as a failed attempt",
  /const aborted = [\s\S]{0,160}"AbortError"/.test(src[LOADER]) && /if \(aborted\) \{\s*\n\s*calledOff = true;/.test(src[LOADER]),
  `${LOADER} → two aborts in one tab would otherwise mark a model permanently failed.`
);
check(
  "the cache is budgeted in BYTES and always keeps the model on screen",
  /MAX_BYTES = \d+ \* 1024 \* 1024/.test(src[LOADER]) && /this\.loaded\.size > 1 &&/.test(src[LOADER]),
  `${LOADER} → counting entries cannot bound memory when models are 2 MB to 9 MB, and evicting ` +
    "the last entry makes the viewer re-download what it is currently showing."
);
check(
  "a reconnect can revive a model the connection wrote off",
  /retryFailedOnReconnect\(\)\s*\{/.test(src[LOADER]) &&
    /window\.addEventListener\("online", wake\)/.test(src[LOADER]),
  `${LOADER} → without this a wi-fi handover during the two download attempts leaves the dish ` +
    'saying "3D view isn\'t ready" until the page is reloaded.'
);
check(
  "…and stopAll() clears `wanted`, so a 3D-OFF restaurant can never have a download revived",
  /stopAll\(\) \{[\s\S]{0,400}?this\.wanted = \[\];/.test(src[LOADER]),
  `${LOADER} → this clearing is the entire safety of retryFailedOnReconnect(). Without it the ` +
    "reconnect sweep would spend model bytes for a restaurant that has the feature switched off."
);
check(
  "…and `wanted` is bounded, so browsing all evening cannot grow it without limit",
  /MAX_WANTED = \d+/.test(src[LOADER]) && /this\.wanted\.slice\(-ModelLoader\.MAX_WANTED\)/.test(src[LOADER]),
  `${LOADER} → prioritize() appends once per dish opened; keep the cap.`
);
check(
  "the reconnect sweep is throttled, so one phone unlock is not three retries",
  /RECONNECT_COOLDOWN_MS/.test(src[LOADER]) && /now - this\.lastReconnectTry < ModelLoader\.RECONNECT_COOLDOWN_MS/.test(src[LOADER]),
  `${LOADER} → online, focus and visibilitychange all fire on a single unlock.`
);

console.log("\n── the dish page, both doors ─────────────────────────────────────────────────");

// The maintenance swap lives in AppShell, which the dish pages do not use.
for (const [file, label] of [[ITEM_PAGE_1, "restaurant #1's /item door"], [ITEM_PAGE_R, "the /r/<slug>/item door"]]) {
  check(
    `${label} closes for Service (maintenance) mode`,
    /settings\.serviceMode/.test(src[file]) && /Maintenance/.test(src[file]),
    `${file} → renders ItemClient WITHOUT AppShell, so nothing else applies the maintenance swap. ` +
      "A direct dish link stayed fully orderable while the restaurant was closed."
  );
  check(
    `${label} closes for the Menu master switch`,
    /menuEnabled\) notFound\(\)|!settings\.menuEnabled\) notFound\(\)/.test(src[file]),
    `${file} → gating only the menu list leaves every dish reachable by its own URL.`
  );
  check(
    `${label} does not preview a shared dish link while the menu is switched off`,
    /generateMetadata[\s\S]{0,1400}?menuEnabled[\s\S]{0,200}?return \{ title: "Menu"/.test(src[file]),
    `${file} → the page 404s but the link's preview card still showed the dish, its photo and its ` +
      "price to whoever it was forwarded to."
  );
  check(
    `${label} answers 404 for a dish that does not exist`,
    /getMenuItem\([\s\S]{0,60}?\.catch\(\(\) => null\)\)\) notFound\(\)/.test(src[file]),
    `${file} → a friendly card inside a 200 tells search engines and our own monitoring that the ` +
      "page is real."
  );
}

// The veg/non-veg mark must mean the same thing on the grid and on the dish page.
check(
  "the dish page hides the veg/non-veg mark on a single-diet menu, exactly as the grid does",
  /const dietMeaningful =/.test(src[ITEM_CLIENT]) && /\{showDiet && \(/.test(src[ITEM_CLIENT]) &&
    /const dietMeaningful =/.test(src[MENU_VIEW]),
  `${ITEM_CLIENT} → derive showDiet the same way ${MENU_VIEW} derives dietShown, or a pure-veg ` +
    "restaurant shows no mark in the grid and one the moment a dish is opened."
);

// The two guest 404 pages are twins on purpose.
check(
  "the two guest not-found pages for the dish routes have not drifted apart",
  read("app/item/[slug]/not-found.tsx").trim() === read("app/r/[restaurant]/item/[slug]/not-found.tsx").trim(),
  "app/item/[slug]/not-found.tsx and app/r/[restaurant]/item/[slug]/not-found.tsx must stay identical."
);

// Every overlay on these screens registers with the back-button manager.
check(
  "the dish page's photo lightbox and the 3D details sheet both register with the back manager",
  /useBackClose\("item-zoom"/.test(src[ITEM_CLIENT]) && /useBackClose\("viewer-info"/.test(src[VIEWER]),
  "CLAUDE.md: every popup registers useBackClose the moment it is built — never hand-rolled " +
    "pushState/popstate."
);

console.log("\n══════════════════════════════════════════════════════════════════════════════");
if (failures) {
  console.log(`❌ ${failures} check(s) failed — a 3D-viewer fix has been undone.\n`);
  process.exit(1);
}
console.log("✅ PASS — the 3D dish viewer and both dish-page doors still behave as fixed.\n");
