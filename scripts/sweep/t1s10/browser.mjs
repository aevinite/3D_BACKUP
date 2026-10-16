// scripts/sweep/t1s10/browser.mjs — one headless Chromium for the whole T1 run, against MY build on T1_BASE.
//
// Why Playwright here and not the chrome-devtools window: these checks must re-run with no Claude session
// (the S10 rules' carve-out (5)), and a phone needs touch emulation or the phone layout never applies.
// Nothing here writes to the database: the guest menu only READS, and a check that needs a server answer
// changed holds it in the browser (route.fulfill) and says so in its row.
import { chromium } from "playwright";
import { BASE } from "./lib.mjs";

export const PHONE = { width: 360, height: 780, dpr: 3, mobile: true };   // Samsung A35
export const DESK = { width: 1280, height: 800, dpr: 1, mobile: false };
export const IPAD = { width: 1194, height: 834, dpr: 2, mobile: true };

// Every live restaurant on the dev stack, by id — so a check can skip the 2.3s intro splash by marking it
// "seen" exactly the way the splash does (sessionStorage `lfh_intro_seen:<restaurant id>`).
export const RIDS = {
  "french-house": "00000000-0000-0000-0000-000000000001", "pizza-palace": "00000000-0000-0000-0000-000000000002",
  "burger-barn": "00000000-0000-0000-0000-000000000003", "spice-route": "00000000-0000-0000-0000-000000000004",
  "sakura-sushi": "00000000-0000-0000-0000-000000000005", "taco-fiesta": "00000000-0000-0000-0000-000000000006",
  "green-bowl": "00000000-0000-0000-0000-000000000007", "aangan-garden-restaurant": "6c6fadb6-da23-4ab3-9f90-d164773f60b3",
  aevidine: "00000000-0000-0000-0000-0000000000a1", "saffron-street": "00000000-0000-0000-0000-0000000000a2",
  "copper-kettle": "00000000-0000-0000-0000-0000000000a3",
};
export const LIVE = Object.keys(RIDS);
export const QR = { "aangan-garden-restaurant": "9AAG8YK8", aevidine: "63JMK73F", "burger-barn": "75ET79SE", "french-house": "M2WSG4T4",
  "green-bowl": "YQCKS8DD", "pizza-palace": "RSRXQTKJ", "saffron-street": "KGC2KGTB", "sakura-sushi": "DU6QZXJF", "spice-route": "EFJQTM7T", "taco-fiesta": "DYUU2GPA" };

let browser = null;
export async function getBrowser() {
  if (!browser) browser = await chromium.launch({ headless: true });
  return browser;
}
export async function closeAll() { if (browser) { await browser.close().catch(() => {}); browser = null; } }

/**
 * A fresh, first-time diner: a new context (empty storage). `skipIntro` marks every restaurant's splash
 * as already seen (the splash's own key), `theme` pre-sets the guest's saved choice, `init` adds storage.
 */
export async function newPage({ vp = PHONE, theme = null, skipIntro = true, init = {}, reducedMotion = "no-preference", js = true, sw = false } = {}) {
  const b = await getBrowser();
  const ctx = await b.newContext({
    viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr, isMobile: vp.mobile, hasTouch: vp.mobile,
    reducedMotion, javaScriptEnabled: js, serviceWorkers: sw ? "allow" : "block",
  });
  await ctx.addInitScript(({ ids, skip, theme, init }) => {
    try {
      if (skip) for (const id of ids) sessionStorage.setItem("lfh_intro_seen:" + id, "1");
      if (theme) localStorage.setItem("lfh_theme", theme);
      for (const [k, v] of Object.entries(init.local || {})) localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(init.session || {})) sessionStorage.setItem(k, v);
    } catch { /* storage refused */ }
  }, { ids: Object.values(RIDS), skip: skipIntro, theme, init });
  const page = await ctx.newPage();
  const errors = [], bad = [], requests = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 200)));
  page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(0, 160)}`); });
  page.on("request", (r) => requests.push({ url: r.url(), method: r.method(), type: r.resourceType() }));
  page.t1 = { errors, bad, requests, ctx };
  return page;
}
export async function done(page) { try { await page.t1.ctx.close(); } catch { /* already gone */ } }

/** Go, wait for the page's own load and then for the dish cards (or a dead-end screen) to be drawn. */
export async function open(page, path, { waitFor = ".item-card, .gnf, .nf, .maint, .menu-empty-state, .fav-empty", settle = 400 } = {}) {
  const res = await page.goto(BASE + path, { waitUntil: "load", timeout: 45000 });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 25000 }).catch(() => {});
  if (settle) await page.waitForTimeout(settle);
  return res;
}
/** One-shot: open a path as a fresh diner, run fn(page), close. */
export async function withPage(path, fn, opts = {}) {
  const page = await newPage(opts);
  try { const res = path ? await open(page, path, opts) : null; return await fn(page, res); }
  finally { await done(page); }
}
export const cards = (page) => page.$$eval(".item-card:not(.skeleton-card)", (els) => els.length);
export const bodyText = (page) => page.evaluate(() => document.body.innerText);
export const LEAK = /\$\{|\[object Object\]|\bundefined\b|\bNaN\b|-->/;
