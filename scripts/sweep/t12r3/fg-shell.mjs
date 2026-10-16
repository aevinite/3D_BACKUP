// scripts/sweep/t12r3/fg-shell.mjs — band F, group 7: the panel's SHELL — the phone's one-step ✕, the
// ☰ drawer (who is signed in, the build, the theme, the bell, the banquet entry), the ⚙ Settings sheet
// and its sign-out, and the back button through all of them. Fixture world: nothing is written.
import { ok } from "../t12s10/lib.mjs";
import { freshWorld, openWorld, seat, openTable, tap, toastsNow, clearToastsNow, waitToast, settle } from "./f-world.mjs";

const F = "public/panels/tablet/app.js";
const H = "FIXTURE — the panel against the test's own server (nothing written)";
const PHONE = { width: 390, height: 844, touch: true, mobile: true, dpr: 2 };
const scene = async (build, settings = {}, device = {}, who) => {
  const w = freshWorld({ sessions_enabled: true, ...settings });
  if (who) w.whoami = { ...w.whoami, ...who };
  const made = (build && build(w)) || {};
  const { ctx, page } = await openWorld(w, device);
  return { w, ctx, page, ...made };
};
const openDrawer = async (page) => { await page.click("#hamburger"); await page.waitForSelector(".tbl-drawer.open", { timeout: 8000 }); await settle(page, 500); };   // it slides in from the right
const drawerOpen = (page) => page.evaluate(() => !!document.querySelector(".tbl-drawer.open"));

