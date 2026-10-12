// scripts/sweep/t16s10/browser.mjs — one Playwright browser and a same-origin harness page for the
// browser suites. The page lives at <base>/__t16/h.html and is answered by the test itself, so its
// localStorage and IndexedDB are the real thing on the app's own origin (the P15015 rule: never
// setContent). The modules load from the dev server — i.e. from THIS worktree — unless `from:"site"`,
// in which case every /panels/*.js request is answered with the bytes the backup site serves.
// Every /api/* request is answered by the scenario's own handler, or refused with 599 so a check can
// never reach a real route by accident.
import { chromium } from "playwright";

export const BASE = process.env.T16_BASE || "http://localhost:4416";
export const SITE = process.env.T16_SITE || "https://3-d-backup.vercel.app";
let browser = null;
export async function getBrowser() { if (!browser) browser = await chromium.launch(); return browser; }
export async function closeBrowser() { if (browser) { await browser.close(); browser = null; } }
const siteBytes = new Map();
export async function siteFile(path) {
  if (!siteBytes.has(path)) {
    const r = await fetch(SITE + path, { signal: AbortSignal.timeout(20000) });
    siteBytes.set(path, { status: r.status, type: r.headers.get("content-type") || "", body: await r.text(), cache: r.headers.get("cache-control") || "" });
  }
  return siteBytes.get(path);
}
export const PACE = "window.LFH_TEST_PACING={first:200,base:300,max:600,wake:40,stuck:1500};";

/** harness({ scripts, pre, body, from, viewport, reducedMotion, api, offline }) */
export async function harness(o = {}) {
  const ctx = await (await getBrowser()).newContext({
    viewport: o.viewport || { width: 1280, height: 800 },
    deviceScaleFactor: o.dpr || 1, hasTouch: !!o.touch, isMobile: !!o.touch,
    reducedMotion: o.reducedMotion || "no-preference",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>${o.pre || ""}</script>${o.head || ""}</head><body>${o.body || ""}${(o.scripts || []).map((s) => { const [f, attrs] = s.split("|"); return `<script src="/panels/${f}"${attrs ? " " + attrs : ""}></script>`; }).join("")}${o.after ? `<script>${o.after}</script>` : ""}</body></html>`;
  await page.route("**/__t16/h.html", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
  if (o.pages) for (const [p, h] of Object.entries(o.pages)) await page.route(`**${p}`, (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: h }));
  if (o.from === "site") {
    await page.route(/\/panels\/[a-z0-9\-]+\.js(\?.*)?$/, async (r) => {
      const u = new URL(r.request().url()), f = await siteFile(u.pathname);
      return r.fulfill({ status: f.status, contentType: "application/javascript; charset=utf-8", body: f.body });
    });
  }
  const sent = [];
  await page.route("**/api/**", async (r) => {
    const req = r.request(), u = new URL(req.url());
    const rec = { method: req.method(), path: u.pathname + u.search, headers: req.headers(), body: req.postData() || "" };
    sent.push(rec);
    if (o.api) { const ans = await o.api(rec, r); if (ans === "handled") return; if (ans) return r.fulfill({ status: ans.status || 200, contentType: "application/json", headers: ans.headers || {}, body: typeof ans.body === "string" ? ans.body : JSON.stringify(ans.body || { ok: true }) }); }
    return r.fulfill({ status: 599, contentType: "application/json", body: '{"error":"t16 harness: no handler"}' });
  });
  await page.goto(BASE + (o.path || "/__t16/h.html"), { waitUntil: "load" });
  return { page, ctx, errors, sent, close: () => ctx.close().catch(() => {}) };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, ms = 6000, step = 60) { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch {} await sleep(step); } return false; }
/** memo(fn) — run a scenario once, share its measurements between the rows that read it. */
export function memo(fn) { let p = null; return () => (p = p || fn()); }
