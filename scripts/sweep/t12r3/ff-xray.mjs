// scripts/sweep/t12r3/ff-xray.mjs — band F, group 6: the ADMIN looking at a waiter tablet — the ribbon,
// its "controls off for waiters" popout, the actual-tablet view, the person pin, and the way back to the
// console (which must stop acting as this restaurant on the way out). Fixture world: the "who am I"
// answer is the test's own, so no admin login is used and nothing is written anywhere.
import { ok } from "../t12s10/lib.mjs";
import { freshWorld, openWorld, seat, openTable, settle, BASE } from "./f-world.mjs";
import { browser } from "../t12s10/lib.mjs";
import { adminCookie } from "../login.mjs";

const F = "public/panels/tablet/app.js";
const H = "FIXTURE — the panel against the test's own server (nothing written)";
const RID = "00000000-0000-0000-0000-000000000001";
const scene = async (who, settings = {}, query = `rid=${RID}`, build) => {
  const w = freshWorld({ sessions_enabled: true, ...settings });
  w.whoami = { actor: "admin", higherView: false, simulated: false, asName: null, ...who };
  if (build) build(w);
  const { ctx, page } = await openWorld(w, {}, { query });
  // The console pages the ribbon leaves for are not part of this world: catch the navigation.
  await ctx.route(/\/aevinite/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>console</title>console" }));
  await page.waitForSelector("#xrayRibbon", { timeout: 8000 }).catch(() => {});
  return { w, ctx, page };
};
// textContent: the ribbon's tag is drawn in capitals by the stylesheet, the words underneath are not.
const ribbon = (page) => page.evaluate(() => { const r = document.getElementById("xrayRibbon"); if (!r) return ""; return [...r.children].filter((c) => c.id !== "xrayZones").map((c) => c.textContent.trim()).join(" ").replace(/\s+/g, " "); });

export async function blockFF(R, id) {
  const { check } = R;
  {
    const { w, ctx, page } = await scene({ higherView: true }, { tablet_discount: "off", tablet_table_tags: "off", tablet_khata: "off", tablet_invoice: "off" }, `rid=${RID}`, (w) => seat(w, 5, { orders: [{ status: "served" }] }));
    const rb = await ribbon(page);
    const expectOff = await page.evaluate(() => XRAY_CAPS.filter((c) => { const s2 = state.data.settings; if (c.key === "tablet_banquet" && !(s2.banquet_allowed === true && (s2.banquet_owner_control !== true || s2.banquet_enabled !== false))) return false; if (c.key === "tablet_table_ops" && !s2.table_ops_tablet_allowed) return false; return tperm(c.key) === "off"; }).length);
    await check(id(), F, "the admin looking in gets a ribbon: 'Admin view', the path Dashboard › restaurant › Tablet panel", H, () => ok(/^Admin view Dashboard ?› ?.+ ?› ?Tablet panel/.test(rb), rb));
    await check(id(), F, "…counting exactly the controls switched off for waiters ('3 controls off for waiters ▾')", H, () => ok(rb.includes(`${expectOff} control${expectOff === 1 ? "" : "s"} off for waiters ▾`) && expectOff === 3, `${rb} · expected ${expectOff}`));
    await openTable(page, 5);
    const tinted = await page.evaluate(() => ({ disc: document.getElementById("billDiscountBtn")?.className || "", inv: document.getElementById("genInvoiceBtn")?.className || "" }));
    await check(id(), F, "…a control that is off for waiters is still THERE for the admin, tinted", H, () => ok(/xray-off/.test(tinted.disc), JSON.stringify(tinted)));
    await page.click("#detailClose"); await settle(page, 200);
    await page.click("#xrayZonesBtn");
    const pop = await page.evaluate(() => [...document.querySelectorAll("#xrayZones .zrow")].map((r) => r.innerText.replace(/\s+/g, " ").trim()));
    await check(id(), F, "…the ▾ lists each off control with '⚙ change in Access', and a row to see the actual tablet", H, () => ok(pop.filter((x) => /change in Access/.test(x)).length === 3 && pop.some((x) => /See the actual tablet panel/.test(x)), pop.join(" | ")));
    await page.click(".phead, #floor", { position: { x: 5, y: 5 } }).catch(() => page.mouse.click(600, 600));
    await check(id(), F, "…a tap anywhere else closes the list", H, async () => ok(!(await page.$("#xrayZones"))));
    await page.click("#xrayZonesBtn"); await page.click("#xrayZonesBtn");
    await check(id(), F, "…and ▾ again closes it too", H, async () => ok(!(await page.$("#xrayZones"))));
    await page.click("#xrayZonesBtn");
    await page.evaluate(() => history.back()); await settle(page, 500);
    await check(id(), F, "…the phone's Back closes the list, not the panel", H, async () => ok(!(await page.$("#xrayZones")) && /tablet/.test(page.url())));
    await ctx.close();
  }
  {
    // THE ROW IS DRIVEN WHERE AN ADMIN REALLY MEETS IT — inside /r/<slug>/tablet's frame. Opened on its
    // own, the panel's list-closing step-back cancels the jump (measured); in the frame the jump is the
    // TOP page's and goes through. The page itself is the real one (read-only, as the admin); every data
    // answer inside the frame is still the world's.
    const b = await browser();
    const ctx = await b.newContext({ viewport: { width: 1194, height: 834 }, serviceWorkers: "block" });
    await ctx.addCookies([adminCookie(BASE)]);
    const w = freshWorld({ tablet_discount: "off" });
    w.whoami = { actor: "admin", higherView: true, simulated: false, asName: null };
    await ctx.route(/\/api\/tablet\//, (r) => { const u = new URL(r.request().url()); const p = u.pathname.slice("/api/tablet".length); const body = p === "/whoami" ? w.whoami : p === "/summary" ? w.summary : p === "/menu-sig" ? w.menuSig : p === "/state" ? { sessions: [], members: [], calls: [], orders: [], items: [], requests: [] } : { ok: true }; return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }); });
    await ctx.route(/\/api\/admin\/act-as/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await ctx.route(/\/aevinite\/access/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "ACCESS PAGE" }));
    const page = await ctx.newPage();
    await page.goto(`${BASE}/r/french-house/tablet`, { waitUntil: "domcontentloaded" });
    const fr = await (await page.waitForSelector("iframe", { timeout: 30000 })).contentFrame();
    await fr.waitForSelector("#xrayZonesBtn", { timeout: 30000 });
    await fr.click("#xrayZonesBtn");
    const key = await fr.evaluate(() => document.querySelector("#xrayZones .zrow[data-zk]").dataset.zk);
    await fr.click(`#xrayZones .zrow[data-zk="${key}"]`);
    await page.waitForURL(/\/aevinite\/access/, { timeout: 10000 }).catch(() => {});
    await check(id(), F, "…a row takes the admin (the whole page, not the frame) to Access, deep-linked to that exact control", H, () => ok(page.url().includes(`/aevinite/access?rid=${RID}&focus=${key}`), page.url()));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene({ higherView: true }, { tablet_discount: "on", tablet_table_tags: "on", tablet_khata: "on", tablet_mark_paid: "on", tablet_take_orders: "on", tablet_banquet: "on", tablet_table_ops: "on" });
    await page.click("#xrayZonesBtn");
    const t = await page.evaluate(() => document.getElementById("xrayZones").innerText.replace(/\s+/g, " "));
    await check(id(), F, "with nothing switched off the list says 'Nothing is off — waiters see everything you see.'", H, () => ok(/Nothing is off — waiters see everything you see\./.test(t), t));
    await Promise.all([page.waitForURL(/view=real/, { timeout: 8000 }).catch(() => {}), page.click("#xraySimRow")]);
    await check(id(), F, "…and 'See the actual tablet panel' reloads THIS tab as the real tablet (?view=real)", H, () => ok(/view=real/.test(page.url()) && page.url().includes(`rid=${RID}`), page.url()));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene({ higherView: true, asName: "Ravi" }, { tablet_discount: "off" });
    const rb = await ribbon(page);
    await check(id(), F, "pinned to one person, the ribbon says whose access it shows: 'Admin view · Ravi's access … 1 thing Ravi doesn't have ▾'", H, () => ok(/Admin view · Ravi's access/.test(rb) && /1 thing Ravi doesn't have ▾/.test(rb), rb));
    w.clear();
    await Promise.all([page.waitForURL(/\/aevinite\/restaurants/, { timeout: 8000 }).catch(() => {}), page.click("#xrayExit")]);
    await check(id(), F, "Exit view stops acting as this restaurant FIRST, then goes back to the console", H, () => { const a = w.sent("POST", /\/api\/admin\/act-as/); return ok(a.length === 1 && a[0].body && a[0].body.clear === true && /\/aevinite\/restaurants/.test(page.url()), page.url()); });
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene({ higherView: true });
    w.clear();
    await Promise.all([page.waitForURL(/\/aevinite$/, { timeout: 8000 }).catch(() => {}), page.click("#xrayHome")]);
    await check(id(), F, "the 'Dashboard' crumb also clears the act-as on its way (no silent re-entry for six hours)", H, () => ok(w.sent("POST", /\/api\/admin\/act-as/).length === 1 && /\/aevinite$/.test(page.url()), page.url()));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene({ higherView: true });
    w.clear();
    await Promise.all([page.waitForURL(/\/aevinite\/restaurants/, { timeout: 8000 }).catch(() => {}), page.click("#xrayRestLink")]);
    await check(id(), F, "…and so does the restaurant crumb", H, () => ok(w.sent("POST", /\/api\/admin\/act-as/).length === 1 && /\/aevinite\/restaurants/.test(page.url()), page.url()));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene({ higherView: false, simulated: true, asName: "Ravi" }, {}, `rid=${RID}&view=real&as=staff-1`);
    const rb = await ribbon(page);
    await check(id(), F, "the ACTUAL-tablet view keeps one admin trace: 'Admin view · as Ravi', with 'See full admin view' and Exit", H, () => ok(/^Admin view · as Ravi/.test(rb) && /See full admin view/.test(rb) && /Exit view/.test(rb), rb));
    await Promise.all([page.waitForURL((u) => !/view=real/.test(u.toString()), { timeout: 8000 }).catch(() => {}), page.click("#xrayFullBtn")]);
    await check(id(), F, "…'See full admin view' drops BOTH the real-view flag and the person pin", H, () => ok(!/view=real/.test(page.url()) && !/[?&]as=/.test(page.url()) && page.url().includes(`rid=${RID}`), page.url()));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene({ higherView: false, simulated: true, asName: null }, {}, `rid=${RID}&view=real`);
    await check(id(), F, "the actual view with no person pinned says 'as real tablet'", H, async () => ok(/^Admin view · as real tablet/.test(await ribbon(page)), await ribbon(page)));
    w.clear();
    await Promise.all([page.waitForURL(/\/aevinite\/restaurants/, { timeout: 8000 }).catch(() => {}), page.click("#xrayExit")]);
    await check(id(), F, "…and its Exit clears the act-as too", H, () => ok(w.sent("POST", /\/api\/admin\/act-as/).length === 1, page.url()));
    await ctx.close();
  }
  {
    // POWERS CHANGE WHILE THE TAB IS OPEN: the next whoami read repaints the ribbon's count.
    const { w, ctx, page } = await scene({ higherView: true }, { tablet_discount: "off" });
    const before = await ribbon(page);
    // The change lands the way a real Access edit does: the restaurant's settings change on the server,
    // the next read brings them, and a fresh "who am I" repaints.
    w.summary.settings.tablet_khata = "off"; w.summary.settings.tablet_table_tags = "off";
    w.whoami = { ...w.whoami, nonce: 2 };
    await page.evaluate(async () => { await load(); refreshWhoami(true); }); await settle(page, 900);
    const after = await ribbon(page);
    await check(id(), F, "an Access change reaches an open admin tab: a fresh 'who am I' redraws the count", H, () => ok(/1 control off/.test(before) && /3 controls off/.test(after), `${before} → ${after}`));
    const n0 = w.sent("GET", /^\/whoami/).length;
    await page.evaluate(() => { refreshWhoami(); refreshWhoami(); });
    await settle(page, 400);
    await check(id(), F, "…but menu churn cannot hammer it: a second ask within 5 seconds is skipped", H, () => ok(w.sent("GET", /^\/whoami/).length === n0, `${w.sent("GET", /^\/whoami/).length - n0} extra read(s)`));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene({ higherView: false, simulated: false }, {}, "");
    await check(id(), F, "a real waiter never sees a ribbon", H, async () => ok(!(await page.$("#xrayRibbon"))));
    await ctx.close();
  }
}
