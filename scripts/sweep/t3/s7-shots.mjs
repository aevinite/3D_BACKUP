// Sweep 7 T3 — the captures I open and READ. Two new surfaces sweep 6 never captured:
// the saved REQUEST-FOR-STAFF row, and the live table bill with nothing to read. Plus both skins
// of the join-a-table gate, which sweep 6 only ever shot in one.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = process.env.T3_BASE || "http://localhost:4203";
const OUT = process.env.T3_SHOTS || "/Users/aevinite/Documents/Projects/wt-s7-t3/.claude/sweep/shots/T3";
mkdirSync(OUT, { recursive: true });
const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const b = await chromium.launch();
const skin = async (theme, fn) => {
  const ctx = await b.newContext(A35);
  const p = await ctx.newPage();
  await p.addInitScript((t) => { try { localStorage.setItem("lfh_theme", t); } catch {} }, theme);
  await fn(ctx, p);
  await ctx.close();
};
// 1+2) the saved request for staff, both skins
for (const t of ["dark", "light"]) {
  await skin(t, async (ctx, p) => {
    await p.goto(BASE + "/r/aangan-garden-restaurant/menu", { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(7000);
    await ctx.setOffline(true);
    await p.locator(".chef-call").click({ force: true }); await p.waitForTimeout(700);
    await p.locator("#chef-table").fill("3"); await p.waitForTimeout(250);
    await p.locator(".chef-reason", { hasText: "Bring the bill" }).first().click({ force: true });
    await p.waitForTimeout(1600);
    await p.locator(".gob-chip").click(); await p.waitForTimeout(700);
    await p.screenshot({ path: `${OUT}/s7-a35-saved-request-${t}.png` });
  });
}
// 3+4) the live table bill with nothing to read, both skins
for (const t of ["dark", "light"]) {
  const ctx = await b.newContext(A35);
  await ctx.route("**/rest/v1/rpc/lfh_session_state*", (r) => r.abort());
  const p = await ctx.newPage();
  await p.addInitScript((th) => {
    try {
      localStorage.setItem("lfh_theme", th);
      localStorage.setItem("lfh_session:french-house", JSON.stringify({ table: "7", token: "s7-shot-not-a-real-session", memberId: "shot", role: "owner" }));
    } catch {}
  }, t);
  await p.goto(BASE + "/r/french-house/menu", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(8000);
  await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(900);
  await p.locator(".cart-tabs button", { hasText: "Live status" }).click(); await p.waitForTimeout(3500);
  await p.screenshot({ path: `${OUT}/s7-a35-table-unreachable-${t}.png` });
  await ctx.close();
}
// 5) a MIXED queue — an order and a request together, the wording that has to cover both
await skin("dark", async (ctx, p) => {
  await p.goto(BASE + "/r/aangan-garden-restaurant/menu", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(7000);
  await p.locator('button[aria-label^="Add"], .fc-plus').first().click({ force: true }); await p.waitForTimeout(1200);
  await ctx.setOffline(true);
  await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(800);
  await p.locator("#cart-table").fill("3"); await p.waitForTimeout(300);
  await p.locator(".btn-gold", { hasText: "Place Order" }).first().click(); await p.waitForTimeout(2000);
  await p.locator(".chef-call").click({ force: true }); await p.waitForTimeout(700);
  await p.locator("#chef-table").fill("3"); await p.waitForTimeout(250);
  await p.locator(".chef-reason", { hasText: "Water" }).first().click({ force: true }); await p.waitForTimeout(1800);
  await p.locator(".gob-chip").click(); await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/s7-a35-mixed-queue.png` });
});
console.log("shots -> " + OUT);
await b.close();
