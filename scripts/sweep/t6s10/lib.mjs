// scripts/sweep/t6s10/lib.mjs — the shared harness for sweep #10, terminal 6.
//
// Territory: public/panels/editor/app.js from line 1 to the END of openZReport() — the function
// that straddles the 6,707 line the planning cut drew (the range holding a function's FIRST line
// owns all of it). Taken by LANDMARK, never by line number, so a comment added above does not
// silently move the boundary onto terminal 7's code: MINE ends where `async function printZReport(`
// begins.
//
// FOUR sources, and every row says which one it used:
//   · SRC   — the file as it is on disk (STRIPPED where the rule is about code, so a name inside a
//             comment or a string is not counted as a caller)
//   · LIVE  — this terminal's own dev server (port 4406, never 4000), signed in ONCE as French
//             House's manager through scripts/sweep/login.mjs, which caches across processes.
//             The panel's own functions are CALLED inside its real frame.
//   · GUARD — one of the repo's verify:* scripts, run as a child process
//   · DB    — one read-only statement against the dev database, scoped and limited
//
// Never: a signed-out call to a running app, a swapped id, a write to Aangan.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const rd = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");
export const APP_REL = "public/panels/editor/app.js";
export const APP = rd(APP_REL);
const must = (i, what) => { if (i < 0) throw new Error(`t6s10: landmark not found — ${what}. Re-derive it; never let a check read an empty slice.`); return i; };
export const MY_END_AT = must(APP.indexOf("async function printZReport("), "printZReport (the first function after my half)");
export const MINE = APP.slice(0, MY_END_AT);
export const lineAt = (i) => APP.slice(0, i).split("\n").length;
export const MY_LAST_LINE = lineAt(MY_END_AT) - 1;

/** The one-pass stripper verify-panel-scope uses: comments and strings become spaces, newlines are
 *  kept, so an offset here is an offset in the file. A name inside a comment is NOT a reference. */
