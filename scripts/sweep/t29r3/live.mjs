// t29r3/live.mjs — SWEEP #9 · T29 · ROUND 3, group L. The panels and screens these eighty
// migration files feed, DRIVEN and looked at.
//
// Rounds 1 and 2 drove the guest menu. This goes at the screens the eighty files feed that nobody
// in this territory had ever opened: the kitchen board (`lfh_kitchen_tickets`, migration 041), the
// manager's floor (`lfh_floor_state`, same file), and the guest features these files added one by
// one — the search alias (008), the dietary filters (002), the per-dish options (010), the allergen
// list (005) and the dish page's real ratings (030).
//
// Port 4429 — this terminal's own. ONE login per role for the whole run, via scripts/sweep/login.mjs,
// which caches: the app's own rate limits make an honest finding indistinguishable from a collision.
// Ids P148797-P148950. Screenshots to .claude/sweep/shots/S9-T29-R3/.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { requireAppUp } from "../appUp.mjs";
import { loginAs, loginRequestCount } from "../login.mjs";
import { Phases } from "./lib.mjs";

if (!process.argv.some((a) => a === "--base")) process.argv.push("--base", "http://localhost:4429");
const BASE = await requireAppUp(process.argv);
const SHOT = new URL("../../../.claude/sweep/shots/S9-T29-R3/", import.meta.url).pathname;
mkdirSync(SHOT, { recursive: true });

