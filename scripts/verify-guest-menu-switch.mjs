// verify-guest-menu-switch.mjs — WHO CAN TAKE A RESTAURANT'S GUEST MENU DOWN, AND WHERE THEY DO IT.
//
//   npm run verify:guest-menu-switch                 # the two routes, in memory (no app, no database)
//   npm run verify:guest-menu-switch -- --base <url> # + the owner's Settings page, rendered for real
//
// Access & permissions → Menu → "Put menu on maintenance" hands someone the switch that puts a
// restaurant's guest menu on "we'll be right back". Its "Who may do it" is Owner only (the default)
// or Owner and manager. Sweep #10 T16 round 2 (owner, 2026-10-15: "owner should get, in the setting
// thing, the maintenance switch") found two halves of one fault:
//   · the OWNER had no switch anywhere — so at the default, nobody at the restaurant could use it;
//   · every MANAGER saw "Take guest menu offline" in their ⚙ drawer whether or not it was handed over,
//     and the confirm then ended in "ask your admin" (R67: a power not given is absent).
// The rule now lives once in lib/maintenance.ts. Sections 1–3 call the REAL route files in memory
// (esbuild-bundled, stand-in database — scripts/sweep/t16s10/routes.mjs), so every branch runs and
// nothing is written anywhere. Section 4 opens the real owner Settings page on --base, signed in once
// as the owner, with that page's own two requests answered by this script — so it can show both
// states without changing any restaurant's switch, and nothing reaches the database.
import { call, world, g, FH, PP } from "./sweep/t16s10/routes.mjs";

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.log(`  ❌ ${m}${extra ? ` — ${extra}` : ""}`); } };
const argv = process.argv.slice(2);
const BASE = (() => { const i = argv.findIndex((a) => a === "--base" || a.startsWith("--base=")); if (i < 0) return null; return argv[i].includes("=") ? argv[i].split("=")[1] : argv[i + 1]; })();
const GRANT_OWNER = { maintenance: { on: true } };
const GRANT_BOTH = { maintenance: { on: true, manager_opts: { who: "owner_manager" } } };
const OWNER = { all: false, ids: [FH, PP], ownerId: "o1", ownerName: "Owner" };
const svc = (rid) => (g().FIX.settings.find((x) => x.restaurant_id === rid) || {}).service_mode;

console.log("\n1) /api/maintenance tells the manager's drawer whether to show the switch at all");
let r;
await world(); r = await call("maintenance", "GET");
ok(r.status === 200 && r.json.canChange === false, "not handed over → canChange:false (the drawer draws nothing)", JSON.stringify(r.json));
await world({ access: GRANT_OWNER }); r = await call("maintenance", "GET");
ok(r.json.canChange === false, "handed to the OWNER only → still false for a manager", JSON.stringify(r.json));
// A restaurant whose access settings are EMPTY (null — a new restaurant) reads as "not handed over",
// never as a crash (found by mutation, round 2: `&&` → `||` there went unnoticed).
await world({ access: null }); r = await call("maintenance", "GET");
ok(r.status === 200 && r.json.canChange === false, "a restaurant with no access settings at all → not handed over (no crash)", `${r.status} ${r.text}`);
await world({ access: null }); r = await call("maintenance", "POST", { body: { on: true } });
ok(r.status === 403 && g().WRITES.length === 0, "…and its switch cannot be flipped", `${r.status}`);
await world({ access: GRANT_BOTH }); r = await call("maintenance", "GET");
ok(r.json.canChange === true, "handed to owner AND manager → true", JSON.stringify(r.json));
await world({ who: "admin" }); r = await call("maintenance", "GET", { query: "?rid=" + FH });
ok(r.json.canChange === true, "the admin super-user always may");
await world({ access: GRANT_BOTH, fail: { restaurants: "error" } }); r = await call("maintenance", "GET");
ok(r.status === 200 && r.json.canChange === null && r.json.maintenance === false, "a failed access read still answers the menu's state, and says it could not tell (null), never a confident no", `${r.status} ${r.text}`);
await world({ access: GRANT_BOTH, fail: { restaurants: "error" } }); r = await call("maintenance", "POST", { body: { on: true } });
ok(r.status === 503 && g().WRITES.length === 0, "…and a WRITE that cannot be checked is 'try again', with nothing written", `${r.status}`);
await world({ access: GRANT_OWNER }); r = await call("maintenance", "POST", { body: { on: true } });
ok(r.status === 403 && g().WRITES.length === 0, "a manager given nothing is refused on the write too (the drawer is never the only guard)");
await world({ who: "owner", owned: { o1: [FH] }, access: GRANT_OWNER }); r = await call("maintenance", "POST", { body: { on: true }, query: "?rid=" + FH });
ok(r.status === 200 && (g().LOGS[0] || {}).panel === "owner", "an owner's flip through this door is the OWNER's row, not the manager panel's", JSON.stringify(g().LOGS[0]));

