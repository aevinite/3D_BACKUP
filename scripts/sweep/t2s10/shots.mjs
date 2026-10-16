// scripts/sweep/t2s10/shots.mjs — the screenshots sweep #10 T2 READ (by eye) for its visual checks.
// Written to .claude/sweep/shots/S10-T2/ and deleted once looked at, as S10-RULES asks.
import { chromium } from "playwright";
import { join } from "node:path";
import { ROOT, BASE } from "./lib.mjs";
const OUTD = join(ROOT, ".claude/sweep/shots/S10-T2");
const b = await chromium.launch();
const phone = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true };
const tablet = { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true };
const desk = { viewport: { width: 1280, height: 800 } };
const cards = (p) => p.waitForFunction(() => { const c = [...document.querySelectorAll(".hs-card-wrap")]; return c.length === 3 && c.every((x) => x.style.opacity === "1"); }, null, { timeout: 30000 }).catch(() => {});
async function shot(name, dev, skin, url, after) {
  const ctx = await b.newContext(dev); await ctx.addInitScript((s) => localStorage.setItem("lfh_theme", s), skin);
  const p = await ctx.newPage(); await p.goto(BASE + url, { waitUntil: "load" });
  if (after) await after(p); else await p.waitForTimeout(2500);
  await p.screenshot({ path: join(OUTD, name + ".png") }); await ctx.close();
}
await shot("01-3d-phone-dark-fh", phone, "dark", "/view/Croissant?from=avocado-and-cream-cheese", async (p) => { await cards(p); await p.waitForTimeout(800); });
await shot("02-3d-phone-light-aevidine-waffle", phone, "light", "/view/Waffle?from=lemon-blueberry-waffles&r=aevidine", async (p) => { await cards(p); await p.waitForTimeout(800); });
await shot("03-3d-tablet-dark-fh", tablet, "dark", "/view/Waffle?from=lemon-blueberry-waffles", async (p) => { await cards(p); await p.waitForTimeout(800); });
await shot("04-3d-phone-after-quicklook", phone, "dark", "/view/Croissant?from=avocado-and-cream-cheese", async (p) => { await cards(p); await p.evaluate(() => { const mv = document.querySelector("#mv"); Object.defineProperty(mv, "canActivateAR", { get: () => true, configurable: true }); mv.setAttribute("ar-status", "not-presenting"); mv.activateAR = async () => {}; }); await p.click(".ar-btn"); await p.waitForTimeout(1500); });
await shot("05-dish-phone-dark-fh", phone, "dark", "/r/french-house/item/avocado-and-cream-cheese");
await shot("06-dish-phone-light-aevidine-reviews", phone, "light", "/r/aevidine/item/avocado-and-cream-cheese", async (p) => { await p.waitForTimeout(2000); await p.evaluate(() => document.querySelector(".review-tabs")?.scrollIntoView({ block: "start" })); await p.click(".review-tab-btn >> nth=0"); await p.waitForTimeout(600); });
await shot("07-dish-desktop-light-fh", desk, "light", "/item/avocado-and-cream-cheese");
await shot("08-dish-phone-lightbox", phone, "dark", "/r/french-house/item/lemon-blueberry-waffles", async (p) => { await p.click(".detail-visual"); await p.waitForTimeout(800); });
await shot("09-3d-unknown-restaurant", phone, "dark", "/view/Croissant?r=zz-no-such-place");
await b.close(); console.log("9 shots in", OUTD);
