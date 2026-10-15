// scripts/sweep/t4s10/lab/page.mjs — open the screen lab in Chromium and hold every answer it asks for.
//
// The page lives at https://t4lab.test/<path> (default /r/french-house/menu — the path is what the screens
// read to know their restaurant). Two kinds of request leave it, and both are answered HERE, never sent:
//   · https://lab-db.test/rest/v1/rpc/<fn>  → opts.rpc[fn](args, n) (default: ./fixtures.json + DEFAULTS)
//   · https://t4lab.test/api/<…>             → opts.api[path](body, n) (default { ok: true })
// Anything else is refused, so a screen that reaches for something new is seen, not silently served.
// The stylesheet is the app's own production CSS (every .css under .next/static — needs a build), so
// layout checks see real layout; without a build the lab refuses to start rather than test unstyled.
//
// Coverage (T4_LAB_COVER=<file>): V8 ranges for the lab bundle are appended to that file as JSON lines,
// saved before every navigation (Chromium only reports scripts still alive).
import { chromium } from "playwright";
import { readFileSync, readdirSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../lib.mjs";
import { buildLab } from "./build.mjs";

export const FX = JSON.parse(readFileSync(join(ROOT, "scripts/sweep/t4s10/lab/fixtures.json"), "utf8"));
export const FH_ID = FX.lfh_guest_restaurant.id;
export const PHONE = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const json = (v, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(v) });
export const pgErr = (code, message, status = 500) => ({ status, contentType: "application/json", body: JSON.stringify({ code, message, details: null, hint: null }) });
/** The settings French House really sends, with table sessions switched on (they are off on the dev DB). */
export const settingsOn = (extra = {}) => ({ ...FX.lfh_guest_settings, sessions_enabled: true, require_location: false, ...extra });
const DEFAULTS = {
  lfh_guest_restaurant: () => json(FX.lfh_guest_restaurant),
  lfh_guest_settings: () => json(settingsOn()),
  lfh_check_ban: () => json({ ok: true, banned: false }),
  lfh_greet_device: () => json({ ok: true }),
  lfh_touch_session: () => json({ ok: true }),
  lfh_get_cart: () => json({ ok: true, cart: [], cart_updated_at: null }),
};

let browser = null;
export async function B() { if (!browser) browser = await chromium.launch(); return browser; }
export async function closeBrowser() { if (browser) { const b = browser; browser = null; await b.close(); } }

function css() {
  const dir = join(ROOT, ".next/static"); // Next 16 writes the stylesheet among the chunks
  if (!existsSync(dir)) return "";
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".css") ? [join(d, e.name)] : []));
  return walk(dir).map((f) => readFileSync(f, "utf8")).join("\n");
}
let CSS = null;

/**
 * openLab({ path, mount, rpc, api, storage, session, init, viewport, online })
 *   storage: { key: value } put in localStorage before the page runs (e.g. a stored session)
 * Returns { page, ctx, log, api, errors, events(), toasts(), goto(path), close() }.
 */