console.log("\n2) The owner's Settings page lists the switch only where it was handed over");
await world({ oscope: OWNER }); r = await call("ownerSettings", "GET");
ok(r.status === 200 && Array.isArray(r.json.maintenance) && r.json.maintenance.length === 0 && r.json.maintenanceOk === true, "handed over nowhere → no row at all (R36: what is withheld is not mentioned)", JSON.stringify(r.json && r.json.maintenance));
await world({ oscope: OWNER, access: null }); r = await call("ownerSettings", "GET");
ok(r.status === 200 && r.json.maintenance.length === 0 && r.json.maintenanceOk === true, "…a restaurant with no access settings at all is simply not listed (no crash)", `${r.status} ${JSON.stringify(r.json && r.json.maintenance)}`);
await world({ oscope: OWNER, access: GRANT_OWNER }); r = await call("ownerSettings", "GET");
ok(r.json.maintenance.length === 1 && r.json.maintenance[0].restaurant_id === FH && r.json.maintenance[0].on === false && r.json.maintenance[0].name === "French House", "handed over at French House only → one row, French House, with its real state", JSON.stringify(r.json.maintenance));
await world({ oscope: OWNER, access: GRANT_OWNER, accessPP: GRANT_OWNER }); r = await call("ownerSettings", "GET");
ok(r.json.maintenance.length === 2 && r.json.maintenance.find((m) => m.restaurant_id === PP).on === true, "two restaurants handed over → two rows, each with its own state", JSON.stringify(r.json.maintenance));
await world({ oscope: OWNER, access: GRANT_OWNER, accessPP: GRANT_OWNER, entOff: [PP + ":settings"] }); r = await call("ownerSettings", "GET");
ok(r.json.maintenance.length === 1 && r.json.maintenance[0].restaurant_id === FH, "a restaurant whose Settings the admin withheld is not listed", JSON.stringify(r.json.maintenance));
await world({ oscope: OWNER, access: GRANT_OWNER, settings: [{ id: "s2", restaurant_id: PP, service_mode: false }] }); r = await call("ownerSettings", "GET");
ok(r.json.maintenance.length === 0, "a restaurant with no settings row gets no switch (there would be nothing for it to write to)", JSON.stringify(r.json.maintenance));
// The page reads `settings` three times (module switches, printing, then this) and `restaurants` twice
// (the list, then this) — so only the read THIS card makes is failed, by its place in that order.
for (const [what, nth] of [["the menu-state read", { "settings:select": { at: 3, mode: "error" } }], ["the grant read", { "restaurants:select": { at: 2, mode: "error" } }]]) {
  await world({ oscope: OWNER, access: GRANT_OWNER }); g().FAIL_NTH = nth; r = await call("ownerSettings", "GET");
  ok(r.status === 200 && r.json.maintenanceOk === false && r.json.maintenance.length === 0 && r.json.restaurants.length === 2, `${what} failing says so (maintenanceOk:false) and the rest of the page still loads`, `${r.status} ${JSON.stringify(r.json && { m: r.json.maintenance, ok: r.json.maintenanceOk })}`);
}

