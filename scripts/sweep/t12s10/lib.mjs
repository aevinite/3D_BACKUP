// scripts/sweep/t12s10/lib.mjs — sweep #10 · terminal 12 · THE WAITER TABLET SCREEN.
//
// Territory (5 files): app/r/[restaurant]/tablet/page.tsx · app/tablet/layout.tsx ·
// app/tablet/page.tsx · public/panels/tablet/app.js · public/panels/tablet/index.html
//
// Shared plumbing for the blocks in this folder: a runner that records one ledger row per check, the
// file readers, and ONE signed-in headless browser for every live block (one login for the whole run
// — scripts/sweep/login.mjs caches it on disk too, so the staff-login limit is never approached).
//
// Sources a row can name in its `how` column:
//   PAGE  — the REAL app.js, running in the real panel on :4412, its own functions called in the page
//   LIVE  — the panel driven the way a waiter drives it (taps, typing, the back button)
//   NET   — the same, with ONE request answered by a stand-in (Playwright route) — never the server's data
//   SRC   — the file on disk, comments stripped where a comment could fake a match
//   DB    — one read-only, scoped, limited statement
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const BASE = (() => {
  const i = process.argv.indexOf("--base");
  return (i > 0 && process.argv[i + 1]) || process.env.T12_BASE || "http://localhost:4412";
})();
export const RID = "00000000-0000-0000-0000-000000000001";   // My Little French House — the one written to
export const AANGAN = "00000000-0000-0000-0000-000000000002"; // read-only control — never written to

export const F_APP = "public/panels/tablet/app.js";
export const F_HTML = "public/panels/tablet/index.html";
export const F_PAGE = "app/tablet/page.tsx";
export const F_LAYOUT = "app/tablet/layout.tsx";
export const F_RPAGE = "app/r/[restaurant]/tablet/page.tsx";

export const read = (rel) => { try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return ""; } };
export const exists = (rel) => existsSync(join(ROOT, rel));
// Strip // and /* */ comments without eating URLs or regex literals that happen to hold "//".
export function stripComments(s) {
  let out = "", i = 0, q = null;
  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (q) { out += c; if (c === "\\") { out += n || ""; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; i++; continue; }
    if (c === "/" && n === "*") { const e = s.indexOf("*/", i + 2); i = e < 0 ? s.length : e + 2; continue; }
    if (c === "/" && n === "/" && !/[:\\]$/.test(out.slice(-1))) { const e = s.indexOf("\n", i); i = e < 0 ? s.length : e; continue; }
    out += c; i++;
  }
  return out;
}
export const code = (rel) => stripComments(read(rel));
// The body of a top-level `function name(` or `const name = …` in app.js, up to the next top-level
// declaration. Good enough for "does THIS function still say X" — never used to decide money.
export function fnBody(src, name) {
  const re = new RegExp(`(^|\\n)(async\\s+)?function\\s+${name}\\s*\\(|(^|\\n)(const|let)\\s+${name}\\s*=`);
  const m = re.exec(src);
  if (!m) return "";
  const start = m.index;
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(async\s+function|function|const|let|\/\/ ──)\s/);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

// ── the runner ────────────────────────────────────────────────────────────────────────────────
export function makeRunner(block) {
  const rows = [];
  const seen = new Set();
  const only = (() => { const i = process.argv.indexOf("--only"); return i > 0 ? new Set(process.argv[i + 1].split(",")) : null; })();
  async function check(id, file, title, how, fn) {
    if (seen.has(id)) throw new Error(`id used twice in ${block}: ${id}`);
    seen.add(id);
    if (only && !only.has(id)) return;
    let mark = "✅", note = "";
    try {
      const r = await fn();
      if (r === true || r === undefined) { /* pass */ }
      else if (r && typeof r === "object" && "ok" in r) { mark = r.ok ? "✅" : "❌"; note = r.note || ""; if (r.skip) mark = "⏭"; }
      else if (typeof r === "string") { note = r; }
      else if (r === false) { mark = "❌"; }
    } catch (e) { mark = "❌"; note = "threw: " + String((e && e.message) || e).slice(0, 220); }
    rows.push({ id, file, title, how, mark, note: String(note).replace(/\|/g, "¦").replace(/\n/g, " ").slice(0, 300) });
    if (!process.argv.includes("--quiet") || mark !== "✅") console.log(`${mark} ${id} ${title}${note ? " — " + note : ""}`);
  }
  const skip = (id, file, title, how, why) => check(id, file, title, how, () => ({ ok: true, skip: true, note: why }));
  function done() {
    const c = { "✅": 0, "❌": 0, "⏭": 0 };
    for (const r of rows) c[r.mark]++;
    console.log(`\n${block}: ${rows.length} checks · ✅ ${c["✅"]} · ❌ ${c["❌"]} · ⏭ ${c["⏭"]}`);
    return { rows, counts: c };
  }
  return { check, skip, done, rows };
}
export const ok = (cond, note) => ({ ok: !!cond, note: note == null ? "" : String(note) });
export function ledgerLine(r) {
  return `| ${r.id} | \`${r.file}\` — ${r.title} | ${r.how} | ${r.mark} | ${r.note} |`;
}