export function strip(src) {
  let out = "", i = 0; const n = src.length;
  const keep = (c) => (out += c); const hide = (c) => (out += c === "\n" ? "\n" : " ");
  const beforeRegex = /[([{=,:;!&|?+\-*%~^]$|\b(?:return|typeof|case|in|of|new|delete|void|do|else|yield|await)$/;
  const tmpl = [];
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === "/" && c2 === "/") { while (i < n && src[i] !== "\n") hide(src[i++]); continue; }
    if (c === "/" && c2 === "*") { hide(src[i++]); hide(src[i++]); while (i < n && !(src[i] === "*" && src[i + 1] === "/")) hide(src[i++]); hide(src[i++] || ""); hide(src[i++] || ""); continue; }
    if (c === '"' || c === "'") { const q = c; hide(src[i++]); while (i < n && src[i] !== q) { if (src[i] === "\\") hide(src[i++]); hide(src[i++]); } hide(src[i++] || ""); continue; }
    if (c === "`") { hide(src[i++]); while (i < n) { if (src[i] === "\\") { hide(src[i++]); hide(src[i++]); continue; } if (src[i] === "`") { hide(src[i++]); break; } if (src[i] === "$" && src[i + 1] === "{") { hide(src[i++]); hide(src[i++]); tmpl.push(1); break; } hide(src[i++]); } continue; }
    if (c === "}" && tmpl.length) { tmpl.pop(); keep(src[i++]); while (i < n) { if (src[i] === "\\") { hide(src[i++]); hide(src[i++]); continue; } if (src[i] === "`") { hide(src[i++]); break; } if (src[i] === "$" && src[i + 1] === "{") { hide(src[i++]); hide(src[i++]); tmpl.push(1); break; } hide(src[i++]); } continue; }
    if (c === "/") { const before = out.replace(/\s+$/, ""); if (beforeRegex.test(before)) { hide(src[i++]); let cls = false; while (i < n && src[i] !== "\n") { if (src[i] === "\\") { hide(src[i++]); hide(src[i++]); continue; } if (src[i] === "[") cls = true; else if (src[i] === "]") cls = false; else if (src[i] === "/" && !cls) { hide(src[i++]); break; } hide(src[i++]); } continue; } }
    keep(src[i++]);
  }
  return out;
}
export const CODE = strip(APP);            // whole file, comments + strings blanked (offsets kept)
export const MINE_CODE = CODE.slice(0, MY_END_AT);
export const count = (t, re) => (t.match(re) || []).length;
export const has = (t, re) => re.test(t);

/** Every declaration in the file — top level AND nested — name → [offset…]. */
export const DECLS = (() => {
  const m = new Map();
  for (const x of CODE.matchAll(/(?:^|[\s;{(])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|(?:^|[\s;{(])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    const name = x[1] || x[2];
    if (!m.has(name)) m.set(name, []);
    m.get(name).push(x.index);
  }
  return m;
})();
/** Is this name DECLARED inside my half (first declaration)? */
export const declaredMine = (name) => (DECLS.get(name) || [])[0] < MY_END_AT;
/** One top-level function's whole text, from its declaration to the next top-level declaration. */
export function fnText(name) {
  const re = new RegExp(`(?:^|\\n)(?:async )?function ${name.replace(/\$/g, "\\$")}\\(`);
  const m = APP.match(re);
  if (!m) return "";
  const i = m.index + (m[0].startsWith("\n") ? 1 : 0);
  const rest = APP.slice(i + 1);
  const j = rest.search(/\n(?:async function |function |const [A-Za-z_$][\w$]* = |let [A-Za-z_$][\w$]* = |\(function )/);
  return APP.slice(i, j < 0 ? APP.length : i + 1 + j);
}
/** References to a name in stripped code, excluding its declaration(s). */
export function refs(name, code = CODE) {
  const re = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, "\\$")}(?![\\w$])`, "g");
  const decl = new Set((DECLS.get(name) || []));
  let n = 0;
  for (const x of code.matchAll(re)) {
    // the declaration itself sits a few characters after the matched keyword offset
    const near = [...decl].some((d) => x.index >= d && x.index - d < 24);
    if (!near) n++;
  }
  return n;
}

// ── checks ─────────────────────────────────────────────────────────────────────────────────────
const defs = [];
/** check(id, what, how, fn) — `fn` returns true/false, {ok,note}, or "skip: …". */
export const check = (id, what, how, fn) => defs.push({ id, what, how, fn });
export const SUBJECT = "`public/panels/editor/app.js`";
export const ID_FLOOR = 175001, ID_CEILING = 176000;

export async function runAll({ ledger = false, quiet = false, only = null, block = null, json = null } = {}) {
  const seen = new Set();
  for (const d of defs) {
    if (seen.has(d.id)) throw new Error(`duplicate id ${d.id}`);
    seen.add(d.id);
    const n = Number(String(d.id).slice(1));
    if (/^P175\d{3}$|^P176000$/.test(d.id) && (n < ID_FLOOR || n > ID_CEILING)) throw new Error(`${d.id} is outside this terminal's block`);
  }
  const rows = [];
  for (const d of defs) {
    if (only && !only.split(",").includes(d.id)) continue;
    let res, note = "";
    try { res = await d.fn(); } catch (e) { res = false; note = `threw: ${(e && e.message) || e}`.slice(0, 200); }
    let mark;
    if (typeof res === "string" && res.startsWith("skip:")) { mark = "⏭"; note = res.slice(5).trim(); }
    else if (res && typeof res === "object") { mark = res.ok === "skip" ? "⏭" : res.ok ? "✅" : "❌"; note = res.note || note; }
    else mark = res ? "✅" : "❌";
    rows.push({ id: d.id, what: d.what, how: d.how, mark, note });
    if (!ledger && (!quiet || mark !== "✅")) console.log(`${mark} ${d.id}  ${d.what}${note ? `   — ${note}` : ""}`);
  }
  const esc = (x) => String(x).replace(/\|/g, "\\|").replace(/\n/g, " ");
  if (ledger) for (const r of rows) console.log(`| ${r.id} | ${esc(r.what)} | ${esc(r.how)} | ${r.mark} | ${esc(r.note)} |`);
  else {
    const bad = rows.filter((r) => r.mark === "❌"), sk = rows.filter((r) => r.mark === "⏭");
    console.log(`\n${rows.length} checks · ${rows.length - bad.length - sk.length} ✅ · ${bad.length} ❌ · ${sk.length} ⏭`);
  }
  if (json) { const fs = await import("node:fs"); fs.writeFileSync(json, JSON.stringify(rows, null, 1)); }
  return rows;
}

// ── GUARD ──────────────────────────────────────────────────────────────────────────────────────
const guardCache = new Map();
export function guard(script, args = []) {
  const k = script + " " + args.join(" ");
  if (guardCache.has(k)) return guardCache.get(k);
  let out;
  try { const o = execFileSync("node", [script, ...args], { cwd: ROOT, stdio: "pipe", timeout: 300000 }).toString(); out = { ok: true, code: 0, out: o }; }
  catch (e) { out = { ok: false, code: e.status, out: String(e.stdout || "").slice(-600) + String(e.stderr || "").slice(-300) }; }
  guardCache.set(k, out);
  return out;
}

// ── LIVE: the real panel, one login, the panel's own functions called in its frame ────────────
export const BASE = process.env.T6_BASE || "http://localhost:4406";
let _live = null;
/** { browser, ctx, page, frame } — the manager panel document opened directly, signed in once. */
export async function panel(opts = {}) {
  if (_live && !opts.fresh) return _live;
  const { chromium } = await import("playwright");
  const { loginAs } = await import("../login.mjs");
  const browser = _live ? _live.browser : await chromium.launch();
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 800 }, ...(opts.ctx || {}) });
  await loginAs(ctx, "manager", BASE);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message || e)));
  await page.goto(BASE + "/manager", { waitUntil: "domcontentloaded", timeout: 90000 });
  let frame = null;
  for (let i = 0; i < 120 && !frame; i++) {
    frame = page.frames().find((f) => /\/panels\/editor\/index\.html/.test(f.url()));
    if (!frame) await page.waitForTimeout(500);
  }
  if (!frame) throw new Error("the manager panel frame never appeared");
  await frame.waitForFunction(() => typeof window.api === "function" && typeof XRAY_WHO !== "undefined" && XRAY_WHO && state && state.settingsSettled, null, { timeout: 90000 });
  const out = { browser, ctx, page, frame, errors };
  if (!_live) _live = out;
  return out;
}
/** The SAME panel as the admin console opens it (higher view, every tab), French House. Signed in
 *  with the admin gate's own cookie — zero login requests, so no limit and no alert, ever. */
