// scripts/sweep/t12r2/l-journeys.mjs — sweep #10 T12 ROUND 2 · the tablet in the states round 1 never put it in.
//
//   L1 a waiter WITH a section (rota 1–6)     L7 this round's fixes, seen live (items 7, 8, 12; T16's back fix)
//   L2 the ADMIN looking in (X-ray)            L8 a whole service on a PHONE, real taps only
//   L3 the server misbehaving (stand-ins)      L9 the keyboard and the screen reader
//   L4 opened with NO internet at all          L10 a change made on the manager panel arriving here
//   L5 two waiters on one dish at one instant  L11 what an idle tablet costs the database
//   L6 the back button across chained boxes    L12 the dark skin on a phone
//
// WRITES (French House only): orders on tables picked from today's floor (never a claimed one), retired
// by table; diagt1's rota (assigned_tables), put back in a finally AND on SIGINT/SIGTERM; nothing else.
// One login per role (scripts/sweep/login.mjs caches); the admin view uses the admin cookie, no login.
import { ok, F_APP, F_HTML, RID, BASE, db, browser, waiterContext, openPanel, panelFrame, visible, sleep } from "../t12s10/lib.mjs";
import { retireTables } from "../fixture.mjs";
import { restoreOnExit, restoreNow } from "../restore.mjs";
import { claimedTables } from "../fixtureTables.mjs";
import { loginAs, adminCookie } from "../login.mjs";

