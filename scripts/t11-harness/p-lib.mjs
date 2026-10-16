// scripts/t11-harness/p-lib.mjs — sweep #10 T11 ROUND 2's kit for the KITCHEN SCREEN ITSELF (public/panels/kitchen).
//
// The real panel — index.html, app.js, style.css and every shared /panels/*.js it loads, byte for byte from this
// checkout — served by a tiny file server started here, opened in Chromium, with EVERY server call answered by the
// test (page.route). So nothing reaches a database, no dev server is needed, no sign-in is spent, and any answer
// a real server can give — busy, refused, blocked, a 409, a slow reply, a 500-ticket board — can be played on cue.
//
// Two things are only observed, never changed:
//   · realtime.js's LFH_RT.start is wrapped on the way in, so a check can fire the panel's own breadcrumb handlers;
//   · each hidden print frame's print() is replaced the moment the frame is attached, so a check can see what
//     paper would have come out (or make the printer refuse), instead of a dialog nobody can read.
//
// Chromium's own JS coverage is collected from every page this kit opens and merged, so "every bit was checked"
// is a measured statement about app.js, not a feeling.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUB = join(ROOT, "public");
export const APP = "public/panels/kitchen/app.js";
export const HTML = "public/panels/kitchen/index.html";
export const CSS = "public/panels/kitchen/style.css";
export const SRC = readFileSync(join(ROOT, APP), "utf8");

