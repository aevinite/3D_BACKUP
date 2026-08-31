// Sweep 7 T3, second pass — captures of screens no earlier pass photographed.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = process.env.T3_BASE || "http://localhost:4203";
const OUT = process.env.T3_SHOTS || new URL("../../../.claude/sweep/shots/T3", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const b = await chromium.launch();
// 1+2) a FINISHED order's strip, both skins
for (const th of ["dark", "light"]) {
  const ctx = await b.newContext(A35); const p = await ctx.newPage();
  await p.addInitScript((t) => {
    const now = Date.now();
    try {
      localStorage.setItem("lfh_theme", t);
      localStorage.setItem("lfh_active_orders:aangan-garden-restaurant", JSON.stringify([
        { id: "00000000-0000-4000-8000-000000000077", tableNumber: "3", total: 4.2, itemCount: 1,
          items: [{ title: "Virgin Mojito", qty: 1 }], status: "served", placedAt: now - 90000, finalizedAt: now - 90000 }]));
    } catch {}
  }, th);
  await p.goto(BASE + "/r/aangan-garden-restaurant/menu", { waitUntil: "domcontentloaded" });
  await p.locator(".food-card, .fc-card, [class*=card]").first().waitFor({ timeout: 60000 });
  await p.waitForTimeout(7000);
  await p.screenshot({ path: `${OUT}/s7b-a35-served-strip-${th}.png` });
  await ctx.close();
}
// 3) the drag-to-hide drop zone, mid-gesture
{
  const ctx = await b.newContext(A35); const p = await ctx.newPage();
  await p.addInitScript(() => {
    const now = Date.now();
    try { localStorage.setItem("lfh_active_orders:aangan-garden-restaurant", JSON.stringify([
      { id: "00000000-0000-4000-8000-000000000078", tableNumber: "3", total: 4.2, itemCount: 1,
        items: [{ title: "Virgin Mojito", qty: 1 }], status: "preparing", placedAt: now - 60000 }])); } catch {}
  });
  await p.goto(BASE + "/r/aangan-garden-restaurant/menu", { waitUntil: "domcontentloaded" });
  await p.locator(".food-card, .fc-card, [class*=card]").first().waitFor({ timeout: 60000 });
  await p.waitForTimeout(7000);
  const s = p.locator(".order-tracker"); const box = await s.boundingBox();
  if (box) {
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down(); await p.mouse.move(180, 780 * 0.68, { steps: 12 }); await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/s7b-a35-drag-to-hide.png` }); await p.mouse.up();
  }
  await ctx.close();
}
// 4) the bill's allergy section with one chosen
{
  const ctx = await b.newContext(A35); const p = await ctx.newPage();
  await p.goto(BASE + "/r/aangan-garden-restaurant/menu", { waitUntil: "domcontentloaded" });
  await p.locator(".food-card, .fc-card, [class*=card]").first().waitFor({ timeout: 60000 });
  await p.waitForTimeout(3000);
  await p.locator('button[aria-label^="Add"], .fc-plus').first().click({ force: true }); await p.waitForTimeout(1500);
  await p.locator(".order-confirm-close").click({ force: true }).catch(() => {}); await p.waitForTimeout(600);
  await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(1000);
  const chips = p.locator(".allergy-chips .allergy-toggle");
  if (await chips.count()) { await chips.nth(1).click({ force: true }); await p.waitForTimeout(800); }
  await p.locator(".allergy-section").scrollIntoViewIfNeeded().catch(() => {});
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/s7b-a35-allergy-chosen.png` });
  await ctx.close();
}
console.log("shots -> " + OUT);
await b.close();