console.log("\n3) The owner's switch changes only their own restaurant, only when handed over, and is recorded");
const flip = (rid, on) => call("ownerSettings", "PATCH", { body: { maintenance: { restaurant_id: rid, on } } });
await world({ oscope: OWNER, access: GRANT_OWNER }); r = await flip(FH, true);
ok(r.status === 200 && r.json.maintenance === true && svc(FH) === true && svc(PP) === true && g().WRITES.length === 1, "handed over → French House goes offline, and nothing else is written", `${r.status} ${r.text}`);
const L = g().LOGS[0] || {};
ok(L.panel === "owner" && L.action === "maintenance_on" && L.actor === "Owner" && L.actor_id === "o1" && L.restaurant_id === FH, "…recorded in the owner's own feed, under their NAME (not a uuid), against French House", JSON.stringify(L));
r = await flip(FH, true);
ok(r.status === 200 && svc(FH) === true, "pressing 'offline' again leaves it offline — the request is the END STATE, never a toggle");
r = await flip(FH, false);
ok(r.status === 200 && r.json.maintenance === false && svc(FH) === false && (g().LOGS.at(-1) || {}).action === "maintenance_off", "bringing it back works and is recorded too");
await world({ oscope: OWNER }); r = await flip(FH, true);
ok(r.status === 403 && g().WRITES.length === 0 && !g().LOGS.length, "not handed over → refused, nothing written, nothing recorded", `${r.status} ${r.text}`);
await world({ oscope: { ...OWNER, ids: [PP] }, access: GRANT_OWNER }); r = await flip(FH, true);
ok(r.status === 403 && g().WRITES.length === 0, "a restaurant that is not theirs → refused, even where the switch is handed over");
await world({ oscope: OWNER, access: GRANT_OWNER, entOff: [FH + ":settings"] }); r = await flip(FH, true);
ok(r.status === 403 && g().WRITES.length === 0, "a restaurant whose Settings the admin withheld → refused");
await world({ oscope: OWNER, access: GRANT_OWNER }); r = await call("ownerSettings", "PATCH", { body: { maintenance: { restaurant_id: FH, on: "yes" } } });
ok(r.status === 400 && g().WRITES.length === 0, "anything but true/false is refused, never guessed");
await world({ oscope: OWNER, access: GRANT_OWNER, fail: { restaurants: "error" } }); r = await flip(FH, true);
ok(r.status >= 500 && g().WRITES.length === 0, "a grant that cannot be read → 'try again', nothing written", `${r.status}`);
await world({ oscope: { ...OWNER, admin: true } }); r = await flip(FH, true);
ok(r.status === 200 && (g().LOGS[0] || {}).panel === "admin", "the admin viewing the owner panel: allowed, and recorded in Aevidine's log, out of the owner's feed", JSON.stringify(g().LOGS[0]));
await world({ oscope: null }); r = await flip(FH, true);
ok(r.status === 401 && g().WRITES.length === 0, "no owner session → 401 before anything is read or written");
await world({ oscope: OWNER, access: GRANT_OWNER }); r = await call("ownerSettings", "PATCH", { body: { restaurant_id: FH, key: "nonsense", enabled: true } });
ok(r.status === 400, "the module-switch PATCH on the same route is unchanged (an unknown module is still refused)");