// ── the file server ─────────────────────────────────────────────────────────────────────────────
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/json" };
const srv = createServer(async (q, s) => {
  const u = new URL(q.url, "http://k");
  const p = normalize(join(PUB, decodeURIComponent(u.pathname)));
  if (!p.startsWith(PUB)) { s.writeHead(403); return s.end(); }
  try { const b = await readFile(p); s.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream", "cache-control": "no-store" }); s.end(b); }
  catch { s.writeHead(404); s.end(); }
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
export const ORIGIN = `http://localhost:${srv.address().port}`;

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────
export const RID = "00000000-0000-4000-8000-0000000000a1";
export const AGO = (ms) => new Date(Date.now() - ms).toISOString();
export const order = (id, o = {}) => ({ id, status: "preparing", kot_no: 101, table_number: 4, created_at: AGO(5 * 60000), items: [], allergies: [], ...o });
export const item = (id, order_id, o = {}) => ({ id, order_id, title: "Dal Makhani", qty: 1, status: "preparing", created_at: AGO(5 * 60000), ...o });
export const dish = (id, title, o = {}) => ({ id, title, category: "Mains", tags: [], ...o });
export const plat = (id, o = {}) => ({ id, source: "zomato", status: "new", kot_no: 900, customer_name: "Ramesh", created_at: AGO(60000), items: [{ title: "Biryani", qty: 2 }], ...o });
export function board(o = {}) {
  return { orders: [], items: [], dishes: [dish("d1", "Paneer Tikka"), dish("d2", "Dal Makhani", { tags: ["sold-out"] })], platform: [], platformAccept: false,
    tableNames: {}, tableTags: {}, autoPrintKot: false, kotPrintTarget: "kitchen", station: null, helper: null, printRefused: null,
    waiting: { n: 0, oldestMs: null }, stuckAfterMs: 60000, restaurant: { id: RID, name: { en: "French House" }, logo_text: "" }, printJobs: [], queuedFor: [], ...o };
}

// ── rows ───────────────────────────────────────────────────────────────────────────────────────
const rows = []; const seen = new Set();
const HOW = "PANEL — the real kitchen screen in Chromium, every server answer played by the test (scripts/t11-harness/p-lib.mjs)";
export function k(id, check, ok, note = "", file = APP, how = HOW) {
  if (seen.has(id)) throw new Error("duplicate id " + id); seen.add(id);
  const n = +id.slice(1); if (n < 180841 || n > 181000) throw new Error(id + " is outside the panel block");
  const pass = ok === true; rows.push({ id, file, check, how, mark: pass ? "✅" : "❌", note: String(note ?? "").slice(0, 220) });
  console.log(`${pass ? "✅" : "❌"} ${id}  ${check}${!pass && note ? "  — " + String(note).slice(0, 200) : ""}`);
}
export const rowsSoFar = () => rows;

// ── the panel ──────────────────────────────────────────────────────────────────────────────────
let browser = null;
const COV = [];
export async function launch() { if (!browser) browser = await chromium.launch(); return browser; }

/**
 * Open the kitchen screen. `S` is the scripted server: change it between steps and call the panel's own load().
 *   S.board            the whole-board answer (GET /board)
 *   S.boardAnswer()    optional — return { status, body, headers } to answer the board read some other way
 *   S.slice(t)         the ?table= answer (default: that table's rows out of S.board)
 *   S.answer(call)     every other write — return { status, body }
 *   S.claim(ids)       optional — given the ids not yet won by anyone, return the ids this screen wins (or an answer)
 *   S.printSend(body)  POST /print/send — return { status, body } (default: { noRoute: true })
 *   S.whoami           GET /whoami
 */
export async function open(o = {}) {
  const b = await launch();
  const ctx = await b.newContext({ serviceWorkers: "block", viewport: o.viewport || { width: 1280, height: 860 }, ...(o.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}), ...(o.ctx || {}) });
  const S = {
    board: board(), whoami: {}, calls: [], errlog: [], unknown: [], actAs: [],
    // The claim is ATOMIC on the real server: a job is won once, by one screen, and never handed out again.
    answer: () => ({ status: 200, body: { ok: true } }), won: new Set(), claim: null, printSend: () => ({ status: 200, body: { noRoute: true } }),
    ...o.S,
  };
  await ctx.route("**/api/**", async (route) => {
    const r = route.request(), u = new URL(r.url()), path = u.pathname, method = r.method();
    let body = null; try { body = r.postDataJSON(); } catch { body = r.postData(); }
    const call = { method, path, query: Object.fromEntries(u.searchParams), body, headers: r.headers(), at: Date.now() };
    const send = async (a) => { if (a.delay) await new Promise((res) => setTimeout(res, a.delay)); if (a.abort) return route.abort("internetdisconnected"); return route.fulfill({ status: a.status ?? 200, headers: { "content-type": "application/json", ...(a.headers || {}) }, body: JSON.stringify(a.body ?? {}) }); };
    if (path === "/api/log/client-error") { S.errlog.push(body); return send({ body: { ok: true } }); }
    if (path === "/api/rt-config") return send({ status: 503, body: { error: "no realtime in this test" } });
    if (path === "/api/panel-profile" || path === "/api/maintenance") return send({ body: {} });
    if (path === "/api/admin/act-as") { S.actAs.push(body); return send({ body: { ok: true } }); }
    if (!path.startsWith("/api/kitchen/")) { S.unknown.push(path); return send({ status: 404, body: { error: "not in this test" } }); }
    const sub = path.slice("/api/kitchen".length);
    call.sub = sub;
    S.calls.push(call);
    if (method === "GET" && sub === "/board" && call.query.table != null) {
      const t = call.query.table;
      if (S.slice) return send(S.slice(t, call));
      const os = S.board.orders.filter((x) => String(x.table_number) === String(t));
      const ids = new Set(os.map((x) => x.id));
      return send({ body: { orders: os, items: S.board.items.filter((x) => ids.has(x.order_id)), tableTags: S.board.tableTags, printJobs: call.query.jobs ? S.board.printJobs : [] } });
    }
    if (method === "GET" && sub === "/board") return send(S.boardAnswer ? S.boardAnswer(call) : { body: S.board });
    if (method === "GET" && sub === "/whoami") return send({ body: S.whoami });
    if (method === "POST" && sub === "/print/send") return send(S.printSend(body, call));
    if (method === "POST" && sub === "/print-jobs/claim") {
      const asked = (body.ids || []).filter((id) => !S.won.has(id));
      const w = S.claim ? S.claim(asked, call) : asked;
      if (!Array.isArray(w)) return send(w);
      w.forEach((id) => S.won.add(id));
      return send({ body: { won: w } });
    }
    return send(S.answer(call));
  });
  // o.block: shared panel files to answer 404, to play "that script failed to load".
  for (const path of o.block || []) await ctx.route("**" + path + "*", (r) => r.fulfill({ status: 404, body: "" }));
  await ctx.addInitScript(({ theme, storage }) => {
    try { if (theme) localStorage.setItem("lfh_theme", theme); for (const [k1, v] of Object.entries(storage || {})) localStorage.setItem(k1, v); } catch {}
    window.__prints = []; window.__printMode = "ok";
    // A print frame is attached synchronously and printed 250ms later — replacing its print() the moment it is
    // attached records what paper would have come out, or makes the printer refuse on cue.
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.tagName === "IFRAME") {
      const w = n.contentWindow; if (!w) continue;
      w.print = () => { if (window.__printMode === "throw") throw new Error("no printer attached"); window.__prints.push(w.document.body ? w.document.body.innerText : ""); };
      w.focus = () => {};
    } }).observe(document, { childList: true, subtree: true });
    let rt = null;
    Object.defineProperty(window, "LFH_RT", { configurable: true, get: () => rt, set: (v) => { if (v && v.start) { const s0 = v.start; v.start = (opts) => { window.__rt = opts; return s0.call(v, opts); }; } rt = v; } });
  }, { theme: o.theme || null, storage: o.storage || {} });
  const page = await ctx.newPage();
  const logs = [];
  page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") logs.push("console: " + m.text()); });
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  const q = o.query ? "?" + new URLSearchParams(o.query) : "";
  await page.goto(`${ORIGIN}/panels/kitchen/index.html${q}`, { waitUntil: "load" });
  if (o.wait !== false) await page.waitForFunction(() => typeof state !== "undefined" && !!state.knownIds, null, { timeout: 15000 }).catch(() => {});
  const P = {
    page, ctx, S, logs,
    ev: (fn, arg) => page.evaluate(fn, arg),
    /** Replace the server's board, ask the panel to read it (its own load()), and wait for it to land. */
    async setBoard(b) { S.board = b; await page.evaluate(() => load().catch(() => {})); await page.waitForTimeout(60); },
    writes: (re) => S.calls.filter((c) => c.method !== "GET" && (!re || re.test(c.sub))),
    reads: (re) => S.calls.filter((c) => c.method === "GET" && (!re || re.test(c.sub))),
    toasts: () => page.evaluate(() => [...document.querySelectorAll("#toasts .toast, .lfh-undo, .undo-bar")].map((t) => t.textContent.replace(/\s+/g, " ").trim())),
    async close() {
      try { const c = await page.coverage.stopJSCoverage(); for (const e of c) if (e.url.includes("/panels/kitchen/app.js")) COV.push(e); } catch {}
      await ctx.close();
    },
  };
  return P;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── coverage, merged over every page this run opened ─────────────────────────────────────────────