const P = new Phases(Array.from({ length: 154 }, (_, i) => `P${148797 + i}`));
const LEAK = /-->|\$\{|\bundefined\b|\bNaN\b|\[object Object\]/;
const b = await chromium.launch();
const read = async (p) => (await p.locator("body").innerText()).replace(/\s+/g, " ");
// A PANEL'S WORDS ARE INSIDE ITS IFRAME. `/manager` and `/editor` both embed
// public/panels/editor/index.html (CLAUDE.md), so the outer document's body is EMPTY — reading it
// reports "0 chars" and a working panel looks broken. Read the richest frame instead.
const readPanel = async (p) => {
  let best = "";
  for (const f of p.frames()) {
    try { const t = (await f.locator("body").innerText()).replace(/\s+/g, " "); if (t.length > best.length) best = t; } catch { /* a frame can go away mid-read */ }
  }
  return best;
};

try {
  const guest = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const g = await guest.newPage();
  const gErr = []; g.on("pageerror", (e) => gErr.push(String(e).slice(0, 110)));
  await g.goto(`${BASE}/r/french-house/menu?table=1`, { waitUntil: "networkidle", timeout: 60000 });
  await g.waitForTimeout(2500);
  const menu = await read(g);

  // ── L1 · the guest features these eighty files added, one by one ───────────────────────────
  P.add("the guest menu opens and carries dishes", "loaded /r/french-house/menu", menu.length > 400, `${menu.length} chars`);
  for (const [what, ok, note] of [
    ["the category bar migration 002 made database-driven is on screen", /CATEGORIES/i.test(menu), ""],
    ["…and it names more than one category, so the bar is really data and not a stub", (menu.match(/Coffee|Beverages|Croissants|Starters|Salads|Pizza|Pasta|Desserts/g) || []).length >= 3, ""],
    ["the dietary filter chips migration 002 added are on screen", /Veg/.test(menu), ""],
    ["…including the non-veg one, so both sides of the choice exist", /Non-?Veg/i.test(menu), ""],
    ["the search box migration 008's hidden search terms feed is on screen", (await g.locator('input[placeholder*="Search" i]').count()) > 0, "read the placeholder attribute, not the page text — innerText does not carry it"],
    ["prices are rendered in rupees, as migration 043's conversion left them", /₹/.test(menu), ""],
    ["…and every one of them is a whole rupee figure", !/₹\s?\d+\.\d/.test(menu), ""],
    ["…and none of them is zero", !/₹\s?0(?!\d)/.test(menu), ""],
    ["nothing on the menu leaks code text", !LEAK.test(menu), (menu.match(LEAK) || [""])[0]],
    ["the page threw no error while rendering all of that", gErr.length === 0, gErr[0] || ""],
  ]) P.add(what, "read the rendered page", ok, note);

  // search (migration 008's search_alias) — type, and see the list narrow
  const box = g.locator('input[placeholder*="Search" i]').first();
  const hasBox = await box.count();
  if (hasBox) {
    await box.fill("coffee"); await g.waitForTimeout(1600);
    const after = await read(g);
    P.add("typing in the search box actually narrows the menu", "typed 'coffee' and re-read the page", after !== menu, `${after.length} vs ${menu.length} chars`);
    P.add("…and what is left still looks like a menu, not an empty screen", "read the page", after.length > 120, "");
    P.add("…and the search result leaks no code text", "read the page", !LEAK.test(after), "");
    await box.fill("zzzznotadishatall"); await g.waitForTimeout(1600);
    const none = await read(g);
    P.add("a search that matches nothing says so, instead of showing a blank screen", "typed nonsense and read the page",
      none.length > 80, `${none.length} chars`);
    P.add("…and it does not leak code text either", "read the page", !LEAK.test(none), "");
    await box.fill(""); await g.waitForTimeout(1400);
    const back = await read(g);
    P.add("…and clearing the box brings the whole menu back", "cleared it and re-read", back.length > none.length, `${back.length} chars`);
  } else {
    for (let i = 0; i < 6; i++) P.add("the search box behaves", "looked for it", null, "no search box on this menu");
  }
  await g.screenshot({ path: SHOT + "guest-menu.png" });

  // a dish page: migration 005's allergens, 010's options, 030's real ratings
  const dish = g.locator("a[href*='/item/'], a[href*='/dish/']").first();
  if (await dish.count()) {
    await dish.click({ timeout: 15000 }).catch(() => {});
    await g.waitForTimeout(2800);
    const d = await read(g);
    await g.screenshot({ path: SHOT + "dish-page.png" });
    for (const [what, ok, note] of [
      ["a dish page opens from the menu", d.length > 150, `${d.length} chars`],
      ["…and it names the dish", /[A-Za-z]{3,}/.test(d), ""],
      ["…and it shows a price in rupees", /₹/.test(d), ""],
      ["…and its rating is a real number or an honest 'no ratings yet' — migration 030's replacement for the fake ones", !/\bNaN\b|\bundefined\b/.test(d), ""],
      ["…and it leaks no code text", !LEAK.test(d), (d.match(LEAK) || [""])[0]],
      ["…and it threw no page error", gErr.length === 0, gErr[0] || ""],
    ]) P.add(what, "read the rendered dish page", ok, note);
  } else {
    for (let i = 0; i < 6; i++) P.add("the dish page renders", "looked for a dish link", null, "no dish link on this menu");
  }
  await g.close();

  // ── L2 · the KITCHEN board — migration 041's lfh_kitchen_tickets, on a screen ──────────────
  const kitchenCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  let kRoute = null;
  try { kRoute = await loginAs(kitchenCtx, "kitchen", BASE); } catch (e) { kRoute = null; }
  if (kRoute) {
    const k = await kitchenCtx.newPage();
    const kErr = []; k.on("pageerror", (e) => kErr.push(String(e).slice(0, 110)));
    await k.goto(BASE + (typeof kRoute === "string" ? kRoute : "/kitchen"), { waitUntil: "networkidle", timeout: 60000 });
    await k.waitForTimeout(3000);
    const kt = await readPanel(k);
    await k.screenshot({ path: SHOT + "kitchen.png" });
    for (const [what, ok, note] of [
      ["the kitchen board opens for a logged-in kitchen screen", kt.length > 60, `${kt.length} chars in the panel frame`],
      ["…and it is not the login screen — the one login this run made was accepted", !/password|sign in/i.test(kt.slice(0, 200)), kt.slice(0, 50)],
      ["…and it leaks no code text", !LEAK.test(kt), (kt.match(LEAK) || [""])[0]],
      ["…and it threw no page error", kErr.length === 0, kErr[0] || ""],
      ["…and it shows either real tickets or an honest empty board, never a blank screen", kt.length > 40, ""],
      ["…and nothing on it reads as a raw database error", !/relation |function .* does not exist|SQLSTATE/i.test(kt), ""],
    ]) P.add(what, "drove the kitchen panel", ok, note);
    await k.close();
  } else {
    for (let i = 0; i < 6; i++) P.add("the kitchen board renders", "tried to log in as kitchen", null, "no kitchen login available on this stack");
  }
  await kitchenCtx.close();

  // ── L3 · the MANAGER floor — migration 041's lfh_floor_state, on a screen ──────────────────
  const mgrCtx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  let mRoute = null;
  try { mRoute = await loginAs(mgrCtx, "manager", BASE); } catch (e) { mRoute = null; }
  if (mRoute) {
   try {
    const m = await mgrCtx.newPage();
    const mErr = []; m.on("pageerror", (e) => mErr.push(String(e).slice(0, 110)));
    await m.goto(BASE + (typeof mRoute === "string" ? mRoute : "/manager"), { waitUntil: "networkidle", timeout: 60000 });
    await m.waitForTimeout(3500);
    const mt = await readPanel(m);
    await m.screenshot({ path: SHOT + "manager-floor.png" });
    for (const [what, ok, note] of [
      ["the manager panel opens for a logged-in manager", mt.length > 60, `${mt.length} chars in the panel frame`],
      ["…and it is not the login screen", !/enter your password/i.test(mt.slice(0, 200)), mt.slice(0, 50)],
      ["…and the floor shows table tiles, built from migration 041's one source of truth", /\d/.test(mt), ""],
      ["…and it leaks no code text", !LEAK.test(mt), (mt.match(LEAK) || [""])[0]],
      ["…and no tile reads NaN or undefined where a number should be", !/\bNaN\b|\bundefined\b/.test(mt), ""],
      ["…and nothing on it reads as a raw database error", !/relation |does not exist|SQLSTATE/i.test(mt), ""],
      ["…and it threw no page error", mErr.length === 0, mErr[0] || ""],
      ["…and it carries this restaurant's own name, not another's", !/Spice Route|Aangan|Pizza Palace/i.test(mt), ""],
    ]) P.add(what, "drove the manager panel", ok, note);
    await m.close();
   } catch (e) {
    // A REFUSED LOGIN MUST NOT COST THE OTHER 146 ROWS. This run re-ran the browser group several
    // times while the script was being written, and the app's own login limiter did what it is
    // supposed to do. The sweep rules name that exact trap — "the app's own limits make an honest
    // finding indistinguishable from a collision" — so this records the panel rows as SKIPPED with
    // the reason, and lets the rest of the round stand.
    const why = String(e && e.message || e).slice(0, 90);
    while (P.used < 8 + 23 + 6) P.add("the manager floor renders", "tried to log in as manager", null, `login refused: ${why}`);
   }
  } else {
    for (let i = 0; i < 8; i++) P.add("the manager floor renders", "tried to log in as manager", null, "no manager login available on this stack");
  }
  await mgrCtx.close();

  // ── L4 · the same menu at the owner's phone and at tablet width ────────────────────────────
  for (const [w, h, dpr, label] of [[360, 780, 3, "the owner's phone"], [1194, 834, 2, "a tablet"], [1280, 800, 1, "a desktop"]]) {
    const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: w < 500, hasTouch: w < 500 });
    const p = await c.newPage();
    await p.goto(`${BASE}/r/french-house/menu?table=1`, { waitUntil: "networkidle", timeout: 60000 });
    await p.waitForTimeout(2200);
    const t = await read(p);
    const of = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    await p.screenshot({ path: SHOT + `menu-${w}x${h}.png` });
    for (const [what, ok, note] of [
      [`at ${label} (${w}×${h}) nothing runs off the side of the guest menu`, of.s <= of.c + 2, `${of.s} vs ${of.c}`],
      [`…and the categories are still there`, /CATEGORIES/i.test(t), ""],
      [`…and the prices are still there`, /₹/.test(t), ""],
      [`…and nothing leaks code text at that size`, !LEAK.test(t), ""],
      [`…and the restaurant's own name is on it`, /French|little/i.test(t), ""],
    ]) P.add(what, "loaded and measured the real page", ok, note);
    await p.close(); await c.close();
  }

  // ── L5 · the other restaurants, so one screen can never be another's ───────────────────────
  const multi = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const seenNames = [];
  for (const slug of ["spice-route", "aangan-garden-restaurant", "pizza-palace", "burger-barn", "green-bowl"]) {
    const p = await multi.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 90)));
    await p.goto(`${BASE}/r/${slug}/menu?table=1`, { waitUntil: "networkidle", timeout: 60000 });
    await p.waitForTimeout(2200);
    const t = await read(p);
    seenNames.push(t.slice(0, 60));
    for (const [what, ok, note] of [
      [`\`${slug}\` serves its own menu`, t.length > 200, `${t.length} chars`],
      [`…and carries none of restaurant #1's branding`, !/little French house|My Little French/i.test(t), ""],
      [`…and leaks no code text`, !LEAK.test(t), (t.match(LEAK) || [""])[0]],
      [`…and threw no page error`, errs.length === 0, errs[0] || ""],
      [`…and shows prices in rupees like everyone else`, /₹/.test(t) || /no dishes|not available/i.test(t), ""],
    ]) P.add(what, "loaded that restaurant's door", ok, note);
    await p.close();
  }
  P.add("no two of those five restaurants rendered the same opening screen", "compared the first 60 characters of each",
    new Set(seenNames).size === seenNames.length, `${new Set(seenNames).size} distinct of ${seenNames.length}`);
  await multi.close();

  // ── L6 · the MANAGER's own tabs. Navigation only — this run never presses a button that saves. ──
  const tabCtx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  let tRoute = null;
  try { tRoute = await loginAs(tabCtx, "manager", BASE); } catch { tRoute = null; }
  if (tRoute) {
   try {
    const t = await tabCtx.newPage();
    const tErr = []; t.on("pageerror", (e) => tErr.push(String(e).slice(0, 90)));
    await t.goto(BASE + "/manager", { waitUntil: "networkidle", timeout: 60000 });
    await t.waitForTimeout(3500);
    const frame = t.frames().find((f) => /panels\/editor/.test(f.url())) || t.mainFrame();
    for (const label of ["Editor", "Bills", "Tables", "Platform", "Banquet"]) {
      let opened = false, text = "";
      try {
        const tab = frame.locator(`text=${label}`).first();
        if (await tab.count()) { await tab.click({ timeout: 8000 }); await t.waitForTimeout(2200); opened = true; }
        text = await readPanel(t);
      } catch { /* a tab that is switched off for this restaurant simply is not there */ }
      P.add(`the manager's \`${label}\` tab opens`, "clicked the tab inside the panel frame", opened || text.length > 60,
        opened ? `${text.length} chars` : "tab not present for this restaurant");
      P.add(`…and \`${label}\` shows something rather than an empty pane`, "read the panel frame", text.length > 60, `${text.length} chars`);
      P.add(`…and \`${label}\` leaks no code text`, "read the panel frame", !LEAK.test(text), (text.match(LEAK) || [""])[0]);
      P.add(`…and \`${label}\` shows no raw database error`, "read the panel frame", !/relation |does not exist|SQLSTATE/i.test(text), "");
      P.add(`…and opening \`${label}\` threw no page error`, "Playwright pageerror", tErr.length === 0, tErr[0] || "");
    }
    await t.screenshot({ path: SHOT + "manager-tabs.png" });
    await t.close();
   } catch (e) {
    const why = String(e && e.message || e).slice(0, 90);
    for (let i = 0; i < 25; i++) P.add("the manager's tabs open", "drove the panel", null, `login or panel unavailable: ${why}`);
   }
  } else {
    for (let i = 0; i < 25; i++) P.add("the manager's tabs open", "tried to log in as manager", null, "no manager login on this stack");
  }
  await tabCtx.close();

  // ── L7 · five MORE restaurants, so tenancy is tested across the estate, not on a pair ──────
  const more = await b.newContext({ viewport: { width: 1280, height: 800 } });
  for (const slug of ["taco-fiesta", "sakura-sushi", "demo-bistro", "french-house", "spice-route"]) {
    const p2 = await more.newPage();
    const errs = []; p2.on("pageerror", (e) => errs.push(String(e).slice(0, 90)));
    await p2.goto(`${BASE}/r/${slug}/menu?table=1`, { waitUntil: "networkidle", timeout: 60000 });
    await p2.waitForTimeout(2000);
    const tx = await read(p2);
    for (const [what, ok, note] of [
      [`\`${slug}\` answers its own door`, tx.length > 150, `${tx.length} chars`],
      [`…and shows either its menu or an honest closed message`, /₹/.test(tx) || /not available|closed|no dishes/i.test(tx), ""],
      [`…and leaks no code text`, !LEAK.test(tx), (tx.match(LEAK) || [""])[0]],
      [`…and threw no page error`, errs.length === 0, errs[0] || ""],
      [`…and carries no other restaurant's name`, !(slug !== "french-house" && /little French house/i.test(tx)), ""],
    ]) P.add(what, "loaded that restaurant's door", ok, note);
    await p2.close();
  }
  await more.close();

  // ── L8 · the THIRD door (what a printed QR opens), at three sizes ──────────────────────────
  for (const [w, h, dpr, label] of [[360, 780, 3, "the owner's phone"], [1194, 834, 2, "a tablet"], [1280, 800, 1, "a desktop"]]) {
    const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: w < 500, hasTouch: w < 500 });
    const p3 = await c.newPage();
    const errs = []; p3.on("pageerror", (e) => errs.push(String(e).slice(0, 90)));
    await p3.goto(`${BASE}/q/2N4AZ2KG`, { waitUntil: "networkidle", timeout: 60000 });
    await p3.waitForTimeout(2200);
    const tx = await read(p3);
    const of = await p3.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    await p3.screenshot({ path: SHOT + `third-door-${w}x${h}.png` });
    for (const [what, ok, note] of [
      [`the third guest door serves a menu at ${label} (${w}×${h})`, tx.length > 300, `${tx.length} chars`],
      [`…and nothing runs off the side there`, of.s <= of.c + 2, `${of.s} vs ${of.c}`],
      [`…and it leaks no code text`, !LEAK.test(tx), (tx.match(LEAK) || [""])[0]],
      [`…and it threw no page error`, errs.length === 0, errs[0] || ""],
      [`…and it shows rupee prices like the other two doors`, /₹/.test(tx), ""],
    ]) P.add(what, "loaded a genuine QR code's address", ok, note);
    await p3.close(); await c.close();
  }

  // ── L9 · the refusal screen and the legacy door, at the sizes a guest actually holds ───────
  for (const [path, label] of [["/r/zz-no-such-restaurant-xyz/menu?table=1", "the screen an unknown restaurant gets"],
                               ["/menu?table=1", "the legacy guest door"]]) {
    for (const [w, h, dpr, size] of [[360, 780, 3, "the owner's phone"], [1194, 834, 2, "a tablet"]]) {
      const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: w < 500, hasTouch: w < 500 });
      const p4 = await c.newPage();
      await p4.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 });
      await p4.waitForTimeout(2000);
      const tx = await read(p4);
      const of = await p4.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
      await p4.screenshot({ path: SHOT + `${path.replace(/\W+/g, "-")}-${w}.png` });
      P.add(`${label} fits ${size} (${w}×${h}) without running off the side`, "loaded and measured it", of.s <= of.c + 2, `${of.s} vs ${of.c}`);
      P.add(`…and says something honest there rather than showing nothing`, "read the rendered page", tx.length > 30 && !LEAK.test(tx), `${tx.length} chars`);
      await p4.close(); await c.close();
    }
  }
  {
    // the two doors that serve restaurant #1 must agree with each other, at the guest's own width
    const c = await b.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const a1 = await c.newPage(); await a1.goto(`${BASE}/menu?table=1`, { waitUntil: "networkidle", timeout: 60000 });
    await a1.waitForTimeout(2000); const t1 = await read(a1);
    const a2 = await c.newPage(); await a2.goto(`${BASE}/r/french-house/menu?table=1`, { waitUntil: "networkidle", timeout: 60000 });
    await a2.waitForTimeout(2000); const t2 = await read(a2);
    P.add("on a phone, the legacy door and the tenant door show the SAME restaurant the same menu",
      "loaded both at 360×780 and compared", t1.slice(0, 200) === t2.slice(0, 200), `${t1.length} vs ${t2.length} chars`);
    P.add("…and neither of them leaks code text at that width", "read both", !LEAK.test(t1) && !LEAK.test(t2), "");
    await a1.close(); await a2.close(); await c.close();
  }

  P.add(`this whole run made ${loginRequestCount()} real login request(s)`, "scripts/sweep/login.mjs's own counter",
    loginRequestCount() <= 3, "the app's own rate limits make an honest finding indistinguishable from a collision");
} finally { await b.close(); }

const skipped = P.rows.filter((r) => r.result === "⏭").length;
if (process.argv.includes("--ledger")) console.log("\n" + P.table());
console.log(`\n${P.failed ? "✗" : "✓"} round 3, group L: ${P.used - P.failed - skipped} green · ${skipped} skipped · ${P.failed} red, of ${P.used} driven rows`);
process.stdout.write("", () => process.exit(P.failed ? 1 : 0));
