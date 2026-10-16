// Block L — ROUND 2 (2026-10-15), LIVE on this terminal's own production build (:4404, never 4000)
// (P173961…). What the round-2 fixes look like from a real phone. Every database function that could
// write is answered in the browser; the reads go to the dev database as a diner's would. No row is written.
import { chromium } from "playwright";
import { check, band, FILES, REAL_FETCH } from "./lib.mjs";
const BASE = process.env.T4_BASE || "http://localhost:4404";
const HOW = `LIVE — the built app on ${BASE.replace("http://", "")}, headless Chromium; write-type calls answered in the browser, no row written`;
band(173961);
const FH_ID = "00000000-0000-0000-0000-000000000001";
const PHONE = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" };
let browser = null; const B = async () => (browser ||= await chromium.launch());
const memo = new Map(); const once = (k, f) => { if (!memo.has(k)) memo.set(k, f()); return memo.get(k); };
const up = () => once("up", async () => { try { const r = await REAL_FETCH(BASE + "/"); return r.status < 500; } catch { return false; } });
// write-type functions: never let them reach the database from a check
const WRITES = /^lfh_(join|leave|request|approve|remove|set_|merge|call|touch|send|verify|rename|submit|place|record|log)/;
/** Load a page and record every database function it asks, with the restaurant it names. */
const visit = (path) => once("visit " + path, async () => {
  const ctx = await (await B()).newContext(PHONE); const calls = [];
  await ctx.route("**/rest/v1/rpc/**", async (route) => {
    const fn = route.request().url().split("/rpc/")[1].split("?")[0]; let a = {}; try { a = route.request().postDataJSON() || {}; } catch { /* GET */ }
    calls.push({ fn, rid: a.p_restaurant_id ?? a.p_rid ?? null, slug: a.p_slug ?? null });
    if (WRITES.test(fn)) return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    return route.continue();
  });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(String(e.message || e)));
  const res = await page.goto(BASE + path, { waitUntil: "networkidle" }); await page.waitForTimeout(2500);
  const text = await page.evaluate(() => document.body.innerText.slice(0, 160).replace(/\s+/g, " "));
  await ctx.close(); return { status: res.status(), calls, errors, text };
});
const skipDown = async () => ((await up()) ? null : `skip: the built app is not answering on ${BASE}`);
const asksFor1 = (calls) => calls.filter((c) => c.rid === FH_ID);

const CTX = FILES.ctx;
for (const path of ["/r/nobody-owns-this-slug-t4r2/menu", "/r/nobody-owns-this-slug-t4r2/item/anything"]) {
  check(CTX, `${path}: the not-found page asks the database NOTHING on French House's behalf (no settings, ban list or greeting for #1)`, HOW, async () => {
    const s = await skipDown(); if (s) return s; const v = await visit(path); const bad = asksFor1(v.calls);
    return { ok: v.status === 404 && bad.length === 0, note: `${v.status} · asked: ${v.calls.map((c) => `${c.fn}${c.rid ? "(" + c.rid.slice(-4) + ")" : ""}`).join(", ") || "nothing"}` };
  });
  check(CTX, `${path}: …and it still says plainly that this menu is not available, with no page error`, HOW, async () => {
    const s = await skipDown(); if (s) return s; const v = await visit(path);
    return { ok: v.status === 404 && v.errors.length === 0 && v.text.length > 0, note: v.text.slice(0, 90) };
  });
}
check(CTX, "a REAL restaurant's menu (French House) still asks for its own settings and ban list — the fix moved nothing for a real page", HOW, async () => {
  const s = await skipDown(); if (s) return s; const v = await visit("/r/french-house/menu"); const fns = new Set(asksFor1(v.calls).map((c) => c.fn));
  return { ok: v.status === 200 && fns.has("lfh_guest_settings") && fns.has("lfh_check_ban"), note: [...fns].join(", ") };
});
check(CTX, "…and another real restaurant's menu asks for ITS OWN id, never French House's", HOW, async () => {
  const s = await skipDown(); if (s) return s; const v = await visit("/r/aangan-garden-restaurant/menu");
  const named = v.calls.filter((c) => c.rid); const own = named.filter((c) => c.rid !== FH_ID);
  return { ok: v.status === 200 && named.length > 0 && own.length === named.length, note: `${named.length} named a restaurant · ${named.length - own.length} named #1` };
});

export async function closeL() { if (browser) { await browser.close(); browser = null; } }