let _admin = null;
export async function adminPanel(opts = {}) {
  if (_admin && !opts.fresh) return _admin;
  const { chromium } = await import("playwright");
  const { adminCookie } = await import("../login.mjs");
  const browser = _live ? _live.browser : (_admin ? _admin.browser : await chromium.launch());
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 800 } });
  // The admin gate's cookie, plus the console's act-as pin naming French House (what /aevinite →
  // the restaurant → "open its manager panel" sets; lib/panelScope ADMIN_ACT_COOKIE).
  await ctx.addCookies([adminCookie(BASE), { name: "aevidine_admin_rid", value: FRENCH_HOUSE, url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message || e)));
  await page.goto(`${BASE}/manager?rid=${FRENCH_HOUSE}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  let frame = null;
  for (let i = 0; i < 120 && !frame; i++) { frame = page.frames().find((f) => /\/panels\/editor\/index\.html/.test(f.url())); if (!frame) await page.waitForTimeout(500); }
  if (!frame) throw new Error("the admin's view of the manager panel never appeared");
  await frame.waitForFunction(() => typeof XRAY_WHO !== "undefined" && XRAY_WHO && state && state.settingsSettled, null, { timeout: 90000 });
  const out = { browser, ctx, page, frame, errors };
  if (!_admin) _admin = out;
  return out;
}
export async function evAdmin(expr) { const { frame } = await adminPanel(); return frame.evaluate(`(async () => (${expr}))()`); }
/** Evaluate an expression (a string) inside the panel's frame; returns its value. */
export async function ev(expr, arg) {
  const { frame } = await panel();
  return frame.evaluate(`(async (ARG) => (${expr}))(${JSON.stringify(arg === undefined ? null : arg)})`);
}
export async function closeLive() {
  const b = (_live && _live.browser) || (_admin && _admin.browser);
  if (b) { try { await b.close(); } catch {} }
  _live = null; _admin = null;
}
export const noLive = async () => { try { const r = await fetch(BASE + "/api/health", { redirect: "manual" }); return r.status ? null : "skip: this terminal's dev server did not answer"; } catch { return "skip: this terminal's dev server did not answer"; } };

// French House is written to; Aangan is the READ-ONLY control and is only ever READ here.
export const FRENCH_HOUSE = "00000000-0000-0000-0000-000000000001";