export function coverage() {
  const n = SRC.length, hit = new Uint8Array(n), seenAny = new Uint8Array(n);
  for (const e of COV) {
    if (e.source && e.source !== SRC) continue;   // a different build of the file — never mix two
    const cnt = new Int32Array(n).fill(-1);
    for (const f of e.functions) for (const r of f.ranges) for (let i = r.startOffset; i < Math.min(r.endOffset, n); i++) cnt[i] = r.count;
    for (let i = 0; i < n; i++) { if (cnt[i] >= 0) seenAny[i] = 1; if (cnt[i] > 0) hit[i] = 1; }
  }
  // Lines: a line of CODE (not blank, not a pure comment) none of whose code characters ever ran.
  const lines = SRC.split("\n"); let off = 0; const never = []; let code = 0;
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li], t = L.trim();
    const isCode = t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("<!--");
    if (isCode) {
      code++;
      let anyHit = false; for (let i = off; i < off + L.length; i++) if (!/\s/.test(SRC[i]) && hit[i]) { anyHit = true; break; }
      if (!anyHit) never.push(li + 1);
    }
    off += L.length + 1;
  }
  // Functions by name: a named function whose body never ran on any page.
  const fnNever = new Map();
  for (const e of COV) for (const f of e.functions) if (f.functionName) {
    const ran = f.ranges[0].count > 0; const line = SRC.slice(0, f.ranges[0].startOffset).split("\n").length;
    const key = f.functionName + "@" + line; fnNever.set(key, (fnNever.get(key) || false) || ran);
  }
  const fnsNever = [...fnNever].filter(([, ran]) => !ran).map(([k1]) => k1);
  return { pages: COV.length, codeLines: code, linesNever: never, pct: Math.round(1000 * (code - never.length) / code) / 10, fnsNever, fnsTotal: fnNever.size };
}

export async function finish(name) {
  if (browser) await browser.close();
  srv.close();
  const bad = rows.filter((r) => r.mark === "❌");
  if (process.env.T11_SAVE) writeFileSync(process.env.T11_SAVE + "/" + name + ".json", JSON.stringify(rows, null, 1));
  console.log(`\n${rows.length} rows · ${rows.length - bad.length} ✅ · ${bad.length} ❌`);
  process.exitCode = bad.length ? 1 : 0;
}