export async function blockFG(R, id) {
  const { check } = R;

  // ── the phone's ✕ peels one layer at a time ────────────────────────────────────────────────
  {
    const { ctx, page } = await scene((w) => { seat(w, 5, { orders: [{}] }); w.summary.dishes.unshift({ id: "t-opt", title: "Test Pizza", price: "300", category: w.summary.categories[0].slug, tags: [], options: [{ name: "Size", type: "single", choices: [{ label: "Small", price: 0 }] }] }); }, {}, PHONE);
    await openTable(page, 5); await tap(page, "#takeOrder"); await page.waitForSelector("#omScroll .dish");
    await page.click('#omScroll .dish[data-dish="t-opt"] .dname'); await page.waitForSelector("#optOverlay");
    // The popup covers the ✕, so the waiter's way out of it is the phone's Back (its own layer).
    await page.evaluate(() => history.back()); await settle(page, 500);
    await check(id(), F, "on a phone, Back first closes only the dish popup (the order stays open)", H, async () => ok(await page.evaluate(() => !document.getElementById("optOverlay") && state.ordering)));
    await page.click('#omScroll .dish:not(.out):not([data-dish="t-opt"]) .dname');
    await page.click("#omViewBtn"); await page.waitForSelector("#voBack");
    await page.evaluate(() => history.back()); await settle(page, 500);
    await check(id(), F, "…Back from the order review returns to the dishes (cart kept)", H, async () => ok(await page.evaluate(() => state.ordering && !state.viewOrder && state.cart.length === 1)));
    await page.evaluate(() => history.back()); await settle(page, 500);
    await check(id(), F, "…Back from the dishes returns to the table", H, async () => ok(await page.evaluate(() => !state.ordering && state.table === "5")));
    // The old full-screen ✕ (#tabletClose) is hidden under every popup the panel draws today — each has
    // its own ✕ — but its handler is still what the phone's Back runs for an open table.
    const xs = await page.evaluate(() => ({ old: getComputedStyle(document.getElementById("tabletClose")).display, own: !!document.getElementById("detailClose") }));
    await check(id(), F, "…the open table carries its own ✕ (the old full-screen one stays hidden under the popup)", H, () => ok(xs.old === "none" && xs.own, JSON.stringify(xs)));
    await page.evaluate(() => history.back()); await settle(page, 500);
    await check(id(), F, "…and Back from the table returns to the floor — one layer at a time, never all the way out", H, async () => ok(await page.evaluate(() => state.table === null) && /tablet/.test(page.url())));
    await ctx.close();
  }

  // ── the drawer ─────────────────────────────────────────────────────────────────────────────
  {
    // French House HAS the profile module (recorded profileModule: true) — this scene switches it off.
    const { w, ctx, page } = await scene((w) => { w.profile = { ...w.profile, profileModule: false }; }, {}, PHONE);
    await openDrawer(page);
    const d = await page.evaluate(() => ({ rest: document.getElementById("dwRest")?.textContent, name: document.getElementById("dwName")?.textContent, role: document.getElementById("dwRole")?.textContent, build: document.getElementById("dwBuild")?.textContent, v: new URL([...document.querySelectorAll('script[src*="app.js"]')].pop().src).searchParams.get("v") }));
    await check(id(), F, "☰ opens the drawer with the restaurant's name", H, () => ok(d.rest && d.rest !== "—" && d.rest.length > 2, d.rest));
    await check(id(), F, "…who is signed in (name, then role · username)", H, () => ok(d.name === "diagt1" && d.role === "tablet · diagt1", `${d.name} / ${d.role}`));
    await check(id(), F, "…and the build tag READ from the loaded code (tablet <hash>), never a typed date", H, () => ok(d.build === `tablet ${d.v}` && /^[0-9a-f]{8}$/.test(d.v), d.build));
    const me = await page.evaluate(() => { const r = document.getElementById("dwMeRow"); return r ? (r.hidden || getComputedStyle(r).display === "none") : "none"; });
    await check(id(), F, "…'My profile & pay' stays hidden where the restaurant has no profile module", H, () => ok(me === true || me === "none", String(me)));
    await page.click(".tbl-drawer-backdrop", { position: { x: 20, y: 700 } });   // the strip left of the drawer
    await settle(page, 300);
    await check(id(), F, "…a tap on the dim backdrop closes it", H, async () => ok(!(await drawerOpen(page))));
    await openDrawer(page); await page.click(".dw-close"); await settle(page, 300);
    await check(id(), F, "…so does its ✕", H, async () => ok(!(await drawerOpen(page))));
    await openDrawer(page); await page.evaluate(() => history.back()); await settle(page, 500);
    await check(id(), F, "…and the phone's Back closes the drawer, not the panel", H, async () => ok(!(await drawerOpen(page)) && /tablet/.test(page.url())));
    const reads = w.sent("GET", /\/api\/panel-profile/).length;
    await openDrawer(page);
    await check(id(), F, "…the profile is read once a session, not on every opening", H, () => ok(w.sent("GET", /\/api\/panel-profile/).length === reads, `${w.sent("GET", /\/api\/panel-profile/).length - reads} extra`));
    const t0 = await page.evaluate(() => document.documentElement.getAttribute("data-theme") || "");
    await page.click("#dwTheme"); await settle(page, 300);
    await check(id(), F, "…the theme row flips light/dark", H, async () => ok((await page.evaluate(() => document.documentElement.getAttribute("data-theme") || "")) !== t0));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => { w.profile = { ...w.profile, profileModule: true }; }, {}, PHONE);
    await openDrawer(page);
    const me = await page.evaluate(() => { const r = document.getElementById("dwMeRow"); return r && !r.hidden && getComputedStyle(r).display !== "none"; });
    await check(id(), F, "where the restaurant HAS the profile module, 'My profile & pay' shows in the drawer", H, () => ok(me === true));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene(null, { tablet_banquet: "off" }, PHONE);
    await openDrawer(page);
    const hid = await page.evaluate(() => { const b = document.getElementById("dwBanquet"); return !b || b.hidden || getComputedStyle(b).display === "none"; });
    await check(id(), F, "a waiter without banquet billing has no Banquet row in the drawer (absent, not greyed)", H, () => ok(hid));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene(null, { tablet_banquet: "off" }, PHONE, { higherView: true });
    await openDrawer(page);
    const b = await page.evaluate(() => { const x = document.getElementById("dwBanquet"); return x && { hidden: x.hidden, tint: x.classList.contains("xray-off") }; });
    await check(id(), F, "…while the admin looking in still sees it, tinted as off for waiters", H, () => ok(b && !b.hidden && b.tint, JSON.stringify(b)));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene(null, {}, PHONE);
    await page.evaluate(() => { try { delete window.LFH_BELL; } catch (e) { window.LFH_BELL = undefined; } });
    await openDrawer(page);
    const has = await page.$("#dwBell");
    if (has) {
      await clearToastsNow(page); await page.click("#dwBell");
      await check(id(), F, "the bell row on a restaurant whose guest menu is off says so, never a dead tap", H, async () => ok(await waitToast(page, /The guest menu is switched off, so there is nothing waiting\./), (await toastsNow(page)).join(" | ")));
    } else {
      await check(id(), F, "the bell row on a restaurant whose guest menu is off says so, never a dead tap", H, () => ok(true, "no bell row drawn here"));
    }
    await ctx.close();
  }

  // ── ⚙ Settings and signing out ─────────────────────────────────────────────────────────────
  {
    const { ctx, page } = await scene(null, {}, PHONE);
    await openDrawer(page); await page.click("#dwSettings"); await page.waitForSelector(".set-overlay");
    const f = await page.evaluate(() => { const fm = document.querySelector(".set-overlay form"); return { method: fm.method, action: new URL(fm.action).pathname, target: fm.target, btn: fm.querySelector("button").textContent, dialog: document.querySelector(".set-overlay [role=dialog]") ? 1 : 0 }; });
    await check(id(), F, "⚙ Settings opens a sheet whose Sign out is a POST to /api/panel-logout (a link can't sign anyone out by accident)", H, () => ok(f.method === "post" && f.action === "/api/panel-logout" && f.btn === "Sign out", JSON.stringify(f)));
    await check(id(), F, "…aimed at the WHOLE page (target=_top), so the waiter is really signed out, not just the frame", H, () => ok(f.target === "_top"));
    await check(id(), F, "…announced as a dialog, with the drawer closed behind it", H, async () => ok(f.dialog === 1 && !(await drawerOpen(page))));
    await page.evaluate(() => history.back()); await settle(page, 500);
    await check(id(), F, "…the phone's Back closes the sheet", H, async () => ok(!(await page.$(".set-overlay"))));
    await openDrawer(page); await page.click("#dwSettings"); await page.waitForSelector(".set-close"); await page.click(".set-close");
    await check(id(), F, "…and so does its ✕", H, async () => ok(!(await page.$(".set-overlay"))));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }));
    await page.click("#quickOrderBtn"); await page.waitForSelector("#omScroll .dish");
    await check(id(), F, "the top bar's ⚡ opens Quick order from anywhere", H, async () => ok(await page.evaluate(() => state.quick && state.ordering)));
    await ctx.close();
  }
}
