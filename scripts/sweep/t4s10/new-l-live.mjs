// Block L — ROUND 2 (2026-10-15), LIVE on this terminal's own production build (:4404, never 4000)
// (P173961…). What the round-2 fixes look like from a real phone. Every database function that could
// write is answered in the browser; the reads go to the dev database as a diner's would. No row is written.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { check, band, FILES, REAL_FETCH, ROOT } from "./lib.mjs";
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

// ── 2026-10-16, the owner's "do the qr one": a QR code nobody owns (P173967…) ──────────────────────────
// The real FH table-7 code is READ from the dev database (one row, service read, nothing written) so the
// second check can walk a diner from a dead sticker to a live one in the SAME tab.
const envLocal = () => Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const fhCode = () => once("fh code", async () => {
  const e = envLocal(); const k = e.SUPABASE_SERVICE_ROLE_KEY;
  const r = await REAL_FETCH(`${e.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/table_qr_codes?select=code&restaurant_id=eq.${FH_ID}&table_number=eq.7&limit=1`, { headers: { apikey: k, Authorization: `Bearer ${k}` } });
  return ((await r.json()) || [])[0]?.code || null;
});
const DEADQ = "/q/ZZZZZZZZ";
check(FILES.ts, "a QR code that matches nothing shows 'not active' and asks the database about NO restaurant — not French House", HOW, async () => {
  const sk = await skipDown(); if (sk) return { skip: sk };
  const v = await visit(DEADQ); const named = v.calls.filter((c) => c.rid || c.slug);
  return { ok: v.status === 200 && /isn.t active/i.test(v.text) && named.length === 0 && v.errors.length === 0, note: `${v.calls.map((c) => c.fn).join(",") || "nothing asked"} · ${v.text.slice(0, 60)}` };
});
check(FILES.ts, "…and the next live sticker in the same tab clears that mark and is French House's own menu again", HOW, async () => {
  const sk = await skipDown(); if (sk) return { skip: sk };
  const code = await fhCode(); if (!code) return { skip: "skip: French House has no table-7 QR code on the dev database" };
  const ctx = await (await B()).newContext(PHONE); const calls = [];
  await ctx.route("**/rest/v1/rpc/**", async (route) => {
    const fn = route.request().url().split("/rpc/")[1].split("?")[0]; let a = {}; try { a = route.request().postDataJSON() || {}; } catch { /* GET */ }
    calls.push({ fn, rid: a.p_restaurant_id ?? a.p_rid ?? null });
    if (WRITES.test(fn)) return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    return route.continue();
  });
  try {
    const page = await ctx.newPage();
    await page.goto(BASE + DEADQ, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
    const markDead = await page.evaluate(() => sessionStorage.getItem("lfh_tab_no_tenant")); const deadAsked = calls.length;
    await page.goto(BASE + "/q/" + code, { waitUntil: "networkidle" }); await page.waitForTimeout(2500);
    const markLive = await page.evaluate(() => sessionStorage.getItem("lfh_tab_no_tenant"));
    const fh = calls.slice(deadAsked).filter((c) => c.rid === FH_ID).length;
    return { ok: markDead === DEADQ && deadAsked === 0 && markLive === null && fh > 0, note: `mark ${markDead} → ${markLive} · dead page asked ${deadAsked} · live page named FH ${fh}×` };
  } finally { await ctx.close(); }
});

export async function closeL() { if (browser) { await browser.close(); browser = null; } }