export async function blockL(R, firstId) {
  const { check } = R;
  let n = firstId;
  const id = () => "P" + n++;
  const LV = "LIVE — :4412, the panel driven";
  const NT = "NET — one answer from a stand-in, nothing written";
  const count = Number((await db(`settings?restaurant_id=eq.${RID}&select=table_count&limit=1`))[0]?.table_count) || 30;
  const claimed = new Set(claimedTables());
  const openT = new Set((await db(`sessions?restaurant_id=eq.${RID}&status=eq.open&select=table_number&limit=200`)).map((s) => String(s.table_number)));
  const free = Array.from({ length: count }, (_, i) => String(count - i)).filter((t) => !claimed.has(t) && !openT.has(t));
  const T1 = free[0], T2 = free[1];
  const used = [T1, T2];
  const waiter = (await db(`staff_users?restaurant_id=eq.${RID}&username=eq.diagt1&select=id,assigned_tables&limit=1`))[0];
  const restoreRota = async () => { await db(`staff_users?id=eq.${waiter.id}&restaurant_id=eq.${RID}`, "PATCH", { assigned_tables: waiter.assigned_tables || [] }); };
  restoreOnExit("t12r2 · diagt1's rota + two tables", async () => { await restoreRota(); await retireTables(used, () => {}); });
  const recordToasts = (page) => page.evaluate(() => { window.__tt = []; new MutationObserver((ms) => { for (const m of ms) for (const x of m.addedNodes) if (x.classList && x.classList.contains("toast")) window.__tt.push(x.querySelector("span")?.textContent || ""); }).observe(document.getElementById("toasts"), { childList: true }); });
  const said = (page) => page.evaluate(() => (window.__tt || []).join(" | "));
  const settleFor = async (page, ms = 1200) => { await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}); await sleep(ms); };

  try {
    // ── L1 · a waiter whose section is tables 1–6 ───────────────────────────────────────────────
    await db(`staff_users?id=eq.${waiter.id}&restaurant_id=eq.${RID}`, "PATCH", { assigned_tables: [1, 2, 3, 4, 5, 6] });
    {
      const ctx = await waiterContext({});
      const { page } = await openPanel(ctx);
      await page.waitForFunction(() => Array.isArray(state.summary.my_tables), null, { timeout: 15000 }).catch(() => {});
      const f = await page.evaluate(() => ({ tiles: [...document.querySelectorAll("#tiles .tile")].map((t) => t.dataset.t), strip: document.getElementById("mySection").innerText.replace(/\s+/g, " "), all: floorFilterCounts()[0][2], my: state.summary.my_tables }));
      await check(id(), F_APP, "a waiter with section 1–6 sees exactly tables 1–6 on the floor", LV, async () => ok(f.tiles.filter((t) => Number(t) <= count).join(",") === "1,2,3,4,5,6", f.tiles.join(",")));
      await check(id(), F_APP, "…the strip reads 'Your tables 1–6 · 6 tables'", LV, async () => ok(/Your tables\s*1–6\s*6 tables/.test(f.strip), f.strip));
      await check(id(), F_APP, "…and the All chip counts 6, not the restaurant's floor", LV, async () => ok(f.all === 6, String(f.all)));
      await check(id(), F_APP, "…the server sent only that waiter's tables (the rota is the server's, not the screen's)", LV, async () => ok(Array.isArray(f.my) && f.my.map(Number).join(",") === "1,2,3,4,5,6", JSON.stringify(f.my)));
      const qd = await page.evaluate(async () => { openQuickOrder(); await new Promise((r) => setTimeout(r, 300)); const d = state.data.dishes.find((x) => !(x.tags || []).includes("sold-out") && !x.open_price && !(x.options || []).length); state.cart.push({ id: d.id, title: d.title, price: 1, qty: 1 }); openQuickDest(); await new Promise((r) => setTimeout(r, 200)); const ids = [...document.querySelectorAll("[data-qdest]")].map((b) => b.dataset.qdest); document.querySelector(".qdest-x").click(); state.cart = []; exitOrderMode(); return ids; });
      await check(id(), F_APP, "…⚡ Quick order's table picker offers only tables 1–6", LV, async () => ok(qd.join(",") === "1,2,3,4,5,6", qd.join(",")));
      const why = await page.evaluate(() => [shiftBlockedWhy(9, 1), shiftBlockedWhy(2, 1)]);
      await check(id(), F_APP, "…Change table labels a table outside the section 'not yours', and never one inside it", LV, async () => ok(why[0] === "not yours" && why[1] !== "not yours", JSON.stringify(why)));
      const bellRows = await page.evaluate(() => { const mine = new Set(floorTableList().filter(inMySection).map(String)); return (state.summary.calls || []).every((c) => mine.has(String(c.table_number))); });
      await check(id(), F_APP, "…every waiter call it can see is on one of its own tables", LV, async () => ok(bellRows));
      await ctx.close();
    }
    // A rota naming tables beyond the floor (item 7): the strip counts only real ones.
    await db(`staff_users?id=eq.${waiter.id}&restaurant_id=eq.${RID}`, "PATCH", { assigned_tables: Array.from({ length: 500 }, (_, i) => i + 1) });
    {
      const ctx = await waiterContext({});
      const { page } = await openPanel(ctx);
      await page.waitForFunction(() => Array.isArray(state.summary.my_tables), null, { timeout: 15000 }).catch(() => {});
      const strip = await page.evaluate(() => document.getElementById("mySection").innerText.replace(/\s+/g, " "));
      await check(id(), F_APP, `item 7 live: a 1–500 rota on a ${count}-table floor reads 'Your tables 1–${count} · ${count} tables'`, LV, async () => ok(new RegExp(`1–${count}\\s*${count} tables`).test(strip), strip));
      await ctx.close();
    }
    await restoreRota();

    // ── L2 · the admin looking in, through the X-ray ─────────────────────────────────────────────
    {
      const b = await browser();
      const ctx = await b.newContext({ viewport: { width: 1194, height: 834 } });
      await ctx.addCookies([adminCookie(BASE)]);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/panels/tablet/index.html?rid=${RID}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => typeof state !== "undefined" && state.settingsSettled && TABLET_WHO, null, { timeout: 30000 });
      await sleep(1200);
      const x = await page.evaluate(() => ({ rib: document.getElementById("xrayRibbon")?.innerText.replace(/\s+/g, " ") || "", higher: tHigher(), rid: PANEL_RID, asked: performance.getEntriesByType("resource").map((e) => e.name).filter((u) => /\/api\/tablet\//.test(u)) }));
      await check(id(), F_APP, "the admin's view of the tablet carries the 'Admin view' ribbon and its breadcrumbs", LV + " (admin cookie)", async () => ok(/Admin view/i.test(x.rib) && /Dashboard/.test(x.rib) && /Tablet panel/.test(x.rib), x.rib.slice(0, 120)));
      await check(id(), F_APP, "…the server answered it as the higher view (it decided, not the page)", LV + " (admin cookie)", async () => ok(x.higher === true));
      await check(id(), F_APP, "…every read it made carried its ?rid pin", LV + " (admin cookie)", async () => ok(x.asked.length > 0 && x.asked.every((u) => u.includes("rid=" + RID)), `${x.asked.length} reads`));
      await check(id(), F_APP, "…and the ribbon has an Exit view button that leaves the act-as", LV + " (admin cookie)", async () => ok(await visible(page, "#xrayExit")));
      const real = await ctx.newPage();
      await real.goto(`${BASE}/panels/tablet/index.html?rid=${RID}&view=real`, { waitUntil: "domcontentloaded" });
      await real.waitForFunction(() => typeof state !== "undefined" && state.settingsSettled && TABLET_WHO, null, { timeout: 30000 });
      await sleep(1000);
      const rv = await real.evaluate(() => ({ sim: tSim(), higher: tHigher(), tint: document.querySelectorAll(".xray-off").length, rib: document.getElementById("xrayRibbon")?.innerText || "" }));
      await check(id(), F_APP, "…'See the actual tablet panel' (?view=real) shows the real waiter screen: no tinted extras", LV + " (admin cookie)", async () => ok(rv.sim === true && rv.higher === false && rv.tint === 0, JSON.stringify(rv).slice(0, 140)));
      await check(id(), F_APP, "…and still says whose view it is, with the way back to the full admin view", LV + " (admin cookie)", async () => ok(/as real tablet|Admin view · as/i.test(rv.rib) && /See full admin view/i.test(rv.rib), rv.rib.replace(/\s+/g, " ").slice(0, 120)));
      await ctx.close();
    }

    // ── L3 · the server misbehaving — one answer from a stand-in each time ───────────────────────
    {
      const ctx = await waiterContext({});
      const { page } = await openPanel(ctx);
      await recordToasts(page);
      // a WRITE answered 500 → it is a busy system, so the work is SAVED, never dropped
      await page.route("**/api/tablet/requests/*/resolve", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }));
      const busy = await page.evaluate(async () => { const r = await api("POST", "/requests/00000000-0000-0000-0000-00000000dead/resolve", { status: "denied" }); const q = window.LFH_OUTBOX.getSnapshot().queued.filter((x) => /requests\//.test(x.path)); for (const it of q) await window.LFH_OUTBOX.dismiss(it.id); return { r, q: q.length }; });
      await page.unroute("**/api/tablet/requests/*/resolve");
      await check(id(), F_APP, "a write the server cannot take right now (500) is SAVED on the device, not lost", NT, async () => ok(busy.r && busy.r.queued === true && busy.r.why === "busy" && busy.q === 1, JSON.stringify(busy)));
      await check(id(), F_APP, "…and the sentence a waiter would read for it says the system is busy", NT, async () => ok(/busy/.test(await page.evaluate(() => savedMsg({ why: "busy" })))));
      // a refusal on the merits (409 clash) → told, both halves
      await page.route("**/api/tablet/items/*/qty", (r) => r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "clash_changed_elsewhere", clash: { plain: "Someone else changed the quantity while you had it open — it now says 4.", todo: "Your change was NOT saved. Look at what it says now and redo yours if it's still right." } }) }));
      await page.evaluate(() => { state.data.items = state.data.items.concat([{ id: "t12r2-stand-in", order_id: "x", qty: 1, status: "preparing" }]); bumpItemQty("t12r2-stand-in", +1); });
      await sleep(1200);
      await page.unroute("**/api/tablet/items/*/qty");
      await check(id(), F_APP, "a clash on a live save is shown with BOTH halves — what happened and that theirs was not saved", NT, async () => { const t = await said(page); return ok(/it now says 4/.test(t) && /NOT saved/.test(t), t.slice(0, 160)); });
      // a wrong PIN → the box asks again, saying so
      let pinTries = 0;
      await page.route("**/api/tablet/tables/*/unpay", (r) => { pinTries++; r.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "A manager PIN is required for this.", needPin: true }) }); });
      await page.evaluate(() => { actGated("POST", "/tables/1/unpay", { reason: "t" }, { message: "PIN?" }); });
      await page.waitForSelector(".pp-in", { timeout: 8000 });
      await page.fill(".pp-in", "1111"); await page.click(".pp-ok");
      await page.waitForFunction(() => /didn't match/.test(document.querySelector(".pp-err")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
      const pinErr = await page.evaluate(() => document.querySelector(".pp-err")?.textContent || "");
      await page.click(".pp-cancel").catch(() => {});
      await page.unroute("**/api/tablet/tables/*/unpay");
      await check(id(), F_APP, "a PIN the server does not accept is asked for again, saying it did not match", NT, async () => ok(/didn't match/.test(pinErr) && pinTries === 2, `${pinTries} tries · ${pinErr}`));
      await check(id(), F_APP, "…and cancelling the second ask leaves nothing sent and nothing shown as done", NT, async () => { const t = await said(page); return ok(pinTries === 2 && !/reopened|unpaid/i.test(t), t.slice(0, 120)); });
      // a device the staff blocked → black wall, and the panel stops asking
      // At the panel's own read helper: a service worker answers /api/tablet reads, and a browser-level
      // route never sees what it answers.
      await page.evaluate(() => { window.__realNet = window.LFH_NET.fetch; window.LFH_NET.fetch = (u, o) => /\/api\/tablet\/summary/.test(String(u)) ? Promise.resolve(new Response(JSON.stringify({ error: "This device has been blocked.", reason: "device_blocked" }), { status: 403, headers: { "Content-Type": "application/json" } })) : window.__realNet(u, o); });
      await page.evaluate(() => load().catch(() => {}));
      await sleep(800);
      const wall = await page.evaluate(() => { const w = document.getElementById("lfh-blocked-wall"); return { up: !!w, text: w ? w.innerText : "", z: w ? getComputedStyle(w).zIndex : "" }; });
      let afterWall = 0; page.on("request", (q) => { if (q.url().includes("/api/tablet/")) afterWall++; });
      await page.evaluate(async () => { try { await api("GET", "/summary"); } catch {} try { await api("POST", "/calls/x/attend"); } catch {} });
      await sleep(600);
      await page.evaluate(() => { if (window.__realNet) window.LFH_NET.fetch = window.__realNet; });
      await check(id(), F_APP, "a blocked device goes fully black with who to ask, and nothing about why", NT, async () => ok(wall.up && /This device has been blocked/.test(wall.text) && /Ask a manager/.test(wall.text) && !/reason|because/i.test(wall.text), JSON.stringify(wall)));
      await check(id(), F_APP, "…and from then on it asks the server for NOTHING", NT, async () => ok(afterWall === 0, `${afterWall} request(s) after the wall`));
      await ctx.close();
    }
    {
      const ctx = await waiterContext({});
      const page = await ctx.newPage();
      await page.route("**/api/tablet/summary*", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Server can't reach the database — retrying.", busy: true }) }), { times: 1 });
      await page.addInitScript(() => { window.__tt = []; document.addEventListener("DOMContentLoaded", () => new MutationObserver((ms) => { for (const m of ms) for (const x of m.addedNodes) if (x.classList && x.classList.contains("toast")) window.__tt.push(x.innerText); }).observe(document.getElementById("toasts"), { childList: true })); });
      await page.goto(BASE + "/panels/tablet/index.html", { waitUntil: "domcontentloaded" });
      await sleep(3500);
      const r = await page.evaluate(() => ({ t: (window.__tt || []).join(" | "), tiles: document.querySelectorAll("#tiles .tile").length, boot: !!document.querySelector("#tiles .floor-booting") }));
      await check(id(), F_APP, "a busy database at the first load never shows a waiter the word 'database' or a code", NT, async () => ok(!/database|TimeoutError|503/i.test(r.t), r.t || "(nothing said)"));
      await check(id(), F_APP, "…and the floor still draws (no endless loading block)", NT, async () => {
        for (let i = 0; i < 10 && !(await page.evaluate(() => document.querySelectorAll("#tiles .tile").length)); i++) await sleep(1000);
        return ok((await page.evaluate(() => document.querySelectorAll("#tiles .tile").length)) > 0, `${r.tiles} tiles at 3.5s`);
      });
      await ctx.close();
    }

    // ── L4 · opened with NO internet at all (from the device's saved copy) ───────────────────────
    {
      const ctx = await waiterContext({});
      const { page } = await openPanel(ctx);
      await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 20000 }).catch(() => {});
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => typeof state !== "undefined" && state.settingsSettled, null, { timeout: 30000 });
      await sleep(1500);
      await ctx.setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await sleep(4000);
      const off = await page.evaluate(() => ({ tiles: document.querySelectorAll("#tiles .tile").length, name: document.getElementById("restName")?.textContent || "", bar: document.body.innerText.match(/no internet|offline|saved/i)?.[0] || "" })).catch(() => ({ tiles: 0, name: "", bar: "" }));
      await check(id(), F_APP, "reopened with NO internet, the tablet still opens its floor from the device's saved copy", LV + " (offline)", async () => ok(off.tiles > 0, `${off.tiles} tiles`));
      await check(id(), F_APP, "…still names its restaurant", LV + " (offline)", async () => ok(/French House/i.test(off.name), off.name));
      await check(id(), F_HTML, "…and says plainly that it is offline / showing saved data", LV + " (offline)", async () => ok(!!off.bar, off.bar || "(nothing said)"));
      await ctx.setOffline(false);
      await ctx.close();
    }

    // ── L5 · two waiters on one dish in the same instant (item 10, migration 422) ─────────────────
    {
      const c1 = await waiterContext({}), c2 = await waiterContext({});
      const { page: p1 } = await openPanel(c1), { page: p2 } = await openPanel(c2);
      const dish = await p1.evaluate(() => state.data.dishes.find((x) => !(x.tags || []).includes("sold-out") && !x.open_price && !(x.options || []).length).id);
      await p1.evaluate(async ({ t, d }) => api("POST", "/order", { table: t, items: [{ id: d, qty: 1 }], allergies: [] }), { t: T1, d: dish });
      let item = null;
      for (let i = 0; i < 20 && !item; i++) {
        await sleep(1000);
        const os = await db(`orders?restaurant_id=eq.${RID}&table_number=eq.${T1}&archived=is.false&select=id&order=created_at.desc&limit=1`);
        if (os.length) item = (await db(`order_items?restaurant_id=eq.${RID}&order_id=eq.${os[0].id}&select=id&limit=1`))[0] || null;
      }
      if (!item) throw new Error(`the stand-in order on T${T1} never appeared`);
      for (const p of [p1, p2]) { await p.evaluate((t) => selectTable(t), T1); await p.waitForFunction((t) => sliceLoaded(t), T1, { timeout: 20000 }); await recordToasts(p); }
      await Promise.all([p1.evaluate((i) => bumpItemQty(i, +1), item.id), p2.evaluate((i) => bumpItemQty(i, +2), item.id)]);
      for (let i = 0; i < 25; i++) { await sleep(1000); if (/not saved/i.test((await said(p1)) + (await said(p2)))) break; }
      await sleep(2500);
      const q = (await db(`order_items?restaurant_id=eq.${RID}&id=eq.${item.id}&select=qty&limit=1`))[0]?.qty;
      const s1 = await said(p1), s2 = await said(p2);
      await check(id(), F_APP, "two waiters on one dish in the same instant: the dish holds ONE of their numbers (2 or 3)", LV + " + DB", async () => ok(q === 2 || q === 3, `qty ${q}`));
      await check(id(), F_APP, "…and the one whose number did NOT stick is told it was not saved (item 10 — they now take turns)", LV, async () => ok(/not saved/i.test(q === 2 ? s2 : s1), `kept ${q} · device1: ${s1.slice(0, 60) || "-"} · device2: ${s2.slice(0, 60) || "-"}`));
      await check(id(), F_APP, "…and the one whose number stuck is told nothing went wrong", LV, async () => ok(!/not saved|Failed/i.test(q === 2 ? s1 : s2), (q === 2 ? s1 : s2) || "(nothing)"));
      await check(id(), F_APP, "…and both screens end on the number that was kept", LV, async () => { await sleep(1500); const a = await p1.evaluate((i) => state.data.items.find((x) => x.id === i)?.qty, item.id), b = await p2.evaluate((i) => state.data.items.find((x) => x.id === i)?.qty, item.id); return ok(a === q && b === q, `${a} / ${b} / kept ${q}`); });
      await check(id(), "lib/clash.ts", "…and no turn is left held on that dish after both saves finished", "DB", async () => { const t = await db(`edit_turns?restaurant_id=eq.${RID}&turn_key=like.*${item.id}*&select=turn_key&limit=5`); return ok(t.length === 0, `${t.length} left`); });
      await c1.close(); await c2.close();
    }

    // ── L6 · the back button across chained boxes (T16's fix, merged 2026-10-13) ─────────────────
    {
      const ctx = await waiterContext({});
      const page = await ctx.newPage();
      await page.goto(BASE + "/panels/tablet/index.html?prev=1", { waitUntil: "domcontentloaded" });
      await page.goto(BASE + "/tablet", { waitUntil: "domcontentloaded" });
      const F = await panelFrame(page);
      await F.waitForFunction(() => typeof state !== "undefined" && state.settingsSettled, null, { timeout: 30000 });
      await sleep(1200);
      const stays = async (label, run) => {
        await run();
        await sleep(1800);
        const there = page.url().endsWith("/tablet") && page.frames().some((f) => f.url().includes("/panels/tablet/index.html") && !f.url().includes("prev=1"));
        await check(id(), F_APP, label, LV + " (inside /tablet)", async () => ok(there, page.url()));
      };
      await stays("↩ Mark unpaid → Yes → Cancel on the reason box: the waiter is still on the tablet (was thrown back a page)", async () => {
        await F.evaluate(() => { markBillUnpaid("1"); });
        await F.waitForSelector("#confirmYes:not([hidden])", { timeout: 5000 }).catch(() => {});
        await F.evaluate(() => document.getElementById("confirmYes").click());
        await F.waitForSelector(".rp-cancel", { timeout: 5000 });
        await F.click(".rp-cancel");
      });
      await stays("…and a confirm answered No, then the PIN box opened and cancelled, also stays", async () => {
        await F.evaluate(() => { confirmDialog("x").then(() => pinPrompt("y")); });
        await sleep(300); await F.evaluate(() => document.getElementById("confirmNo").click());
        await F.waitForSelector(".pp-cancel", { timeout: 5000 }); await F.click(".pp-cancel");
      });
      await check(id(), F_APP, "…BACK with nothing open DOES leave the panel (no trap)", LV + " (inside /tablet)", async () => {
        await F.evaluate(() => history.back()); await sleep(1500);
        return ok(page.url().includes("prev=1"), page.url());
      });
      await ctx.close();
    }

    // ── L7 · this round's fixes, live ────────────────────────────────────────────────────────────
    {
      const ctx = await waiterContext({});
      const page = await ctx.newPage();
      await page.addInitScript(() => { try { localStorage.setItem("lfh_tablet_menu", JSON.stringify({ dishes: [{ id: "other-restaurant", title: "Not ours", price: 1, category: "x" }], categories: [] })); } catch {} });
      await page.goto(BASE + "/tablet", { waitUntil: "domcontentloaded" });
      const F = await panelFrame(page);
      await F.waitForFunction(() => typeof state !== "undefined" && state.settingsSettled, null, { timeout: 30000 });
      await sleep(1500);
      const m = await F.evaluate(() => ({ old: localStorage.getItem("lfh_tablet_menu"), mine: Object.keys(localStorage).filter((k) => k.startsWith("lfh_tablet_menu:")), foreign: (state.data.dishes || []).some((d) => d.id === "other-restaurant"), rid: panelRid() }));
      await check(id(), F_APP, "item 8 live: an old device-wide menu copy is never shown — it is removed at boot", LV, async () => ok(m.old === null && !m.foreign, JSON.stringify({ old: m.old ? "present" : null, foreign: m.foreign })));
      await check(id(), F_APP, "…and the menu is saved under THIS restaurant's own key", LV, async () => ok(m.mine.includes("lfh_tablet_menu:" + m.rid), m.mine.join(",")));
      await ctx.close();
    }
    for (const dark of [false, true]) {
      const ctx = await waiterContext({ width: 360, height: 780, dpr: 3, mobile: true, dark });
      const { page } = await openPanel(ctx, { theme: dark ? "dark" : "light" });
      const r = await page.evaluate(() => [...document.querySelectorAll("#tiles .tile.t-free")].map((t) => { const w = t.querySelector(".t-line-plain .t-linenum"); const cs = w && getComputedStyle(w); const tr = t.getBoundingClientRect(), wr = w && w.getBoundingClientRect(); return { shown: cs && cs.display !== "none", fits: wr && wr.width > 0 && wr.right <= tr.right + 0.5, text: w && w.textContent, color: cs && cs.color, bg: getComputedStyle(t).backgroundColor }; }));
      await check(id(), F_APP, `item 12 live (${dark ? "dark" : "light"} skin, 360px): every free tile says "Free", inside its own box`, LV, async () => ok(r.length > 0 && r.every((x) => x.shown && x.fits && x.text === "Free"), `${r.filter((x) => x.shown && x.fits).length}/${r.length}`));
      await ctx.close();
    }

    // ── L8 · a whole service on a PHONE, real taps only (no in-page fallbacks) ───────────────────
    {
      const ctx = await waiterContext({ width: 360, height: 780, dpr: 3, mobile: true });
      const { page } = await openPanel(ctx);
      await recordToasts(page);
      const tap = (sel) => page.locator(sel).first().tap({ timeout: 8000 });
      const step = async (label, fn) => { let note = ""; let good = true; try { note = (await fn()) || ""; } catch (e) { good = false; note = String(e.message || e).split("\n")[0].slice(0, 160); } await check(id(), F_APP, label, "LIVE — A35 360×780, real taps", async () => ok(good, note)); return good; };
      await step(`tapping free table ${T2}'s tile opens the order builder`, async () => { await page.locator(`#tiles .tile[data-t="${T2}"]`).scrollIntoViewIfNeeded(); await tap(`#tiles .tile[data-t="${T2}"]`); await page.waitForSelector("#omScroll .dish", { timeout: 15000 }); });
      const dish = await page.evaluate(() => { const d = state.data.dishes.find((x) => !(x.tags || []).includes("sold-out") && !x.open_price && !(x.options || []).length); return d && d.id; });
      await step("a dish tile takes a real tap (×1 on its badge)", async () => { await page.locator(`#omScroll .dish[data-dish="${dish}"]`).scrollIntoViewIfNeeded(); await tap(`#omScroll .dish[data-dish="${dish}"] .dname`); await page.waitForFunction((d) => state.cart.some((l) => l.id === d), dish, { timeout: 5000 }); });
      await step("the floating 'View order' pill takes a real tap and opens the order", async () => { await tap("#omViewBtn"); await page.waitForSelector("#sendOrder", { timeout: 5000 }); });
      await step("SEND takes a real tap and asks first", async () => { await tap("#sendOrder"); await page.waitForSelector("#confirmOverlay:not([hidden])", { timeout: 5000 }); });
      await step("'Yes, send it' takes a real tap and the kitchen ticket number is said", async () => { await tap("#confirmYes"); await page.waitForFunction(() => (window.__tt || []).some((t) => /Kitchen ticket #\d+|saved/i.test(t)), null, { timeout: 30000 }); return (await said(page)).slice(-80); });
      await settleFor(page);
      await page.evaluate(() => load().catch(() => {})); await settleFor(page);
      await step(`after sending, the phone shows table ${T2}'s own popup (or one real tap on its tile opens it)`, async () => {
        if (await visible(page, ".detail-pop #closeTable")) return "already open after the send";
        if (await visible(page, "#tabletClose")) { await tap("#tabletClose"); await sleep(400); }
        await page.locator(`#tiles .tile[data-t="${T2}"]`).scrollIntoViewIfNeeded(); await tap(`#tiles .tile[data-t="${T2}"] .tnum`);
        await page.waitForSelector(".detail-pop #closeTable", { timeout: 20000 }); return "opened from the floor";
      });
      await step("the popup fits the phone (nothing wider than 360px)", async () => { const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.querySelector(".detail-pop").getBoundingClientRect().right]); if (w[0] > 361 || w[1] > 361) throw new Error(JSON.stringify(w)); return JSON.stringify(w); });
      await step("'🍽️ Serve all' takes a real tap", async () => { await page.locator("[data-serve-all]").scrollIntoViewIfNeeded(); await tap("[data-serve-all]"); await page.waitForFunction(() => state.data.items.every((i) => i.status === "served"), null, { timeout: 8000 }); });
      await settleFor(page, 3500);
      await step("'💳 Mark bill paid' takes a real tap and opens the pay sheet", async () => { await page.evaluate(() => load().catch(() => {})); await settleFor(page); await page.waitForSelector("#payBill", { timeout: 15000 }); await page.locator("#payBill").scrollIntoViewIfNeeded(); await tap("#payBill"); await page.waitForSelector('.pay-method-btn[data-method="Cash"]', { timeout: 8000 }); });
      await step("the pay sheet fits the phone and Cash is a real finger target (≥ 60px tall)", async () => { const h = await page.evaluate(() => [document.documentElement.scrollWidth, Math.round(document.querySelector('.pay-method-btn[data-method="Cash"]').getBoundingClientRect().height)]); if (h[0] > 361 || h[1] < 60) throw new Error(JSON.stringify(h)); return JSON.stringify(h); });
      await step("Cash takes a real tap and the bill is paid (server agrees)", async () => { await page.locator('.pay-method-btn[data-method="Cash"]').scrollIntoViewIfNeeded(); await tap('.pay-method-btn[data-method="Cash"]'); for (let i = 0; i < 20; i++) { const o = await db(`orders?restaurant_id=eq.${RID}&table_number=eq.${T2}&archived=is.false&select=payment_status&limit=5`); if (o.length && o.every((x) => x.payment_status === "paid")) return "paid"; await sleep(1000); } throw new Error("never paid"); });
      await settleFor(page, 6000);
      await step("'✕ Close table' takes a real tap and asks first", async () => { await page.evaluate(() => load().catch(() => {})); await settleFor(page); if (!(await visible(page, "#closeTable"))) { await page.locator(`#tiles .tile[data-t="${T2}"]`).scrollIntoViewIfNeeded(); await tap(`#tiles .tile[data-t="${T2}"] .tnum`); } await page.waitForSelector("#closeTable", { timeout: 15000 }); await page.locator("#closeTable").scrollIntoViewIfNeeded(); await tap("#closeTable"); await page.waitForSelector("#confirmOverlay:not([hidden])", { timeout: 5000 }); return await page.evaluate(() => document.getElementById("confirmText").textContent); });
      await step("'Close table' takes a real tap and the table is free again (server agrees)", async () => { await tap("#confirmYes"); for (let i = 0; i < 20; i++) { const s = await db(`sessions?restaurant_id=eq.${RID}&table_number=eq.${T2}&status=eq.open&select=id&limit=2`); if (!s.length) return "free"; await sleep(1000); } throw new Error("still open"); });
      await step("☰ takes a real tap and the drawer opens", async () => { await tap("#hamburger"); await page.waitForFunction(() => document.querySelector(".tbl-drawer").classList.contains("open"), null, { timeout: 5000 }); });
      await step("the drawer's 🚩 Report an issue row exists on the phone (the top bar hides its 🚩 here)", async () => { if (!(await visible(page, "#dwIssue"))) throw new Error("no issue row"); });
      await step("the drawer's ✕ takes a real tap and closes it", async () => { await tap(".dw-close"); await page.waitForFunction(() => !document.querySelector(".tbl-drawer").classList.contains("open"), null, { timeout: 5000 }); });
      await step("⚡ takes a real tap on the phone (the ⚡ alone, its word dropped)", async () => { await tap("#quickOrderBtn"); await page.waitForSelector("#omScroll", { timeout: 8000 }); const w = await page.evaluate(() => getComputedStyle(document.querySelector("#quickOrderBtn .qo-word")).display); await page.evaluate(() => exitOrderMode()); return "word display " + w; });
      await ctx.close();
    }

    // ── L9 · the keyboard and the screen reader ──────────────────────────────────────────────────
    {
      const ctx = await waiterContext({ touch: false });
      const { page } = await openPanel(ctx);
      const box = async (open, inSel, label) => {
        await page.evaluate((o) => { window.__p = (0, eval)(o); }, open);
        await page.waitForSelector(inSel, { timeout: 5000 });
        await sleep(150);
        const focused = await page.evaluate((s) => document.activeElement === document.querySelector(s), inSel);
        await page.keyboard.press("Escape");
        await sleep(200);
        const gone = await page.evaluate((s) => !document.querySelector(s), inSel);
        const res = await page.evaluate(() => Promise.race([window.__p, new Promise((r) => setTimeout(() => r("(still open)"), 3000))]));
        await check(id(), F_APP, `${label}: the cursor is already in its box, and Escape closes it answering 'cancelled'`, "LIVE — keyboard", async () => ok(focused && gone && res === null, JSON.stringify({ focused, gone, res })));
      };
      await box("pinPrompt('k')", ".pp-in", "the manager PIN box");
      await box("reasonPrompt('k')", ".rp-in", "the reason box");
      await box("pricePrompt('k')", ".pr-in", "the price box");
      await box("allergyPrompt(new Set())", ".alg-in", "the add-an-allergy box");
      await box("askAllergyReason('k')", ".alg-why-in", "the allergy-change reason box");
      await page.evaluate(() => { window.__p = pinPrompt("k"); });
      await page.waitForSelector(".pp-in"); await sleep(250);   // the box puts the cursor in itself 50ms after it opens
      await page.keyboard.type("4321"); await page.keyboard.press("Enter"); await sleep(150);
      await check(id(), F_APP, "Enter in the PIN box submits what was typed", "LIVE — keyboard", async () => ok((await page.evaluate(() => Promise.race([window.__p, new Promise((r) => setTimeout(() => r("(still open)"), 3000))]))) === "4321"));
      const icons = await page.evaluate(() => ["#hamburger", "#reportIssueBtn", "#quickOrderBtn"].map((s) => { const b = document.querySelector(s); return b ? (b.getAttribute("aria-label") || b.title || "") : "missing"; }));
      await check(id(), F_HTML, "every icon-only button on the top bar has a name a screen reader can say", "LIVE — accessibility tree", async () => ok(icons.every((x) => x && x !== "missing"), JSON.stringify(icons)));
      const toastX = await page.evaluate(() => { toast("a11y probe"); const x = [...document.querySelectorAll("#toasts .toast-x")].pop(); const name = x.getAttribute("aria-label"); x.click(); return name; });
      await check(id(), F_APP, "a toast's ✕ is named 'Dismiss' for a screen reader", "LIVE — accessibility tree", async () => ok(toastX === "Dismiss"));
      const loading = await page.evaluate(() => document.querySelector(".floor-booting, #tiles [role=status]") ? "present" : "gone after load");
      await check(id(), F_HTML, "the 'Loading your tables…' block is announced as a status and is gone once the floor loads", "LIVE — accessibility tree", async () => ok(loading === "gone after load", loading));
      const dialog = await page.evaluate(async () => { const p = confirmDialog("q"); const box = document.querySelector("#confirmOverlay"); const r = [box.getAttribute("role"), box.querySelector(".confirm-box")?.getAttribute("role")]; document.getElementById("confirmNo").click(); await p; return r; });
      await check(id(), F_HTML, "the are-you-sure box is marked as a dialog for a screen reader", "LIVE — accessibility tree", async () => ok(dialog.includes("dialog") || dialog.includes("alertdialog"), JSON.stringify(dialog)));
      await ctx.close();
    }

    // ── L10 · a change made on the MANAGER panel arriving on the tablet ──────────────────────────
    {
      const b = await browser();
      const mgr = await b.newContext(); await loginAs(mgr, "manager", BASE);
      const ctx = await waiterContext({});
      const { page } = await openPanel(ctx);
      const before = await page.evaluate((t) => summaryTile(t).state, T2);   // T2 is free again after L8
      const dish = await page.evaluate(() => state.data.dishes.find((x) => !(x.tags || []).includes("sold-out") && !x.open_price && !(x.options || []).length).id);
      const r = await mgr.request.post(`${BASE}/api/editor/order`, { data: { table: T2, items: [{ id: dish, qty: 1 }], allergies: [], confirmDuplicate: true } });
      let after = before, secs = 0;
      for (; secs < 20; secs++) { after = await page.evaluate((t) => summaryTile(t).state, T2); if (after !== before && after !== "free") break; await sleep(1000); }
      await check(id(), F_APP, "an order the MANAGER places reaches the waiter's floor by itself, well inside the 60s backstop", LV + " + the manager's own write", async () => ok(r.ok() && before === "free" && after !== "free" && secs < 20, `manager ${r.status()} · tile ${before} → ${after} after ~${secs}s`));
      await mgr.close(); await ctx.close();
    }

    // ── L11 · what an idle tablet costs ──────────────────────────────────────────────────────────
    {
      const ctx = await waiterContext({});
      const { page } = await openPanel(ctx);
      await sleep(2000);
      const seen = [];
      page.on("request", (q) => { if (q.url().includes("/api/")) seen.push(q.url().replace(BASE, "")); });
      await sleep(65000);
      const reads = seen.filter((u) => /\/api\/tablet\/(summary|state)/.test(u));
      await check(id(), F_APP, "an idle tablet on a live connection reads the floor at most about once a minute", LV + " (65s watched)", async () => ok(reads.length <= 2, `${reads.length} floor read(s): ${reads.slice(0, 3).join(", ")}`));
      await check(id(), F_APP, "…and never re-downloads the whole dish list while idle", LV + " (65s watched)", async () => ok(!reads.some((u) => /\/summary(\?|$)(?!.*nomenu)/.test(u) && !/nomenu=1/.test(u) && !/table=/.test(u)), reads.join(", ").slice(0, 160)));
      seen.length = 0;
      await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
      await sleep(65000);
      const hid = seen.filter((u) => /\/api\/tablet\/(summary|state)/.test(u));
      await check(id(), F_APP, "a tablet whose screen is hidden stops reading the floor", LV + " (65s hidden)", async () => ok(hid.length === 0, `${hid.length} read(s) while hidden`));
      await ctx.close();
    }
  } finally {
    await restoreRota().catch(() => {});
    await retireTables(used, () => {});
    await restoreNow().catch(() => {});
  }
  await check(id(), F_APP, "every table and the rota this block touched are back as they were", "DB", async () => {
    const s = await db(`sessions?restaurant_id=eq.${RID}&status=eq.open&table_number=in.(${used.join(",")})&select=table_number&limit=5`);
    const w = (await db(`staff_users?id=eq.${waiter.id}&restaurant_id=eq.${RID}&select=assigned_tables&limit=1`))[0];
    return ok(s.length === 0 && JSON.stringify(w.assigned_tables || []) === JSON.stringify(waiter.assigned_tables || []), `${s.length} open · rota ${JSON.stringify(w.assigned_tables || []).slice(0, 40)}`);
  });
  return { next: n };
}
