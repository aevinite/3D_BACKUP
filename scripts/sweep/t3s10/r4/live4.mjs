// scripts/sweep/t3s10/r4/live4.mjs — round 4's browser: a phone or laptop page on the production test app
// (:4406), in any of the three engines (Chromium, WebKit = iPhone Safari, Firefox).
//
// THE OFFLINE RULE (learned 2026-10-15, see r3/livelib.mjs): a page that saved work while offline is CLOSED
// while still offline — never switched back online — or its queue sends real orders.
import { chromium, webkit, firefox } from "playwright";
export const BASE = process.env.T4_BASE || "http://localhost:4406";
export const FH_PATH = "/r/french-house/menu";
const ENGINES = { chromium, webkit, firefox }; const open_ = {};
export async function browser(engine = "chromium") { return (open_[engine] ||= await ENGINES[engine].launch()); }
export async function closeBrowser() { for (const k of Object.keys(open_)) { await open_[k].close().catch(() => {}); delete open_[k]; } }
export async function page({ engine = "chromium", w = 390, h = 844, touch = true, skin = "dark", lang = null, init = null, initArg = null, offlineOK = false } = {}) {
  const b = await browser(engine);
  const opts = { viewport: { width: w, height: h }, deviceScaleFactor: 2, serviceWorkers: "block" };
  if (engine !== "firefox") { opts.isMobile = touch && w < 700; opts.hasTouch = touch; } else opts.hasTouch = touch;
  const ctx = await b.newContext(opts); const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  await p.addInitScript(({ s, l }) => { try { localStorage.setItem("lfh_theme", s); if (l) localStorage.setItem("lfh_language", l); } catch { /* storage blocked: the check wanted that */ } }, { s: skin, l: lang });
  if (init) await p.addInitScript(init, initArg);
  void offlineOK;
  return { ctx, p, errs };
}
export async function open(p, path = FH_PATH) {
  for (let k = 0; k < 3; k++) { try { await p.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 90000 }); break; } catch { await p.waitForTimeout(1500); } }
  await p.locator('button[aria-label^="Add"], .review-tab-btn').first().waitFor({ timeout: 90000 }); await p.waitForTimeout(2000);
}
// add the n-th orderable dish on the menu (scrolled into the middle, tapped as a finger would), close the popup
export async function addDish(p, n = 0) {
  await p.evaluate((n) => { const all = [...document.querySelectorAll('button[aria-label^="Add"]')]; const x = all[n % all.length]; if (x) { x.scrollIntoView({ block: "center" }); x.click(); } }, n);
  await p.waitForTimeout(1000);
}
export const openBill = async (p) => { await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(1300); };
export const closeAll = async (p) => { await p.evaluate(() => window.dispatchEvent(new Event("lfh:close-all"))); await p.waitForTimeout(500); };
export const LEAK = /\bundefined\b|\bNaN\b|\[object |\$\{|\{\{/;
