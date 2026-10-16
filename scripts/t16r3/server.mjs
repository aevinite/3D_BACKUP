// scripts/t16r3/server.mjs — the round-3 stand-in server and browser pages.
//
// One local http server per run, on a port the OS gives us. It serves:
//   /panels/<file>      the REAL shipped file (or a mutation copy — lib.mjs panelFile)
//   /p/<name>           a page built by a check: page(name, { scripts, body, pre })
//   /api/...            answered by the CURRENT scenario: setApi(fn) — fn(req) returns
//                       { status, body, headers, delayMs } | "hang" | "drop"; every request is logged.
// Nothing leaves the Mac; nothing reaches the app or its database.
import http from "node:http";
import { chromium, webkit, firefox } from "playwright";
import { panelFile } from "./lib.mjs";

const pages = new Map();
let api = () => ({ status: 200, body: { ok: true } });
export const log = [];
const hung = new Set();
export function setApi(fn) { api = fn; log.length = 0; }
export function page(name, { scripts = [], body = "", pre = "", head = "", after = "" } = {}) {
  pages.set(name, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>${pre}</script>${head}</head><body>${body}` +
    scripts.map((s) => `<script src="/panels/${s}"></script>`).join("") + (after ? `<script>${after}</script>` : "") + "</body></html>");
  return "/p/" + name;
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/panels/")) {
    try { const body = panelFile(u.pathname.slice("/panels/".length)); const ext = u.pathname.split(".").pop(); res.writeHead(200, { "content-type": ({ css: "text/css", html: "text/html", json: "application/json" }[ext] || "application/javascript") + "; charset=utf-8", "cache-control": "no-store" }); return res.end(body); }
    catch { res.writeHead(404); return res.end("not found"); }
  }
  if (u.pathname.startsWith("/p/")) { const h = pages.get(u.pathname.slice(3)); res.writeHead(h ? 200 : 404, { "content-type": "text/html; charset=utf-8" }); return res.end(h || "no such page"); }
  if (u.pathname === "/login" || u.pathname === "/start") { res.writeHead(200, { "content-type": "text/html" }); return res.end(`<!doctype html><title>${u.pathname}</title>${u.pathname}`); }
  if (u.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const rec = { method: req.method, path: u.pathname + u.search, headers: req.headers, body, at: Date.now() };
    log.push(rec);
    let a;
    try { a = await api(rec); } catch (e) { a = { status: 500, body: { error: "stand-in threw: " + e.message } }; }
    if (a === "hang") { hung.add(res); return; }
    if (a === "drop") { req.socket.destroy(); return; }
    a = a || { status: 200, body: { ok: true } };
    const send = () => { if (res.writableEnded) return; res.writeHead(a.status || 200, { "content-type": "application/json", ...(a.headers || {}) }); res.end(typeof a.body === "string" ? a.body : JSON.stringify(a.body ?? {})); };
    if (a.delayMs) setTimeout(send, a.delayMs); else send();
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
export const BASE = "http://127.0.0.1:" + server.address().port;

const ENGINES = { chromium, webkit, firefox };
const browsers = {};
/** open(path, { engine, viewport, touch, dark, clock, init }) → { page, ctx, errors, close } */
export async function open(path, o = {}) {
  const eng = o.engine || "chromium";
  browsers[eng] = browsers[eng] || await ENGINES[eng].launch();
  const ctx = await browsers[eng].newContext({ viewport: o.viewport || { width: 1280, height: 860 }, deviceScaleFactor: o.dpr || 1,
    hasTouch: !!o.touch, isMobile: !!o.touch && eng !== "firefox", colorScheme: o.dark ? "dark" : "light" });
  if (o.init) await ctx.addInitScript(o.init);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  if (o.clock) await p.clock.install();
  await p.goto(BASE + path, { waitUntil: "load" });
  return { page: p, ctx, errors, close: () => ctx.close().catch(() => {}) };
}
export async function shutdown() { for (const r of hung) { try { r.destroy(); } catch {} } for (const b of Object.values(browsers)) await b.close().catch(() => {}); server.close(); }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, ms = 6000, step = 50) { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch {} await sleep(step); } return false; }