export async function openLab(o = {}) {
  const lab = await buildLab();
  if (CSS === null) CSS = css();
  if (!CSS) throw new Error("t4lab: no built stylesheet under .next/static — run `npx next build` in this folder first");
  const ctx = await (await B()).newContext({ ...(o.viewport || PHONE), serviceWorkers: "block", ignoreHTTPSErrors: true,
    ...(o.geo ? { geolocation: o.geo, permissions: ["geolocation"] } : {}) });
  if (o.clock) await ctx.clock.install({ time: o.clock === true ? new Date("2026-10-15T12:00:00+05:30") : o.clock });
  const log = [], apiLog = [], counts = {};
  await ctx.route("https://lab-db.test/**", async (route) => {
    const u = new URL(route.request().url());
    const m = u.pathname.match(/\/rest\/v1\/rpc\/([^/?]+)/);
    let args = {}; try { args = route.request().postDataJSON() || {}; } catch { /* GET */ }
    if (!m) { log.push({ fn: "REST " + u.pathname, args }); return route.fulfill(json((o.rest && o.rest[u.pathname]) || [])); }
    const fn = m[1]; counts[fn] = (counts[fn] || 0) + 1; log.push({ fn, args, n: counts[fn], at: Date.now() });
    const h = (o.rpc && o.rpc[fn]) || DEFAULTS[fn];
    const v = typeof h === "function" ? await h(args, counts[fn]) : h;
    if (v === "abort") return route.abort("internetdisconnected");
    if (v === "hang") return; // never answered — the caller's own deadline must end it
    if (v === undefined) return route.fulfill(json({ ok: true }));
    return route.fulfill(v && v.status ? v : json(v));
  });
  // holdNav: once the page has loaded, a navigation the SCREEN starts (window.location.href = …) is recorded
  // and stopped, so the check can see where it was going AND the page keeps its coverage record
  // (Chromium drops a page's record when it navigates away).
  const navs = []; let loadedOnce = false;
  await ctx.route("https://t4lab.test/**", async (route) => {
    const u = new URL(route.request().url());
    if (o.holdNav && loadedOnce && route.request().isNavigationRequest()) { navs.push(u.pathname + u.search); return route.abort("aborted"); }
    if (u.pathname === "/__lab.js") return route.fulfill({ status: 200, contentType: "application/javascript", body: lab.text });
    if (u.pathname === "/__lab.css") return route.fulfill({ status: 200, contentType: "text/css", body: CSS });
    if (u.pathname.startsWith("/api/")) {
      let body = null; try { body = route.request().postDataJSON(); } catch { /* none */ }
      const key = u.pathname; counts[key] = (counts[key] || 0) + 1; apiLog.push({ path: key, body, method: route.request().method(), n: counts[key], actionId: route.request().headers()["x-lfh-action-id"] || null });
      const h = o.api && o.api[key];
      const v = typeof h === "function" ? await h(body, counts[key]) : h;
      if (v === "abort") return route.abort("internetdisconnected");
      return route.fulfill(v && v.status ? v : json(v ?? { ok: true }));
    }
    if (/\.(png|jpg|svg|ico|webp|woff2?)$/.test(u.pathname)) return route.fulfill({ status: 204, body: "" });
    return route.fulfill({ status: 200, contentType: "text/html", body:
      `<!doctype html><html lang="en" data-theme="${o.theme || "dark"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/__lab.css"></head><body><div id="root"></div><script src="/__lab.js"></script></body></html>` });
  });
  await ctx.route(/^(?!https:\/\/t4lab\.test|https:\/\/lab-db\.test)/, (route) => { log.push({ fn: "REFUSED " + route.request().url() }); return route.abort("blockedbyclient"); });
  await ctx.addInitScript(({ mount, storage, online }) => {
    window.__LAB = { mount };
    window.__ev = []; window.__toasts = [];
    // every repeating timer still running, so a check can see a screen stop its own when it goes away
    window.__ivLive = new Set();
    const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
    window.setInterval = (fn, ms, ...a) => { const id = si(fn, ms, ...a); window.__ivLive.add(id); return id; };
    window.clearInterval = (id) => { window.__ivLive.delete(id); return ci(id); };
    const orig = window.dispatchEvent.bind(window);
    window.dispatchEvent = (e) => { try { if (e && e.type && e.type.startsWith("lfh:")) window.__ev.push({ type: e.type, detail: e.detail === undefined ? null : JSON.parse(JSON.stringify(e.detail ?? null)), at: Date.now() }); if (e.type === "lfh:toast") window.__toasts.push(e.detail); } catch { /* unserialisable detail */ } return orig(e); };
    if (storage && !sessionStorage.getItem("__lab_seeded")) { for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); sessionStorage.setItem("__lab_seeded", "1"); }
    if (online === false) Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
  }, { mount: o.mount || null, storage: o.storage || null, online: o.online });
  if (o.init) await ctx.addInitScript(o.init.fn, o.init.arg);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  const COV = process.env.T4_LAB_COVER;
  const save = async () => {
    if (!COV) return;
    // the bundle's text is the same for every page of one run — write it ONCE (by its file name) and
    // record only the ranges per page; 300 copies of a 2.6 MB bundle outgrow what Node can hold
    try { const entries = await page.coverage.stopJSCoverage(); for (const e of entries) if (e.url.endsWith("/__lab.js")) appendFileSync(COV, JSON.stringify({ bundle: lab.file, functions: e.functions }) + "\n"); } catch { /* page gone */ }
  };
  const goto = async (path) => {
    await save();
    if (COV) await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: false });
    await page.goto("https://t4lab.test" + (path || o.path || "/r/french-house/menu"), { waitUntil: "load" });
    await page.waitForFunction(() => window.__labReady === true, null, { timeout: 10000 });
    loadedOnce = true;
  };
  await goto();
  return {
    page, ctx, log, apiLog, errors, goto, navs,
    events: (type) => page.evaluate((t) => window.__ev.filter((x) => !t || x.type === t), type),
    toasts: () => page.evaluate(() => window.__toasts),
    fire: (type, detail) => page.evaluate(([t, d]) => window.dispatchEvent(new CustomEvent(t, { detail: d })), [type, detail]),
    text: (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.innerText : null; }, sel),
    wait: (ms) => page.waitForTimeout(ms),
    clock: o.clock ? ctx.clock : null,
    intervals: () => page.evaluate(() => window.__ivLive.size),
    unmount: () => page.evaluate(() => window.__labUnmount()),
    ls: (k) => page.evaluate((key) => localStorage.getItem(key), k),
    lsJSON: (k) => page.evaluate((key) => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return "BAD"; } }, k),
    lib: (fn, ...args) => page.evaluate(([f, a]) => window.__labLib[f](...a), [fn, args]),
    close: async () => { await save(); await ctx.close(); },
  };
}
