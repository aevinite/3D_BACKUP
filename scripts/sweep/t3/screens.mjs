// Block 4 — the captures I open and look at, plus the hit-test behind P01404/P01405.
import { chromium } from "playwright";
const OUT = "/private/tmp/claude-501/-Users-aevinite-Documents-Projects-backup-Menu/1bc01544-75e9-4b99-86fa-71e1146bb7df/scratchpad/shots";
const BASE = "http://localhost:4103", AA = "/r/aangan-garden-restaurant/menu";
const b = await chromium.launch();
const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1280, height: 800 } };
async function build(ctx, theme) {
  const p = await ctx.newPage();
  await p.addInitScript((th) => { try { localStorage.setItem("lfh_theme", th); } catch {} }, theme);
  await p.goto(BASE + AA, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(6500);
  for (let i = 0; i < 2; i++) { await p.locator('button[aria-label^="Add"], .fc-plus').nth(i).click().catch(() => {}); await p.waitForTimeout(900); }
  return p;
}
{ const ctx = await b.newContext(A35); const p = await build(ctx, "dark");
  await p.screenshot({ path: OUT + "/a35-menu-pill.png" });
  await p.locator(".mini-cart").click(); await p.waitForTimeout(1300);
  await p.locator("#cart-table").fill("4"); await p.waitForTimeout(400);
  await p.evaluate(() => { const el = document.getElementById("cart-panel"); if (el) el.scrollTop = 0; });
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + "/a35-bill-dark.png" });
  await ctx.close(); }
{ const ctx = await b.newContext(A35); const p = await build(ctx, "light");
  await p.locator(".mini-cart").click(); await p.waitForTimeout(1300);
  await p.screenshot({ path: OUT + "/a35-bill-light.png" });
  await ctx.close(); }
{ const ctx = await b.newContext(DESK); const p = await build(ctx, "dark");
  await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT + "/desk-bill-dark.png" });
  await ctx.close(); }
{ const ctx = await b.newContext(A35); const p = await build(ctx, "dark");
  await p.locator(".mini-cart").click(); await p.waitForTimeout(1300);
  await p.locator("#cart-table").fill("4");
  await ctx.setOffline(true);
  await p.locator(".btn-gold").first().click(); await p.waitForTimeout(2600);
  await p.evaluate(() => window.dispatchEvent(new Event("lfh:close-all"))); await p.waitForTimeout(900);
  await p.screenshot({ path: OUT + "/a35-outbox-chip.png" });
  // P01404/P01405 — the bottom-corner stack, measured rather than eyeballed
  const hit = await p.evaluate(() => {
    const out = { chip: null, strip: null, blocked: [], checked: 0, vh: innerHeight };
    const chip = document.querySelector(".gob-chip");
    if (chip) { const r = chip.getBoundingClientRect(); out.chip = { top: Math.round(r.top), bottom: Math.round(r.bottom) }; }
    const strip = [...document.querySelectorAll('div[role="status"]')].find((e) => getComputedStyle(e).position === "fixed");
    if (strip) { const r = strip.getBoundingClientRect(); out.strip = { top: Math.round(r.top), bottom: Math.round(r.bottom), pointer: getComputedStyle(strip).pointerEvents }; }
    document.querySelectorAll('button[aria-label^="Add"], .fc-plus, .mini-cart, .chef-call, .gob-chip').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= innerHeight || r.width === 0) return;
      out.checked++;
      const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (h !== el && !el.contains(h)) out.blocked.push((el.getAttribute("aria-label") || el.className || "?").toString().slice(0, 30));
    });
    return out;
  });
  console.log("HITTEST " + JSON.stringify(hit));
  await p.locator(".gob-chip").click(); await p.waitForTimeout(900);
  await p.screenshot({ path: OUT + "/a35-outbox-sheet.png" });
  await ctx.close(); }
{ const ctx = await b.newContext(A35); const p = await ctx.newPage();
  await p.goto(BASE + "/r/french-house/menu", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(6500);
  await p.locator('button[aria-label^="Add"], .fc-plus').first().click(); await p.waitForTimeout(2500);
  await p.screenshot({ path: OUT + "/a35-gate-table.png" });
  await p.locator(".sg-input").first().fill("29"); await p.locator(".sg-btn.gold").first().click(); await p.waitForTimeout(4200);
  await p.screenshot({ path: OUT + "/a35-gate-notopen.png" });
  await ctx.close(); }
await b.close();
console.log("shots -> " + OUT);
