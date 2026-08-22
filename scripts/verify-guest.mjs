#!/usr/bin/env node
// verify-guest.mjs — the GUEST-EXPERIENCE sweep, as a repeatable command.
//
// WHY THIS FILE EXISTS
//   The 500-phase guest sweep (.claude/sweep/T1-phases.md) was executed twice by hand, and a
//   throwaway harness was rebuilt both times. Everything mechanical about it lives here now, so
//   "re-run the guest tests" is one command instead of an afternoon — and so every finding it has
//   already caught stays caught. Each check names the sweep phase it comes from.
//
// USAGE
//   node scripts/verify-guest.mjs                          # static checks only (instant, no server)
//   node scripts/verify-guest.mjs --base http://localhost:4310   # + behavioural checks in a browser
//   node scripts/verify-guest.mjs --base https://3-d-backup.vercel.app
//
// TWO HALVES, DELIBERATELY
//   STATIC  — assertions over the source. Comments are STRIPPED first: on the first run three
//             checks "failed" only because my own comments mentioned the very brand they were
//             asserting was absent. A source assertion must never be satisfiable by prose.
//   LIVE    — a real Chromium at 360x780 (the owner's A35). Reading the code cannot catch a
//             frosted panel that lost its blur, a back button that leaves the site, or a request
//             that 404s — all three were real findings that only behaviour exposed.
//
// It NEVER writes: no DB changes, no settings flips, no logins, no orders. Feature-switch
// behaviour therefore can't be observed here; those checks assert the render gate in the source.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : "";
const results = [];
const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), "utf8"); } catch { return null; } };
// Strip comments so a check can't be satisfied — or defeated — by prose ABOUT the bug.
const code = (p) => { const s = read(p); if (!s) return null;
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
          .replace(/^\s*\/\/.*$/gm, "").replace(/([^:"'`\\])\/\/[^\n"'`]*$/gm, "$1"); };
const has = (s, ...n) => n.every((x) => s && s.includes(x));
const rx  = (s, r) => !!(s && r.test(s));
const check = (phase, name, fn) => {
  let ok = false, note = "";
  try { const r = fn(); if (r && typeof r === "object") { ok = !!r.ok; note = r.note || ""; } else ok = !!r; }
  catch (e) { ok = false; note = "threw: " + e.message; }
  results.push({ phase, name, ok, note });
};

// ── the 20 findings this sweep has already caught: never let one back in ──────────────────
const F = {
  menuView: code("components/MenuView.tsx"), cart: code("components/CartPanel.tsx"),
  tracker: code("components/OrderTracker.tsx"), ocm: code("components/OrderConfirmModal.tsx"),
  food: code("components/FoodCard.tsx"), bqd: code("components/BackQuitDialog.tsx"),
  notice: code("components/OfflineNotice.tsx"), pmv: code("components/PublicModelViewer.tsx"),
  viewer: code("app/view/[folder]/ViewerClient.tsx"), item: code("app/item/[slug]/ItemClient.tsx"),
  legacy: code("app/item/[slug]/page.tsx"), q: code("app/q/[code]/page.tsx"),
  sgate: code("components/SessionGate.tsx"), menuLib: code("lib/menu.ts"),
  navp: code("components/NavPicker.tsx"),
  css: read("app/globals.css"), offHtml: read("public/offline.html"), sw: read("public/sw.js"),
};

check(246, "the printed table QR /q/<code> arms the back-button exit guard", () =>
  has(F.bqd, "QR_MENU", "QR_MENU.test(p)"));
check(428, "backdrop-filter is written unprefixed — the build adds -webkit- itself", () => {
  const n = (F.css.match(/-webkit-backdrop-filter/g) || []).length;
  return { ok: n === 0, note: n ? n + " hand-added prefixes (the build DROPS the real property)" : "clean" };
});
check("17-19", "/q honours the Menu switch, default layout and dark default", () =>
  has(F.q, "settings.menuEnabled", "menuDefaultLayout", 'menuDefaultMode === "dark"'));
check("28-29", "guest 404s use the guest page (no platform brand, no /login link)", () => {
  const g = code("components/GuestNotFound.tsx");
  const bs = ["app/r/[restaurant]/menu/not-found.tsx", "app/r/[restaurant]/item/[slug]/not-found.tsx", "app/item/[slug]/not-found.tsx"];
  return { ok: !!g && bs.every((b) => has(code(b), "GuestNotFound")) && !rx(g, /href="\/"/), note: bs.length + " boundaries" };
});
check("12-13", "legacy /item honours the Menu switch and 404s a missing dish", () =>
  rx(F.legacy, /menuEnabled\) notFound/) && rx(F.legacy, /getMenuItem\(slug\)[\s\S]{0,40}notFound\(\)/));
check("473-474", "a guest can correct a wrong table number, and the dead sheet is gone", () =>
  has(F.cart, "live-order-fixlink", "saveOrderTable") && !has(F.tracker, "ot-sheet"));
check("158-161", "a switched-off category's dishes are filtered in the data layer", () =>
  has(F.menuLib, "activeCategorySlugs", "inLiveCategory"));
check("24-27", "the viewer honours the Menu switch + maintenance, and never falls back to #1's dish", () =>
  has(F.viewer, "s.menuEnabled", "s.serviceMode") && rx(F.viewer, /if \(!r\) \{[^}]*setUnavailable\(true\)/));
check(303, "the offline strip promises a queue on GUEST paths only", () =>
  has(F.notice, "(menu|item)") && !rx(F.notice, /setHasQueue\(\/\^\\\/r\\\/\/\.test/));
check("122-127", "allergies and notes are gated at the SEND site, not only where they're saved", () =>
  has(F.cart, "allergyPayload", "orderItems") &&
  has(F.cart, "features.allergies ? it.removed : undefined", "features.guest_note ? it.note : undefined"));
check(110, "reviews are only fetched once the switch has resolved", () =>
  rx(F.item, /!features\.reviews\) \{ setLocalReviews/) && rx(F.item, /features\.reviews\]\)/));
check(110, "getMenuItem no longer pulls a review list nothing reads", () =>
  !has(F.menuLib, "mapped.reviews = revs"));
check("394-395", "no internal dev text on a guest 3D screen", () =>
  !has(F.pmv, "config.json") && !has(F.pmv, "Supabase") && !rx(F.viewer, /\{error\}<\/p>/));
// This asserted the literal `item.is4d && features.model3d ? "is-4d"` until 2026-08-12, when that
// test got STRICTER: the badge, the cube icon and the card styling now also require the model FILES
// to exist, because a dish ticked "4D" before its model was uploaded was advertising a 3D view that
// could not open (guest sweep T1; owner: *"do the problem nine also"*). So the guard checks the
// INVARIANT — one derived value, gated on the switch AND both files, used by all three — rather than
// one spelling of it. Checking the string is what made the sibling guard below read FAIL against
// better code.
check(115, "the 4D badge, icon and card styling all follow ONE test: switch on AND both model files present", () => {
  const def = /const has3d = !!\(item\.is4d && features\.model3d && item\.modelSmallUrl && item\.modelOptimizedUrl\)/.test(F.food || "");
  const uses = (F.food.match(/has3d \?/g) || []).length;      // is-4d class, badge, cube icon
  const noBareGate = !rx(F.food, /item\.is4d && features\.model3d \?/); // nothing gated on the tick alone
  return { ok: def && uses >= 3 && noBareGate, note: `def=${def} uses=${uses} noBareGate=${noBareGate}` };
});
// The "off" branch became stopAll() on 2026-08-04 — setQueue([],[],[],[]) only emptied the WAITING
// LINE, so a GLB already in flight still finished downloading. This guard kept asserting the OLD
// call and so read FAIL against the better code; it asserts the switch-then-queue order, not the
// one function that implements it.
check(111, "the menu waits for the REAL 3D switch before queueing any GLB", () =>
  has(F.menuView, "getFeatures(restaurantId)") && rx(F.menuView, /model3d === false\) \{ modelLoader\.stopAll\(\)/));
check(163, "the item_ratings read carries a .limit()", () =>
  rx(F.menuLib, /from\("item_ratings"\)[\s\S]{0,220}?\.limit\(/));
check(497, "offline.html and sw.js share the #retry/#home contract", () =>
  has(F.offHtml, 'id="retry"', 'id="home"') && has(F.sw, 'id="retry"', 'id="home"'));
check(472, "no dead screens left in the table gate", () =>
  !rx(F.sgate, /step === "name_first"/) && !rx(F.sgate, /step === "request_name"/));
check("19-cleanup", "OrderTracker keeps no orphaned hook after the sheet was deleted", () =>
  !has(F.tracker, "useFeatures") && !has(F.tracker, "showPrice"));

// ── the standing project rules for the guest surface ─────────────────────────────────────
check("426-427", "globals.css comments balance and carry no conflict markers", () => {
  let i = 0; const s = F.css;
  while (i < s.length) { if (s.slice(i, i + 2) === "/*") { const j = s.indexOf("*/", i + 2); if (j < 0) return { ok: false, note: "unclosed comment" }; i = j + 2; } else i++; }
  return !/^(<<<<<<<|>>>>>>>|=======)$/m.test(s);
});
check("247-256", "every guest overlay registers with the back-button manager", () => {
  const want = { "components/CartPanel.tsx": '"cart"', "components/OrderConfirmModal.tsx": '"order-confirm"',
    "components/ChefPopup.tsx": '"chef-popup"', "components/SessionGate.tsx": '"session-gate"',
    "components/SessionOwner.tsx": '"session-owner"', "app/item/[slug]/ItemClient.tsx": '"item-zoom"',
    "app/view/[folder]/ViewerClient.tsx": '"viewer-info"', "components/ConnectionBadge.tsx": '"conn-badge"' };
  const missing = Object.entries(want).filter(([f, id]) => !has(code(f), `useBackClose(${id}`)).map(([f]) => f.split("/").pop());
  return { ok: missing.length === 0, note: missing.length ? "missing: " + missing.join(", ") : Object.keys(want).length + " overlays" };
});
check(261, "no guest component hand-rolls history outside the two managers", () => {
  const files = ["components/CartPanel.tsx", "components/OrderConfirmModal.tsx", "components/ChefPopup.tsx",
    "components/SessionGate.tsx", "components/OrderTracker.tsx", "components/MenuView.tsx",
    "app/item/[slug]/ItemClient.tsx", "app/view/[folder]/ViewerClient.tsx"];
  const bad = files.filter((f) => rx(code(f), /history\.(pushState|replaceState)|addEventListener\("popstate"/));
  return { ok: bad.length === 0, note: bad.join(",") || "clean" };
});
check("72-77", "every per-restaurant guest key goes through tenant-scoped storage", () => {
  const want = { "components/FoodCard.tsx": ["lfh_cart"], "components/MiniCart.tsx": ["lfh_cart"],
    "components/Header.tsx": ["lfh_cart"], "lib/orderStatus.ts": ["lfh_active_orders"],
    "app/item/[slug]/ItemClient.tsx": ["lfh-favorites"], "lib/table.ts": ["lfh_table"] };
  const bad = [];
  for (const [f, keys] of Object.entries(want)) for (const k of keys)
    if (rx(code(f), new RegExp(`localStorage\\.(get|set|remove)Item\\(\\s*["'\`]${k}`))) bad.push(`${f}:${k}`);
  return { ok: bad.length === 0, note: bad.join(", ") || "all scoped" };
});
check("162-170", "guest reads are scoped, column-listed and capped", () =>
  has(F.menuLib, '.eq("restaurant_id", restaurantId)', ".limit(2000)", ".limit(300)"));
check("321-330", "guests subscribe to the menu topic only, scoped per restaurant", () =>
  has(F.menuView, "useRealtime({ menu:") && has(code("lib/useRealtime.ts"), '"topic_rid=eq."'));
check("44-48", "restaurant #1's branding never leaks onto another tenant", () =>
  has(F.menuView, "isDefault ? t.greeting", "isDefault ? t.heroTitle") &&
  has(code("components/IntroSplash.tsx"), 'isDefault && <img className="intro-logo"'));

// ── sweep #6 / T1 (2026-08-17): four more that must never come back ───────────────────────
const T1 = { menuPage: code("app/r/[restaurant]/menu/page.tsx") };

// ONE RESTAURANT, ONE ADDRESS. getRestaurantBySlug folds case, so /r/French-House/menu resolves —
// but lib/tenantStorage derives its scope from the RAW path, so the cart, the scanned table, the
// favourites and the session landed under "French-House" while MenuView's own browse state used
// "french-house". Measured: /menu?table=4 on the capitalised link wrote `lfh_table:French-House`,
// and the menu's own dish links are built from r.slug — so the first dish tapped moved the guest to
// the lower-case address, where getScannedTable() returns "". The door canonicalises instead.
// ASSERT THE RULE, NOT WHERE THE CODE HAPPENS TO SIT (sweep #6 / T28, 2026-08-22). This wanted
// "URLSearchParams" and "qs.append" IN THE MENU PAGE. The query-building was then factored out into
// `queryStringOf()` in lib/tenant.ts — deliberately, so the two redirects on this page (a moved
// address and a mis-cased one) cannot drift apart on carrying `?table=N`. Nothing about the guest's
// experience changed, and the check went red on the tidier code. What must hold is the behaviour: the
// door redirects to the canonical slug, and the query goes with it — wherever the builder lives.
check("P00155", "an oddly-cased menu link is sent to the canonical one, query and all", () => {
  const guard = rx(T1.menuPage, /if \(restaurant !== r\.slug\)/);
  const redirects = rx(T1.menuPage, /redirect\(`\/r\/\$\{r\.slug\}\/menu\$\{queryStringOf\(await searchParams\)\}`\)/);
  // …and the builder it hands the query to really does carry EVERY parameter across, arrays included.
  const tenant = code("lib/tenant.ts");
  const builder = has(tenant, "export function queryStringOf", "new URLSearchParams", "qs.append");
  return { ok: guard && redirects && builder, note: `guard=${guard} redirect=${redirects} builder=${builder}` };
});

// A menu that isn't serving must not preview as an open one. app/q/[code] always did this; the
// tenant door advertised the name, tagline and logo whatever the state was, then landed the guest
// on "This menu isn't available right now".
check("P00165", "a not-serving menu previews neutrally on the tenant door too", () =>
  rx(T1.menuPage, /if \(!r\.active \|\| !\w+\.menuEnabled\)[\s\S]{0,120}?title: "Menu"/));

// THE BELL STAYS PUT — R29 (owner, 2026-08-17): "i want like previous bell of call waiter should be
// stuck at his place we can scrool and click the thing make sure don't change that again."
// Sweep T1 built the opposite (stand down when nothing is clean) and it was reverted on his word.
// This guard is here so the next person who measures the overlap does not "fix" it a second time:
// the fallback must stay a plain return-to-the-corner, and the bell must never be hidden, faded or
// made untappable. Comments are stripped before this runs, so the R29 note above cannot satisfy it.
check("R29", "the call-waiter bell is never hidden, faded or made untappable", () => {
  const bellArea = (F.menuView.match(/const settleBell[\s\S]*?\n    \};/) || [""])[0];
  const banned = [/visibility/, /pointer-events/, /yieldBell/, /opacity/, /display\s*=/, /\.hidden\b/]
    .filter((r) => r.test(bellArea)).map((r) => String(r));
  const fallbackIntact = /bell\.style\.removeProperty\("--bell-lift"\);\s*\n\s*\};/.test(bellArea);
  return { ok: banned.length === 0 && fallbackIntact,
    note: banned.length ? "bell is being hidden/faded: " + banned.join(", ") : `fallback intact=${fallbackIntact}` };
});

// Two guest surfaces that describe themselves to a screen reader as something they are not. The
// category chips were corrected in 2026-08-12 (tablist with no tabpanel); the search suggestions
// were still a listbox with no `option` inside it, and the sold-out pill swallowed the card link.
check("P00488", "the guest menu describes its own widgets honestly", () => {
  const chips = has(F.menuView, 'role="group"') && !rx(F.menuView, /role="tablist"/);
  const sugg = !rx(F.menuView, /className="search-dropdown"\s+role="listbox"/) &&
               rx(F.menuView, /className="search-dropdown"[\s\S]{0,140}?role="group"/);
  return { ok: chips && sugg, note: `chips=${chips} suggestions=${sugg}` };
});

// AN EXPLICIT ROLE REPLACES THE ELEMENT'S OWN ONE (guest sweep T1, sweep #7, 2026-08-22).
// Fixing the suggestions panel in 2026-08-17 put `role="listitem"` on each <Link>, which took the
// LINK role away from every row: read out of Chrome's accessibility tree, the panel held eight
// listitems and not one link, while 58 other links on the page listed normally. A blind diner
// skimming by links could not reach the search results at all. The panel is a labelled GROUP of
// links now — the same pattern the category chip row uses — so the count is still spoken and the
// rows are links again (measured: 8 of 8, page links 58 → 66).
check("P15514", "every search suggestion is still a link", () =>
  !rx(F.menuView, /className="search-result"\s*\n?\s*role=/) &&
  rx(F.menuView, /className="search-dropdown"[\s\S]{0,140}?aria-label=\{`\$\{searchResults\.length\} matching/));

// …AND A LISTBOX MUST OWN ITS OPTIONS DIRECTLY. Same shape, never looked for in NavPicker: each
// `role="option"` button sat inside an <li>, so Chrome computed `listbox "Language"` containing
// plain BUTTONS and zero options — no selectable items, no "3 of 6" position, and `aria-selected`
// (the only thing marking the language you are on) never conveyed. Dropping the <li> is the whole
// change; the CSS already made the buttons full-width, so nothing moved on screen.
check("P15517", "the language and currency lists really do contain options", () => {
  const noLi = !rx(F.navp, /<li key=\{opt\.key\}>/) && !rx(F.navp, /<li[\s>]/);
  const owns = has(F.navp, 'role="listbox"', 'role="option"', "aria-selected={opt.active}");
  return { ok: noLi && owns, note: `options are direct children=${noLi} roles present=${owns}` };
});
check("P00143", "the sold-out pill no longer swallows the card's own link", () =>
  !rx(F.food, /sold-out-pill"\s*\n?\s*onClick/) &&
  !rx(F.food, /className="sold-out-pill"[^>]*onClick/));

// A REFUSED ADD MUST NOT WEAR A SUCCESS TICK (guest sweep T1, sweep #7, 2026-08-22).
// "A limit is not a success" (owner, 2026-08-18) was applied to the Maximum-99 message, but the
// "<dish> added" toast still fired on ANY delta > 0, arrived second and won: at 99, tapping "+"
// showed a green ✓ and "Virgin Mojito added" while nothing was added. CartPanel's "+" has always
// returned at the ceiling; these two must behave the same, not just say the same words.
check("P15366", "at 99 the card refuses out loud and claims nothing", () => {
  const gated = has(F.food, "const refused = delta > 0 && rawQty > 99", "if (delta > 0 && !refused) {");
  const noBounce = rx(F.food, /if \(delta > 0 && !refused\) popThumb\(\);/) &&
                   !rx(F.food, /const applyQty = \(delta: number\) => \{\s*if \(delta > 0\) popThumb\(\);/);
  const stillSays = has(F.food, "Maximum 99 per dish", 'variant: "info"');
  return { ok: gated && noBounce && stillSays, note: `gated=${gated} bounce=${noBounce} message=${stillSays}` };
});

// BACK MUST RETURN THE DINER TO THE SAME PLACE (guest sweep T1, sweep #7, 2026-08-22).
// This one had FOUR passing source assertions and did not work: the mount-time onScroll() wrote a
// 0 over the saved position before the restore could read it, so every Back landed at the top of
// the menu. Both halves matter — the static one names the two moving parts so nobody removes them
// by accident, and the LIVE one is the only thing that could have caught it in the first place.
check("P15332", "the saved scroll position is not written over before it is restored", () => {
  const gated = rx(F.menuView, /if \(restoreSettled\.current\) \{\s*try \{ sessionStorage\.setItem\(sk\("lfh_menu_scroll"\)/);
  const reaims = has(F.menuView, "const aim = ()", "scrollHeight", 'behavior: "instant"') &&
                 rx(F.menuView, /restoreSettled\.current = true/);
  const bounded = has(F.menuView, "stalls >= 3", "2500");
  return { ok: gated && reaims && bounded, note: `gated=${gated} re-aims=${reaims} bounded=${bounded}` };
});

// ── LIVE half ────────────────────────────────────────────────────────────────────────────
async function live(base) {
  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch { results.push({ phase: "live", name: "playwright unavailable — live half skipped", ok: true, note: "install playwright to run it" }); return; }
  const b = await chromium.launch();
  const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  const open = async (p, ms = 6000) => {
    const c = await b.newContext(A35), pg = await c.newPage();
    const bad = [], errs = [];
    pg.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().replace(base, "").slice(0, 60)}`); });
    pg.on("pageerror", (e) => errs.push(String(e.message).slice(0, 90)));
    const resp = await pg.goto(base + p, { waitUntil: "domcontentloaded", timeout: 60000 });
    await pg.waitForTimeout(ms);
    return { c, pg, bad, errs, status: resp ? resp.status() : 0 };
  };
  try {
    // the QR menu must guard the back button — one press must NOT leave the site
    { const { c, pg } = await open("/r/french-house/menu", 4500);
      const armed = await pg.evaluate(() => !!(history.state && history.state.__lfhExitGuard));
      check(246, "LIVE: exit guard armed on /r/<slug>/menu", () => armed); await c.close(); }
    // frosted panels must compute a REAL blur (source can't tell you this)
    { const { c, pg } = await open("/r/french-house/menu", 3500);
      const r = await pg.evaluate(() => { const o = {};
        for (const k of ["sg-overlay", "ssw-card", "ot-dropzone-circle", "menu-headfrost"]) {
          const d = document.createElement("div"); d.className = k; document.body.appendChild(d);
          o[k] = getComputedStyle(d).backdropFilter; d.remove(); } return o; });
      for (const [k, v] of Object.entries(r))
        check(429, `LIVE: .${k} computes a real blur`, () => ({ ok: /blur\(/.test(v), note: v }));
      await c.close(); }
    // a missing dish must 404 and must not show the platform brand or link to the staff login
    for (const [lbl, p] of [["tenant", "/r/french-house/item/zz-no-such-dish"], ["legacy", "/item/zz-no-such-dish"]]) {
      const { c, pg, status } = await open(p, 4000);
      const t = await pg.evaluate(() => ({ body: document.body.innerText, title: document.title,
        hrefs: [...document.querySelectorAll("a")].map((a) => a.getAttribute("href")) }));
      check(13, `LIVE: ${lbl} missing dish answers 404`, () => ({ ok: status === 404, note: "status " + status }));
      check(28, `LIVE: ${lbl} 404 shows no platform brand`, () => !/Aevidine/i.test(t.body + t.title));
      check(29, `LIVE: ${lbl} 404 never links to the staff login`, () => !t.hrefs.includes("/"));
      await c.close(); }
    // the menu itself, per restaurant, at the owner's phone width
    for (const slug of ["french-house", "aangan-garden-restaurant", "sakura-sushi"]) {
      const { c, pg, bad, errs } = await open(`/r/${slug}/menu`, 6500);
      const r = await pg.evaluate(() => ({ cards: document.querySelectorAll(".item-card").length,
        search: !!(document.querySelector("#search-input") || {}).offsetParent,
        title: document.title, txt: document.body.innerText }));
      check(499, `LIVE: ${slug} renders dishes at 360px`, () => ({ ok: r.cards > 0, note: r.cards + " cards" }));
      check(500, `LIVE: ${slug} search box on screen`, () => r.search);
      check(483, `LIVE: ${slug} no leaked markers in visible text`, () =>
        !["-->", "${", "[object Object]"].some((m) => r.txt.includes(m)) && !/(^|\s)NaN(\s|$)/.test(r.txt));
      if (slug !== "french-house")
        check(485, `LIVE: ${slug} shows no "Little French House"`, () => !/little french house/i.test(r.txt));
      check(499, `LIVE: ${slug} no failing requests`, () => ({ ok: bad.length === 0, note: bad.slice(0, 2).join(" | ") }));
      check(499, `LIVE: ${slug} no page errors`, () => ({ ok: errs.length === 0, note: errs.slice(0, 1).join("") }));
      await c.close(); }
    // BACK RETURNS THE DINER TO THE SAME DISH — the check the source assertions could not make.
    // Scroll well down, open a dish that is ALREADY on screen (tapping an off-screen one would make
    // the test itself scroll the page, which is how this was nearly mis-diagnosed), come back, and
    // assert the same dish is under the header. Asserts the DISH, not a pixel: the page can settle a
    // few px either way and the diner would never know, but landing on a different dish is the bug.
    for (const slug of ["french-house", "aangan-garden-restaurant"]) {
      const { c, pg } = await open(`/r/${slug}/menu`, 6000);
      const topDish = () => pg.evaluate(() => [...document.querySelectorAll(".item-card")]
        .find((x) => x.getBoundingClientRect().top > 150)?.querySelector(".dish-name")?.textContent.trim() || "");
      await pg.evaluate(() => document.getElementById("main-scroll").scrollTo({ top: 1500, behavior: "instant" }));
      await pg.waitForTimeout(1600);
      const before = await topDish();
      const y0 = await pg.evaluate(() => document.getElementById("main-scroll").scrollTop);
      const link = await pg.evaluateHandle(() => [...document.querySelectorAll(".item-card-link")]
        .find((a) => { const r = a.getBoundingClientRect(); return r.top > 150 && r.bottom < 700; }) || null);
      const el = link.asElement();
      if (!el || !y0) { check("P15332", `LIVE: ${slug} Back returns to the same dish`, () => ({ ok: false, note: "no on-screen card to tap" })); await c.close(); continue; }
      await el.click({ force: true });
      await pg.waitForLoadState("networkidle").catch(() => {});
      await pg.waitForTimeout(2500);
      await pg.goBack({ waitUntil: "networkidle" }).catch(() => {});
      await pg.waitForTimeout(4500);
      const after = await topDish();
      check("P15332", `LIVE: ${slug} Back returns to the same dish`, () =>
        ({ ok: !!before && before === after, note: `left at "${before}", came back to "${after}"` }));
      await c.close(); }
  } finally { await b.close(); }
}

if (BASE) await live(BASE);

// ── report ───────────────────────────────────────────────────────────────────────────────
const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
for (const r of results) if (!r.ok) console.log(`  ❌ [${r.phase}] ${r.name}${r.note ? " — " + r.note : ""}`);
console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed` +
            (BASE ? ` (static + live against ${BASE})` : " (static only — pass --base <url> for the live half)"));
process.exit(fail === 0 ? 0 : 1);
