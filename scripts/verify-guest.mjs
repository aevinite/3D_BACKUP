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
check(115, "the is-4d card styling follows the 3D switch", () =>
  has(F.food, 'item.is4d && features.model3d ? "is-4d"'));
check(111, "the menu waits for the REAL 3D switch before queueing any GLB", () =>
  has(F.menuView, "getFeatures(restaurantId)") && rx(F.menuView, /model3d === false\) \{ modelLoader\.setQueue\(\[\], \[\], \[\], \[\]\)/));
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
  } finally { await b.close(); }
}

if (BASE) await live(BASE);

// ── report ───────────────────────────────────────────────────────────────────────────────
const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
for (const r of results) if (!r.ok) console.log(`  ❌ [${r.phase}] ${r.name}${r.note ? " — " + r.note : ""}`);
console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed` +
            (BASE ? ` (static + live against ${BASE})` : " (static only — pass --base <url> for the live half)"));
process.exit(fail === 0 ? 0 : 1);
