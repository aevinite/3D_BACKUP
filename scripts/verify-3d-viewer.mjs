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
const VIEW_PAGE = "app/view/[folder]/page.tsx";
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

// The 3D route has no /r/<slug> in its path, so the tab pin is the ONLY thing that tells the rest
// of the app which restaurant a cold-opened 3D link belongs to — and it has to be there before React
// runs, because lib/restaurant-context.tsx reads it once, in an effect, on first mount.
{
  const src2 = read(VIEW_PAGE);
  check(
    "the 3D route pins the tab's restaurant BEFORE hydration, like app/q/[code] does",
    /sessionStorage\.setItem\("lfh_tab_tenant"/.test(src2) && /dangerouslySetInnerHTML/.test(src2),
    `${VIEW_PAGE} → without the inline script, a cold /view link leaves lib/restaurant-context.tsx ` +
      "on restaurant #1: it reads the pin once in an effect, and ViewerClient's own stamp is async " +
      "and lands later. Every body-level widget then reads the wrong restaurant's settings."
  );
  // ?r= is whatever a stranger put in a link. JSON.stringify does NOT escape "/", so interpolating
  // the raw value would let "</script>" close the tag early.
  check(
    "…and it pins the DATABASE's slug, never the raw ?r= from the address bar",
    /getRestaurantBySlug\(r\)/.test(src2) && /pinned\?\.slug/.test(src2) &&
      !/setItem\("lfh_tab_tenant",\$\{JSON\.stringify\(String\(r\)/.test(src2),
    `${VIEW_PAGE} → resolve the slug first and pin the resolved value. Interpolating the raw search ` +
      'param into a <script> lets a link containing "</script>" break out of the tag.'
  );
  check(
    "…with a character check on the slug as well",
    /\/\^\[a-z0-9-\]\+\$\/\.test\(pinned\.slug\)/.test(src2),
    `${VIEW_PAGE} → keep the [a-z0-9-] test, so nothing but a real slug shape can ever reach the script.`
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
    // Two shapes are both correct, and the second is the one item 9 introduced: the row this read
    // returns is now KEPT and handed to ItemClient instead of being thrown away. What matters is
    // that a missing dish reaches notFound(), not which spelling gets it there — asserting the
    // old spelling turned this guard red on an improvement that made the behaviour better.
    (/getMenuItem\([\s\S]{0,60}?\.catch\(\(\) => null\)\)\) notFound\(\)/.test(src[file]) ||
      (/const dish = await getMenuItem\(/.test(src[file]) && /if \(!dish\) notFound\(\)/.test(src[file]))),
    `${file} → a friendly card inside a 200 tells search engines and our own monitoring that the ` +
      "page is real. Either `if (!(await getMenuItem(...))) notFound()` or `const dish = await " +
      "getMenuItem(...); if (!dish) notFound()` satisfies this."
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

// A tap on Add to Cart must be Add to Cart, right to its edge (owner, 2026-08-17). The prev/next
// strips are fixed, full height and z-index 49, so without this the button's last 8px navigated away.
check(
  "the dish page's button rows sit ABOVE the prev/next dish strips, so Add owns its own edge",
  /const BTN_ROW_ABOVE_NAV_STRIPS = \{ position: "relative" as const, zIndex: (\d+) \}/.test(src[ITEM_CLIENT]) &&
    Number(src[ITEM_CLIENT].match(/BTN_ROW_ABOVE_NAV_STRIPS = \{ position: "relative" as const, zIndex: (\d+) \}/)[1]) > 49 &&
    Number(src[ITEM_CLIENT].match(/BTN_ROW_ABOVE_NAV_STRIPS = \{ position: "relative" as const, zIndex: (\d+) \}/)[1]) < 60 &&
    (src[ITEM_CLIENT].match(/BTN_ROW_ABOVE_NAV_STRIPS/g) || []).length >= 3,
  `${ITEM_CLIENT} → both .btn-row elements need BTN_ROW_ABOVE_NAV_STRIPS, and its zIndex must sit ` +
    "between .dish-nav-strip (49) and .item-addbar (60) in app/globals.css. Measured before the fix: " +
    "the last 8px of the 304px-wide Add to Cart button hit .dish-nav-strip.next."
);

// The pinned add bar is a phone-and-tablet shortcut. On a laptop it floats over the description.
//
// THE NUMBER IS CHECKED, NOT JUST THE NAME (sweep #8 T2, 2026-09-02 — item 9). This read
// `/const PINNED_BAR_MAX_WIDTH = (\d+)/` — which captures the digits and then throws them away, so
// `= 99999` satisfied it exactly as well as `= 1024` while putting the bar back on every laptop.
// PROVEN by sabotage: setting it to 99999 left this guard GREEN. A breakpoint outside this range is
// not a tuning choice, it is the fix being switched off, so the range is deliberately generous
// (480 = a large phone, 1200 = past every tablet) and only a value that defeats it fails.
const PINNED_BAR_PX = Number((src[ITEM_CLIENT].match(/const PINNED_BAR_MAX_WIDTH = (\d+)/) || [])[1]);
check(
  "the pinned Add bar is limited to phone/tablet widths",
  Number.isFinite(PINNED_BAR_PX) && PINNED_BAR_PX >= 480 && PINNED_BAR_PX <= 1200 &&
    /matchMedia\(`\(max-width: \$\{PINNED_BAR_MAX_WIDTH\}px\)`\)/.test(src[ITEM_CLIENT]) &&
    /includes\("sold-out"\) && barFitsScreen && \(/.test(src[ITEM_CLIENT]),
  `${ITEM_CLIENT} → PINNED_BAR_MAX_WIDTH is ${PINNED_BAR_PX}px; it must be a real phone/tablet ` +
    "breakpoint (480–1200), and its live matchMedia and the barFitsScreen condition must stay on the " +
    "bar. Measured at 1280×800 before the fix: the bar sat at y=754 covering two lines of " +
    '"About this dish".'
);
check(
  "…and that media query is a live listener, not a one-off read (a tablet rotates)",
  /mq\.addEventListener\("change", read\)/.test(src[ITEM_CLIENT]) && /mq\.addListener\(read\)/.test(src[ITEM_CLIENT]),
  `${ITEM_CLIENT} → support both MediaQueryList listener forms; older WebKit has only addListener, ` +
    "and losing the listener there would freeze the bar at whatever the first paint decided."
);

// ── a labelled section never appears with nothing under it (sweep #8 T2, item 4) ─────────────
// The nutrition row, the About card and the allergens block all already hide themselves when empty
// (the MENU1 rule). The INGREDIENTS heading inside the expanded description was the one exception.
check(
  "the dish page's INGREDIENTS heading only appears when there are ingredients",
  (read(ITEM_CLIENT).match(/descExpanded && \(item\.ingredients\?\.length \?\? 0\) > 0/g) || []).length >= 2,
  "app/item/[slug]/ItemClient.tsx: both the heading and its row must test the list, or a dish with " +
    "a description and no ingredients prints a label over a blank strip."
);

// ── the heart tells the truth even when the dish page's second read never lands (item 3) ─────
// This read used to be a passenger on the main fetch's .then(...). Since item 9 the server hands
// the dish down, so the page renders in full even when the browser's re-read stalls — and on that
// path the heart was left at false on a dish the guest had saved. MEASURED: tapping it then wrote
// the same id twice, and the next tap removed both.
{
  const ic = read(ITEM_CLIENT);
  check(
    "the dish page reads its saved-dishes list in its own effect, not inside the dish fetch",
    /useEffect\(\(\) => \{\s*\n\s*if \(!item\?\.id\) return;[\s\S]{0,900}?\}, \[item\?\.id\]\);/.test(ic) &&
      !/setFavorited\(favorites\.includes\(dish\?\.id\)\)/.test(ic),
    "app/item/[slug]/ItemClient.tsx: the heart must not depend on the client re-read resolving, " +
      "or a stalled read shows an empty heart on a dish the guest already saved."
  );
  check(
    "…and it follows a change made elsewhere in the same tab",
    /addEventListener\("lfh:favorites-updated", read\)/.test(ic) &&
      /removeEventListener\("lfh:favorites-updated", read\)/.test(ic),
    "the heart listens for the same event this page fires, and removes the listener on unmount."
  );
  check(
    "…and saving a dish that is already in the list cannot write it twice",
    /\} else if \(!favorites\.includes\(item\.id\)\) \{/.test(ic),
    "app/item/[slug]/ItemClient.tsx: toggleFavorite must not push an id the list already holds — " +
      "a duplicate is then removed two-at-a-time by the next tap."
  );
}

// ── the way out of the zoomed photo stays tappable (sweep #8 T2, item 2) ─────────────────────
// `.img-lightbox-close` is position:absolute with no z-index, and the photo under it carries a
// transform, which makes its own stacking context and paints on top once it is scaled up. MEASURED:
// at 1x elementFromPoint at the X's centre is the X; at 2.5x and 5x it is the photo. Backdrop-tap
// is deliberately off while zoomed, so the X is the only way out.
check(
  "the photo lightbox's close button sits above the zoomed photo",
  /className="img-lightbox-close"\s*\n\s*style=\{\{ zIndex: 1 \}\}/.test(read(ITEM_CLIENT)),
  "app/item/[slug]/ItemClient.tsx: the lightbox X needs its own z-index, or a zoomed photo covers " +
    "it and a tap on the only way out merely un-zooms the picture."
);

// ── a tenant never inherits restaurant #1's static demo config (sweep #8 T2, item 1) ─────────
// public/content/items/ holds restaurant #1's own two legacy demo dishes. The 3D route is
// /view/<folder>, and the folder name is whatever an owner typed — so a second restaurant that
// calls its folder "Croissant" scored a hit on #1's file. MEASURED: /view/Croissant?r=aangan-…
// served #1's model, #1's dish name and #1's three hotspot cards under Aangan's own colour.
{
  const v = read(VIEWER);
  check(
    "the 3D screen reads the static /content config only when it really is restaurant #1",
    /rid !== DEFAULT_RESTAURANT_ID\s*\)\s*\{\s*setConfig\(\{\}\)/.test(v),
    "app/view/[folder]/ViewerClient.tsx must refuse `/content/items/<folder>/config.json` for any " +
      "restaurant other than #1, or a folder-name collision serves the flagship's dish to a tenant."
  );
  check(
    "…and it waits until the restaurant is actually resolved before deciding that",
    /if \(!ridReady\) return;/.test(v) && /\[folder, rid, ridReady\]/.test(v),
    "`rid` starts at restaurant #1 and resolves async, so the config effect must be gated on " +
      "`ridReady` and depend on it — otherwise the first pass decides as though it were #1."
  );
  check(
    "…and a restaurant lookup that fails says 'not available' rather than falling through to #1",
    /getRestaurantBySlug\(fromRestaurant\)\.catch\(\(\) => null\)/.test(v),
    "a rejected getRestaurantBySlug left `unavailable` unset and `ridReady` never true."
  );
}

// ── BACK and AR are big enough for a thumb (owner's item 8, 2026-09-02) ──────────────────────
// The height is declared in THREE places, and the last two carry `!important`, so moving one alone
// changes nothing on screen. verify:slow-load measures the RENDERED box; this is the fast half that
// catches the three drifting apart.
{
  const css = read("app/globals.css");
  const heights = (css.match(/\.viewer-wrapper \.tbtn\{\s*\n\s*height:(\d+)px/) || [])[1];
  const overrides = (css.match(/  height:44px !important;/g) || []).length;
  check(
    "the 3D screen's BACK and AR buttons are declared at 44px in all three places",
    heights === "44" && overrides === 2,
    "app/globals.css: .viewer-wrapper .tbtn is " + heights + "px and " + overrides + " of the two " +
      "`height:44px !important` overrides (.back-btn, .ar-btn) are in place. All three must agree, " +
      "or the two controls on the flagship screen go back under the 44px a thumb needs."
  );
}

// ── a dead dish link names no platform brand in the tab either (owner's item 7, 2026-09-02) ──
// The screen has been white-label since 2026-08-04; its <head> was not. Next discards a route's
// generateMetadata when the page calls notFound(), so BOTH doors fell back to the root layout's
// "Aevidine — Restaurant OS" and the platform's sales description — in the browser tab, and in the
// preview card of any forwarded link. This is the fast, server-free half; verify:notfound drives
// the served document, which is what catches the framework changing its mind.
check(
  "the guest dish 404 sets its own brand-free title instead of falling back to the platform's",
  /export const metadata = \{\s*\n\s*title: "Menu",/.test(read("app/item/[slug]/not-found.tsx")),
  "app/item/[slug]/not-found.tsx (and its twin) must carry a `metadata` export, or a stale dish " +
    "link reads 'Aevidine — Restaurant OS' in a diner's browser tab and previews as our sales pitch."
);

// The two guest 404 pages are twins on purpose.
check(
  "the two guest not-found pages for the dish routes have not drifted apart",
  read("app/item/[slug]/not-found.tsx").trim() === read("app/r/[restaurant]/item/[slug]/not-found.tsx").trim(),
  "app/item/[slug]/not-found.tsx and app/r/[restaurant]/item/[slug]/not-found.tsx must stay identical."
);

// ── the animation loop must die with the screen (sweep #7 T2, item 1) ─────────────────────────
// MEASURED on the dish page, twenty seconds after leaving the 3D screen: SIX connector-line loops
// still running at 360 animation frames a second, forever. `requestRef` holds only the LATEST
// frame handle, so cancelling it stops one chain; and `handleLoad` scheduled the reveal 800 ms
// later on a timer nobody cleared, so leaving inside that window STARTED a loop after the screen
// had already gone — a chain whose handle no live component holds, and which therefore never ends.
// The window is an ordinary one: glance at the dish, tap Back.
console.log("\n── the 3D screen's animation loop ends when the screen does ──────────────────");
check(
  "the connector-line loop refuses to re-arm once the 3D screen has gone",
  /const aliveRef = useRef\(true\)/.test(src[VIEWER]) &&
    /const _loop = \(\) => \{[\s\S]{0,400}?if \(!aliveRef\.current\) return;/.test(src[VIEWER]),
  `${VIEWER} → _loop() re-arms itself with requestAnimationFrame every frame. It must return ` +
    "early on !aliveRef.current, or a chain started near unmount runs for the life of the tab."
);
check(
  "…and aliveRef is set true on mount as well, so Strict Mode's remount cannot disable the lines",
  /useEffect\(\(\) => \{ aliveRef\.current = true; return \(\) => \{ aliveRef\.current = false; \}; \}, \[\]\)/.test(src[VIEWER]),
  `${VIEWER} → React's development Strict Mode mounts, unmounts and remounts once. A flag only ` +
    "ever turned off by a cleanup stays off for the real mount, which would kill the hotspot lines."
);
check(
  "every timer handleLoad starts is cleared when the model effect is torn down",
  /const timers: ReturnType<typeof setTimeout>\[\] = \[\]/.test(src[VIEWER]) &&
    /timers\.push\(setTimeout\(runFullSequence, 800\)\)/.test(src[VIEWER]) &&
    /timers\.forEach\(clearTimeout\)/.test(src[VIEWER]),
  `${VIEWER} → handleLoad's 800 ms reveal timer and 1 s bar timer must be collected and cleared ` +
    "in the effect's cleanup. The 800 ms one is what starts the immortal loop.",
);

// ── the server hands the dish down instead of the phone asking twice (owner's item 9) ─────────
{
  const code = src[ITEM_CLIENT].replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check(
    "the dish page starts from the dish the server already read",
    /initialItem\?: FoodItem \| null/.test(code) &&
      /useState<FoodItem \| null>\(initialItem \?\? null\)/.test(code) &&
      /useState\(!initialItem\)/.test(code),
    ITEM_CLIENT + " \u2192 both routes read this row on the server to decide the 404. Starting " +
      "state from it is what removes the spinner and what makes an offline reload show the dish."
  );
  for (const [label, file] of [["restaurant #1's /item", ITEM_PAGE_1], ["the /r/<slug>/item", ITEM_PAGE_R]]) {
    check(
      label + " door keeps the dish it read and hands it down",
      /const dish = await getMenuItem\(/.test(src[file]) && /if \(!dish\) notFound\(\)/.test(src[file]) &&
        /initialItem=\{dish\}/.test(src[file]),
      file + " \u2192 do not throw the 404 check's own read away. `if (!(await getMenuItem(...)))` " +
        "discards the row and the phone then fetches it again."
    );
  }
  check(
    "…and the browser does NOT read it a second time on a first load",
    /initialItem && retryNonce === 0\s*\n?\s*\? Promise\.resolve\(initialItem\)/.test(code),
    ITEM_CLIENT + " \u2192 skip the duplicate read when the server just supplied it, but NOT when " +
      "retryNonce > 0: Try again must reach the database or the button is a lie."
  );
  check(
    "…the price does not read $ on a rupee menu in the first paint",
    /useState<CurrencyMeta \| null>\(DEFAULT_CURRENCY\)/.test(code),
    ITEM_CLIENT + " \u2192 the currency state must START at DEFAULT_CURRENCY. It was null, and " +
      "every price falls back to `$` while it is \u2014 invisible behind the old spinner, but the " +
      "first thing on screen once the server renders the dish, and PERMANENT on an offline reload " +
      "where React never boots. getCurrency() is SSR-safe and returns the same value, so hydration matches."
  );
  check(
    "…and a client re-read that comes back empty cannot blank a page the server rendered",
    /setItem\(dish \|\| initialItem \|\| null\)/.test(code),
    ITEM_CLIENT + " \u2192 the re-read is a refresh, not the authority on whether the dish exists."
  );
  check(
    "…and the reviews read asks the RESOLVED switches, not useFeatures' first-render defaults",
    /const real = await getFeatures\(restaurantId\)/.test(code) &&
      /if \(!real \|\| !real\.reviews \|\| !real\.ratings\)/.test(code),
    ITEM_CLIENT + " \u2192 handing the dish down means `item` is set on the FIRST render, when " +
      "useFeatures() still returns FEATURE_DEFAULTS (ratings and reviews both true). Measured right " +
      "after item 9 landed: French House, which has ratings off, was reading its review rows again " +
      "on every dish open \u2014 the exact fault item 5 had just fixed, walked back in by an " +
      "unrelated change. getFeatures() cannot answer with a default it has not verified."
  );
}

// ── the server-rendered dish obeys the RESTAURANT'S switches, not the code defaults ───────────
// (Finishing item 9.) useFeatures' first value is FEATURE_DEFAULTS, where ratings and reviews are
// both true. That was invisible behind the old spinner; once the server renders the dish it is the
// first thing on screen, and on a reload with no signal — where React never boots — it is the ONLY
// thing. Measured: French House, which has ratings OFF, had a five-star row in its own page's HTML.
{
  const feat = read("lib/features.ts");
  check(
    "useFeatures can be seeded with the switches a server component already read",
    /seed\?: Record<string, boolean> \| null/.test(feat) &&
      /cached\.get\(restaurantId\) \|\| \(seed \?/.test(feat),
    "lib/features.ts \u2192 keep the optional seed. The cache must still win over it, and the " +
      "effect must still re-read and subscribe, so a live toggle behaves exactly as before."
  );
  check(
    "…and the seed is the RAW settings bag, so a server component needs no import from that file",
    !/export function featuresFromSettings/.test(feat),
    "lib/features.ts imports useEffect, which makes it unimportable from a server component. " +
      "Exporting a helper here to build the map went blank with \"You're importing a module that " +
      "depends on useEffect into a React Server Component\". Pass settings.features itself."
  );
  for (const [label, file] of [["restaurant #1's /item", ITEM_PAGE_1], ["the /r/<slug>/item", ITEM_PAGE_R]]) {
    check(
      label + " door hands its restaurant's switches down with the dish",
      /initialFeatures=\{settings\.features\}/.test(src[file]),
      file + " \u2192 the settings row is already read on this route; pass its features bag so the " +
        "first paint and the offline view obey the same switches the live screen does."
    );
  }
  check(
    "…and the dish page seeds the hook with them",
    /useFeatures\(restaurantId, initialFeatures\)/.test(src[ITEM_CLIENT]),
    ITEM_CLIENT + " \u2192 without the seed the server builds the page with ratings and reviews " +
      "both on, whatever the restaurant chose."
  );
}

// ── the offline warning survives a reload with no signal (owner's item 11) ────────────────────
// After an offline reload the client JavaScript never boots, so components/OfflineNotice.tsx cannot
// render and a diner got a page frozen mid-load with no explanation. The static bar is a plain
// inline script, which is the one thing still standing.
{
  const stat = read("components/OfflineNoticeStatic.tsx");
  check(
    "there is a no-framework offline bar for the case where React never boots",
    /export default function OfflineNoticeStatic/.test(stat) && /navigator\.onLine===false/.test(stat),
    "components/OfflineNoticeStatic.tsx \u2192 it must be a plain inline <script>, not a component " +
      "that needs hydration. Measured: after an offline reload, --lfh-offbar-h is never set, a " +
      "synthetic 'offline' event does nothing and a click does nothing."
  );
  check(
    "…it refuses to draw whenever React's own bar is alive, checked on EVERY signal change",
    /function reactOwnsIt\(\)/.test(stat) && /navigator\.onLine===false && !reactOwnsIt\(\)/.test(stat),
    "components/OfflineNoticeStatic.tsx \u2192 the check belongs inside sync(), not only in a " +
      "start-up watch. An earlier version watched for five seconds, and a diner whose signal " +
      "dropped later than that got BOTH bars, one under the other, saying different things."
  );
  check(
    "…and nothing dynamic is interpolated into it",
    !/\$\{(?!JSON\.stringify\(BAR_ID\))/.test(stat.split("const SCRIPT")[1] || ""),
    "components/OfflineNoticeStatic.tsx \u2192 the inlined script must stay a fixed literal. The " +
      "only interpolation allowed is the hardcoded BAR_ID; a value from the address bar or the " +
      "database would need resolving and character-checking first, as app/view/[folder]/page.tsx does."
  );
  for (const [label, file] of [["restaurant #1's /item", ITEM_PAGE_1], ["the /r/<slug>/item", ITEM_PAGE_R], ["the /view", VIEW_PAGE]]) {
    check(
      label + " route renders the no-framework offline bar",
      /<OfflineNoticeStatic \/>/.test(read(file)),
      file + " \u2192 a guest can reload this screen with no signal, so it needs the bar that works " +
        "without React."
    );
  }
}

// ── two callers, one read of the category list (sweep #7 T2, owner's item 12) ─────────────────
// Both readers of a dish page ask activeCategorySlugs the same question in the same tick, so the
// same query hit the same table twice. Shared via the in-flight promise — and deliberately with NO
// cache, because the guest menu's `menu` breadcrumb reads back through here and a TTL would let a
// switched-off category keep showing its dishes.
{
  const menu = read("lib/menu.ts");
  const code = menu.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check(
    "the active-category read is shared between the dish page's two callers",
    /const catSetInflight = new Map<string, Promise<Set<string> \| null>>\(\)/.test(code) &&
      /const pending = catSetInflight\.get\(restaurantId\)/.test(code) &&
      /catSetInflight\.delete\(restaurantId\)/.test(code),
    "lib/menu.ts \u2192 activeCategorySlugs must share its in-flight promise. Without it the dish " +
      "page reads the categories table twice per open, measured 4\u00d7 against every other read's 2\u00d7."
  );
  check(
    "…and it holds NO cache, so a switched-off category still reaches a browsing guest at once",
    !/catSetCache/.test(code) && !/CATEGORY_SET_TTL_MS/.test(code),
    "lib/menu.ts \u2192 do not put a TTL in front of activeCategorySlugs. The guest menu's `menu` " +
      "breadcrumb reads back through it (MenuView \u2192 refreshMenu \u2192 getMenuItems), and T13 " +
      "already lost this exact fight for settings: a cache in front of a breadcrumb is how these " +
      "updates die (mig 299). In-flight sharing fixes the duplication with no staleness at all."
  );
}

// ── the dish page's two error cards are centred by INLINE STYLE, not by a utility class ──────
// (sweep #7 T2, item 7.) Measured on the running page: with `flex flex-col items-center
// justify-center min-h-genscreen p-4` on the container, `#detail-page` still computed to
// `padding: 70px 0 0`, `align-items: normal`, `justify-content: normal`, and the heading sat at
// x=0 — hard against the side of a 360px phone. `#detail-page` is an ID selector in
// app/globals.css and Tailwind 4 puts its utilities in a layer those author rules outrank, so the
// classes are inert here. An inline style cannot lose.
{
  const code = src[ITEM_CLIENT];
  check(
    "the dish page's error cards are laid out inline, so the cascade cannot flatten them",
    /const ERROR_CARD_LAYOUT: React\.CSSProperties/.test(code) &&
      (code.match(/style=\{ERROR_CARD_LAYOUT\}/g) || []).length === 2,
    ITEM_CLIENT + " \u2192 both the timed-out card and the not-found card must use " +
      "ERROR_CARD_LAYOUT. Tailwind's centring utilities are outranked by #detail-page in " +
      "app/globals.css, so a card that relies on them renders flush-left with no padding."
  );
  check(
    "…and neither of them has gone back to relying on those utilities",
    !/item-detail-page flex flex-col items-center justify-center min-h-screen p-4/.test(code),
    ITEM_CLIENT + " \u2192 that class string looks like it centres the card and does not."
  );
}

// ── a screen must never spin forever (sweep #7 T2, item 6) ───────────────────────────────────
// Measured with the dish page's data reads held open: "PLATING YOUR DISH" at 2s, 5s, 10s, 20s and
// 35s — a spinner with no dish, no honest word and no way out. Every read on this screen now has a
// deadline, and past it the guest gets a card that says so, with Try again and Back to menu.
{
  const code = src[ITEM_CLIENT].replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const DEADLINE_MS = Number((code.match(/const DISH_READ_DEADLINE_MS = (\d+)/) || [])[1]);
  check(
    "the dish page puts a deadline on its own read, so it can never spin forever",
    // THE NUMBER IS CHECKED, NOT JUST THE NAME (sweep #8 T2, 2026-09-02 — item 9). `\d+` matched
    // `= 0` just as happily as `= 8000`, and a zero deadline trips on EVERY load — the honest
    // "we couldn't load this dish" card would replace a dish that was arriving perfectly well.
    // PROVEN by sabotage: setting it to 0 left this guard green. 3–20s is the range in which this
    // is a patience timer at all; outside it, it is either a hair-trigger or never fires.
    Number.isFinite(DEADLINE_MS) && DEADLINE_MS >= 3000 && DEADLINE_MS <= 20000 &&
      /const deadline = setTimeout\(/.test(code) &&
      /setReadTimedOut\(true\)/.test(code) && /setLoading\(false\)/.test(code),
    ITEM_CLIENT + " \u2192 DISH_READ_DEADLINE_MS is " + DEADLINE_MS + "ms; it must be a real patience " +
      "window (3000–20000) and the timer that trips it must stay. Too small and every load shows the " +
      "failure card; absent and a stalled read leaves the guest on 'Plating your dish' with no way out."
  );
  check(
    "…the deadline is cleared when the reply lands, and when the screen goes",
    /landed = true;\s*\n\s*clearTimeout\(deadline\)/.test(code) &&
      /return \(\) => \{ cancelled = true; clearTimeout\(deadline\); \}/.test(code),
    ITEM_CLIENT + " \u2192 a reply that beats the deadline must cancel it, and leaving the page must too."
  );
  check(
    "…a late reply still wins, so the screen heals itself",
    /setReadTimedOut\(false\)/.test(code),
    ITEM_CLIENT + " \u2192 when the read finally lands, clear the honest card rather than making " +
      "the guest tap Try again for something that has already arrived."
  );
  check(
    "…and the honest card is not the 'dish not found' one, which would be a lie",
    // Anchored to the RENDER branches by their own markup, not to the first `if (!item)` in the
    // file: item 9's reviews effect legitimately opens with `if (!item) { setLocalReviews([]);`,
    // which sits far earlier and made a naive index comparison fail on a correct file.
    (() => {
      const timedOut = code.indexOf("if (!item && readTimedOut)");
      const notFound = code.indexOf("if (!item) {\n    return (");
      return timedOut > -1 && notFound > -1 && timedOut < notFound;
    })(),
    ITEM_CLIENT + " \u2192 the timed-out branch must come FIRST and say something about the " +
      "connection. 'Dish not found' would send a diner looking for a dish that is on the paper " +
      "menu in front of them."
  );
  check(
    "…and Try again really re-reads",
    /setRetryNonce\(\(v\) => v \+ 1\)/.test(code) && /\[slug, restaurantId, retryNonce\]/.test(code),
    ITEM_CLIENT + " \u2192 the retry counter must be a dependency of the fetch, or the button does nothing."
  );
}

// ── do not fetch what no switch will let you draw (sweep #7 T2, item 5) ──────────────────────
// The review fetch was keyed on `features.reviews` alone, but every surface that DRAWS a review is
// behind `features.ratings && features.reviews`. Measured on French House, which has reviews on and
// ratings off: one `reviews` read per dish open, limit 20, for a section that returns null.
{
  const code = src[ITEM_CLIENT].replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check(
    "the dish page only fetches reviews when BOTH switches let it show them",
    /const reviewsCanBeSeen = !!features\.reviews && !!features\.ratings/.test(code) &&
      /const real = await getFeatures\(restaurantId\)/.test(code) &&
      /if \(!real \|\| !real\.reviews \|\| !real\.ratings\)/.test(code) &&
      /\}, \[item, restaurantId, reviewsCanBeSeen\]\)/.test(code),
    ITEM_CLIENT + " \u2192 gate getItemReviews on the same pair the display uses, AND ask the " +
      "resolved switches rather than useFeatures' first-render defaults. Keying it on " +
      "features.reviews alone makes a ratings-off restaurant pay for 20 review rows on every dish " +
      "open and render none of them; keying it on the hook's first value does the same thing now " +
      "that the server hands the dish down on render one."
  );
  // …and the display condition must not drift away from the fetch condition.
  check(
    "…and the condition that DRAWS them still asks for the same two switches",
    /const normalOn = features\.ratings && features\.reviews/.test(code),
    ITEM_CLIENT + " \u2192 if `normalOn` ever stops requiring both, the fetch gate above becomes " +
      "wrong in the other direction and a restaurant would show an empty review list."
  );
}

// ── a maintenance restaurant does not preview its dish either (sweep #7 T2, item 4) ──────────
// Both doors already RETURN the maintenance screen for Service mode. Both doors' generateMetadata
// checked only the Menu master switch — so the page said "we'll be right back" while the same link
// pasted into WhatsApp still previewed the dish, its photo and its price. The 3D screen beside them
// has treated the two switches as one meaning since 2026-08-04.
for (const [label, file] of [["restaurant #1's /item", ITEM_PAGE_1], ["the /r/<slug>/item", ITEM_PAGE_R]]) {
  // STRIP THE COMMENTS FIRST. Both of these files EXPLAIN this rule in prose right above the
  // line that enforces it, so a naive /serviceMode/ match passes on the explanation alone — the
  // guard would stay green with the fix torn out. Assert the enforcement, never the comment.
  const meta = (src[file].split("export async function generateMetadata")[1]?.split("export default")[0] || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  check(
    label + " door does not preview a shared dish link while the restaurant is in Service mode",
    /settings\.serviceMode/.test(meta),
    file + " \u2192 generateMetadata must refuse on settings.serviceMode as well as !menuEnabled. " +
      "The page body already does; the share card is the half that was left open."
  );
}

// ── every scoped read is keyed on the thing that scopes it (sweep #7 T2, item 3) ─────────────
// Both reads in the dish page's main fetch are scoped by `restaurantId`, but it was missing from
// the dependency list, so the fetch only re-ran on a slug change. `/r/<a>/item/x` → `/r/<b>/item/x`
// is the same route pattern with the same slug, so React reconciles ItemClient in place instead of
// remounting it — and it would keep restaurant A's dish, price and menu list under B's address.
check(
  "the dish page's main fetch re-runs when the RESTAURANT changes, not only the dish",
  // Assert that BOTH are in the list, not that the list is exactly those two — a later fix
  // legitimately added `retryNonce` (item 6) and an exact match turned this red for no fault.
  (() => {
    const m = /\}, \[slug,([^\]]*)\]\);/.exec(src[ITEM_CLIENT]);
    return !!m && /\brestaurantId\b/.test(m[1]);
  })(),
  `${ITEM_CLIENT} → the effect calling getMenuItem(slug, restaurantId) and ` +
    "getMenuItems(restaurantId, CARD_COLUMNS) must depend on BOTH. The reviews effect and the " +
    "Google-settings effect beside it already do."
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