// ── read-only database (service role, scoped, limited) ─────────────────────────────────────────
const env = (() => {
  try {
    const t = read(".env.local");
    const g = (k) => (t.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
    return { url: g("NEXT_PUBLIC_SUPABASE_URL"), key: g("SUPABASE_SERVICE_ROLE_KEY") };
  } catch { return {}; }
})();
export async function db(path, method = "GET", body, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await dbOnce(path, method, body); }
    catch (e) {
      // A read that timed out on the small shared dev box is retried (twice, with a pause). A write
      // is retried only for a timeout, which the database answers BEFORE applying anything.
      if (i >= tries || !/-> (500|502|503|504) |statement timeout|fetch failed/.test(String(e.message))) throw e;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}
async function dbOnce(path, method = "GET", body) {
  const r = await fetch(`${env.url}/rest/v1/${path}`, {
    method,
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${method} ${path.split("?")[0]} -> ${r.status} ${txt.slice(0, 160)}`);
  return txt ? JSON.parse(txt) : null;
}

// ── ONE browser, ONE login, for every live block ───────────────────────────────────────────────
let _browser = null;
export async function browser() {
  if (_browser) return _browser;
  const { chromium } = await import("playwright");
  _browser = await chromium.launch();
  if (process.env.T12_COV || process.env.T12_MUT) await instrument(_browser);
  return _browser;
}
export async function closeBrowser() {
  if (!_browser) return;
  if (process.env.T12_COV) { const { covFlush } = await import("../t12r3/cov.mjs"); await covFlush(); }
  await _browser.close().catch(() => {}); _browser = null;
}
// ── ROUND 3: coverage and mutation hooks (sweep #10 T12, 2026-10-16) ─────────────────────────────
// T12_COV=<dir>  every page records which characters of the tablet's code ran (../t12r3/cov.mjs), and
//                writes that record before it navigates, closes, or its context or browser closes.
// T12_MUT=<file> every context is served THAT file in place of /panels/tablet/app.js, with the service
//                worker blocked (it would otherwise answer the panel's files from its own cache and the
//                broken copy would never load). ../t12r3/mutate.mjs uses it; the real file is never edited.
async function instrument(b) {
  const COV = process.env.T12_COV ? await import("../t12r3/cov.mjs") : null;
  const MUT = process.env.T12_MUT ? readFileSync(process.env.T12_MUT, "utf8") : null;
  const orig = b.newContext.bind(b);
  b.newContext = async (opts = {}) => {
    const ctx = await orig(MUT ? { ...opts, serviceWorkers: "block" } : opts);
    if (MUT) await ctx.route(/\/panels\/tablet\/app\.js(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "application/javascript; charset=utf-8", body: MUT }));
    if (COV) {
      const np = ctx.newPage.bind(ctx);
      ctx.newPage = async () => { const p = await np(); await COV.covStart(p); return p; };
      ctx.on("page", (p) => { COV.covStart(p); });
      const close = ctx.close.bind(ctx);
      ctx.close = async (...a) => { await COV.covFlushContext(ctx); return close(...a); };
    }
    return ctx;
  };
}

/** A signed-in waiter context. `device` = { width, height, touch, dpr, mobile, dark }. */
export async function waiterContext(device = {}) {
  const { loginAs } = await import("../login.mjs");
  const b = await browser();
  const ctx = await b.newContext({
    viewport: { width: device.width || 1194, height: device.height || 834 },
    hasTouch: device.touch !== false,
    isMobile: !!device.mobile,
    deviceScaleFactor: device.dpr || 1,
    colorScheme: device.dark ? "dark" : "light",
    ...(device.noServiceWorker ? { serviceWorkers: "block" } : {}),
  });
  await loginAs(ctx, "tablet", BASE);
  return ctx;
}
/** Open the panel document itself (the iframe's src) — the same document /tablet frames. */
export async function openPanel(ctx, { path = "/panels/tablet/index.html", wait = true, theme } = {}) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (theme) await page.addInitScript((t) => { try { localStorage.setItem("lfh_panel_theme", t); } catch {} }, theme);
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  if (wait) {
    await page.waitForSelector("#tiles .tile[data-t], #tiles .sx-empty, #tiles .muted", { timeout: 30000 });
    await page.waitForFunction(() => typeof state !== "undefined" && state.settingsSettled === true && !!state.data.settings, null, { timeout: 30000 });
    await page.waitForTimeout(600);
  }
  return { page, errors };
}
/** Find the panel's frame inside /tablet or /r/<slug>/tablet. */
export async function panelFrame(page) {
  for (let i = 0; i < 80; i++) {
    const f = page.frames().find((fr) => fr.url().includes("/panels/tablet"));
    if (f) return f;
    await page.waitForTimeout(250);
  }
  throw new Error("the tablet panel frame never appeared");
}
export const visible = (pageOrFrame, sel) => pageOrFrame.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return false;
  const cs = getComputedStyle(e);
  if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}, sel).catch(() => false);
export const toasts = (page) => page.evaluate(() => [...document.querySelectorAll("#toasts .toast span")].map((s) => s.textContent));
export const clearToasts = (page) => page.evaluate(() => { const t = document.getElementById("toasts"); if (t) t.innerHTML = ""; });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Text a person can read on screen must never carry these.
export const LEAK = /undefined|NaN|\[object Object\]|\$\{|null(?![\w-])/;