if (BASE) {
  console.log(`\n4) The owner's Settings page on ${BASE} — the card, the ask-first, and an honest refusal`);
  const { chromium } = await import("playwright");
  const { loginAs } = await import("./sweep/login.mjs");
  const browser = await chromium.launch();
  for (const vp of [{ width: 1280, height: 860 }, { width: 390, height: 844, mobile: true }]) {
    const ctx = await browser.newContext(vp.mobile ? { viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 3, hasTouch: true, isMobile: true } : { viewport: vp });
    await loginAs(ctx, "owner", BASE);
    const page = await ctx.newPage();
    let real = null, sent = [], answer = "ok";
    // The page's own read goes to the server for real (so the rest of the page is the real one) and
    // only its `maintenance` rows are replaced; every PATCH is answered here and never reaches it.
    await page.route("**/api/owner/settings*", async (route) => {
      const q = route.request();
      if (q.method() === "GET") {
        const res = await route.fetch(); const j = await res.json().catch(() => ({}));
        real = j;
        const rid = (j.restaurants && j.restaurants[0] && j.restaurants[0].id) || FH;
        return route.fulfill({ response: res, json: { ...j, maintenance: [{ restaurant_id: rid, name: (j.restaurants[0] || {}).name || "Here", on: false }], maintenanceOk: true } });
      }
      if (q.method() === "PATCH") {
        const b = JSON.parse(q.postData() || "{}"); sent.push(b);
        if (answer === "refuse") return route.fulfill({ status: 403, json: { error: "The admin hasn't handed you this switch." } });
        return route.fulfill({ status: 200, json: { ok: true, maintenance: b.maintenance.on } });
      }
      return route.continue();
    });
    await page.goto(BASE + "/owner/settings", { waitUntil: "domcontentloaded", timeout: 120000 });
    const card = page.locator("[data-guest-menu-card]");
    const shown = await card.waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
    const tag = vp.mobile ? "390px" : "1280px";
    ok(shown && !!real, `${tag}: the Guest menu card is on the page when a row is handed over`);
    if (shown) {
      ok(/Live — guests can order/.test(await card.innerText()), `${tag}: it says the menu is live`);
      await card.getByRole("button", { name: "Take menu offline" }).click();
      ok(sent.length === 0 && /Take it offline\?/.test(await card.innerText()), `${tag}: the first tap only ASKS — nothing sent yet`);
      await card.getByRole("button", { name: "Cancel" }).click();
      ok(sent.length === 0 && /Take menu offline/.test(await card.innerText()), `${tag}: Cancel leaves it exactly as it was`);
      await card.getByRole("button", { name: "Take menu offline" }).click();
      await card.getByRole("button", { name: "Yes, take it offline" }).click();
      await page.waitForFunction(() => /Offline — guests/.test(document.querySelector("[data-guest-menu-card]")?.textContent || ""), null, { timeout: 15000 }).catch(() => {});
      const t1 = await card.innerText();
      ok(sent.length === 1 && sent[0].maintenance.on === true && /Offline — guests can’t order/.test(t1) && /Done — the guest menu is offline/.test(t1), `${tag}: Yes sends {on:true} once and the row turns Offline with a plain sentence`, JSON.stringify(sent));
      answer = "refuse";
      await card.getByRole("button", { name: "Bring menu back online" }).click();
      await page.waitForFunction(() => /NOT changed/.test(document.querySelector("[data-guest-menu-card]")?.textContent || ""), null, { timeout: 15000 }).catch(() => {});
      const t2 = await card.innerText();
      ok(/Offline — guests can’t order/.test(t2) && /The guest menu has NOT changed/.test(t2), `${tag}: a refusal leaves the row as it was and says nothing changed`, t2.slice(0, 160));
      const box = await card.boundingBox(); const vw = await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
      ok(box && box.x >= 0 && box.x + box.width <= vw[0] + 1 && vw[1] <= vw[0], `${tag}: the card fits the screen, no sideways scroll`, JSON.stringify({ box, vw }));
    }
    // …and with nothing handed over the card is simply not there.
    await page.unroute("**/api/owner/settings*");
    await page.route("**/api/owner/settings*", async (route) => {
      if (route.request().method() !== "GET") return route.fulfill({ status: 500, json: { error: "this check sends nothing" } });
      const res = await route.fetch(); const j = await res.json().catch(() => ({}));
      return route.fulfill({ response: res, json: { ...j, maintenance: [], maintenanceOk: true } });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("h1", { hasText: "Settings" }).waitFor({ timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
    ok((await page.locator("[data-guest-menu-card]").count()) === 0 && !/Guest menu/.test(await page.locator("main, body").first().innerText()), `${tag}: handed over nowhere → no Guest menu card, no mention of it`);
    await ctx.close();
  }
  await browser.close();
}

console.log(`\n${fail ? "❌" : "✅"} guest menu switch: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
