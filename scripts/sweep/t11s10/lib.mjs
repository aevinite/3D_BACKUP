// scripts/sweep/t11s10/lib.mjs — the shared harness for sweep #10, terminal 11 (the kitchen screen).
//
// Territory (6 files): app/api/kitchen/[...path]/route.ts · app/kitchen/layout.tsx · app/kitchen/page.tsx ·
// app/r/[restaurant]/kitchen/page.tsx · public/panels/kitchen/app.js · public/panels/kitchen/index.html.
//
// FIVE sources, and every row's `how` column starts with the one it used:
//   · SRC   — the file as it is on disk (comments stripped where the rule is about code)
//   · STUB  — the REAL kitchen route bundled with esbuild and CALLED in memory against the shared
//             stub database (scripts/panel-stubs + terminal 13's stubs). Every gate and branch
//             executes; no socket opens. This is how the states the happy path never visits are driven.
//   · PANEL — the REAL panel running in Chromium on this terminal's own dev server (port 4411, never
//             4000), signed in ONCE as French House's diag kitchen login; the panel's own functions are
//             called and its RENDERED DOM is read. Values injected into `state` never leave the tab.
//   · LIVE  — the same server and login, a real request / a real database row, removed by its own id.
//   · LOOK  — a screenshot this terminal opened and looked at.
//
// Never: a signed-out call to a running app, a swapped id, a write to Aangan.
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const F = {
  route: "app/api/kitchen/[...path]/route.ts", layout: "app/kitchen/layout.tsx", page: "app/kitchen/page.tsx",
  rpage: "app/r/[restaurant]/kitchen/page.tsx", app: "public/panels/kitchen/app.js", html: "public/panels/kitchen/index.html",
};
export const rd = (rel) => readFileSync(join(ROOT, rel), "utf8");
// Line comments first, then block comments (a `/*` inside a `//` line must not open a block).
export const strip = (t) => t.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
export const SRC = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, rd(f)]));
export const CODE = Object.fromEntries(Object.entries(SRC).map(([k, t]) => [k, k === "html" ? t.replace(/<!--[\s\S]*?-->/g, "") : strip(t)]));

/** One POST branch of the kitchen route, from its test to the next top-level `if (a === "` test. */
export function branch(test) {
  const R = CODE.route, i = R.indexOf(test);
  if (i < 0) return "";
  const rest = R.slice(i + test.length), m = rest.search(/\n {4}if \(a === "/);
  return m < 0 ? R.slice(i) : R.slice(i, i + test.length + m);
}
/** A top-level function of app.js, by its declaration, to the next top-level declaration. */
export function fnText(decl) {
  const a = CODE.app, i = a.indexOf(decl);
  if (i < 0) return "";
  const rest = a.slice(i + decl.length);
  const m = rest.search(/\n(?:async function |function |const [A-Za-z_$]+ = |let [A-Za-z_$]+ = |\$\(")/);
  return m < 0 ? a.slice(i) : a.slice(i, i + decl.length + m);
}

// ── THE ID BLOCK — P180001…P181000, sweep #10 terminal 11's alone ──────────────────────────────
export const ID_FLOOR = 180001, ID_CEILING = 181000;
const defs = [];
/** check(id, file, what, how, fn) — fn returns true/false, {ok, note}, or "skip: …". `file` is the SUBJECT. */
export const check = (id, file, what, how, fn) => defs.push({ id, file, what, how, fn });
export const defsList = () => defs;

export async function runAll({ ledger = false, only = null, quiet = false } = {}) {
  const seen = new Set();
  for (const d of defs) {
    if (seen.has(d.id)) throw new Error(`duplicate id ${d.id}`);
    seen.add(d.id);
    const n = Number(String(d.id).slice(1));
    if (!(n >= ID_FLOOR && n <= ID_CEILING)) throw new Error(`${d.id} is outside this terminal's block`);
    if (!Object.values(F).includes(d.file)) throw new Error(`${d.id} names a subject outside the territory: ${d.file}`);
  }
  const rows = [];
  for (const d of defs) {
    if (only && !only.includes(d.id)) continue;
    let res, note = "";
    try { res = await d.fn(); } catch (e) { res = false; note = `threw: ${(e && e.message) || e}`.slice(0, 200); }
    let mark;
    if (typeof res === "string" && res.startsWith("skip:")) { mark = "⏭"; note = res.slice(5).trim(); }
    else if (res && typeof res === "object") { mark = res.ok ? "✅" : "❌"; note = res.note || note; }
    else mark = res ? "✅" : "❌";
    rows.push({ ...d, mark, note });
    if (!ledger && (!quiet || mark === "❌")) console.log(`${mark} ${d.id}  ${d.what}${note ? `   — ${note}` : ""}`);
  }
  const esc = (x) => String(x).replace(/\|/g, "\\|").replace(/\n/g, " ");
  if (ledger) for (const r of rows) console.log(`| ${r.id} | \`${r.file}\` — ${esc(r.what)} | ${esc(r.how)} | ${r.mark} | ${esc(r.note).slice(0, 220)} |`);
  const bad = rows.filter((r) => r.mark === "❌"), sk = rows.filter((r) => r.mark === "⏭");
  if (!ledger) {
    console.log(`\n${rows.length} checks · ${rows.length - bad.length - sk.length} ✅ · ${bad.length} ❌ · ${sk.length} ⏭`);
    if (bad.length) { console.log("failures:"); for (const b of bad) console.log(`  ${b.id}  ${b.what}${b.note ? ` — ${b.note}` : ""}`); }
  }
  return rows;
}

// ── STUB: the real kitchen route, bundled, called in memory ───────────────────────────────────
const require_ = createRequire(import.meta.url);
const CACHE = join(ROOT, "node_modules/.cache");
let routeMod = null;
export function route() {
  if (routeMod) return routeMod;
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:9/stub";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "stub-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "stub-service-key";
  mkdirSync(CACHE, { recursive: true });
  const out = join(CACHE, "t11s10-kitchen-route.cjs");
  execFileSync("npx", ["esbuild", F.route, "--bundle", "--platform=node", "--format=cjs", "--alias:@=.",
    "--alias:@/lib/supabaseAdmin=./scripts/sweep/t13s10/stubs/sb.mjs",
    "--alias:@/lib/userAuth=./scripts/sweep/t13s10/stubs/userAuth.mjs",
    "--alias:@/lib/oplog=./scripts/sweep/t13s10/stubs/oplog.mjs",
    "--external:next/server", "--external:next/cache", "--external:next/headers",
    `--outfile=${out}`, "--log-level=error"], { cwd: ROOT });
  routeMod = require_(out);
  return routeMod;
}
let _G = null, _reset = null;
async function st() {
  if (_G) return { G: _G, resetWorld: _reset };
  const s = await import(pathToFileURL(join(ROOT, "scripts/panel-stubs/state.mjs")).href);
  _G = s.G; _reset = s.resetWorld;
  return { G: _G, resetWorld: _reset };
}
export const RID = "rest-1", RID2 = "rest-2";
export const NOW = () => new Date().toISOString();
/** A fresh in-memory world. who: kitchen | admin | manager | owner | tablet | nobody | blip. */
export async function world(o = {}) {
  route();
  const { G, resetWorld } = await st();
  resetWorld();
  for (const k of ["FAIL", "FAIL_NTH", "CALLS", "RPC_IMPL", "RPC_ERR", "BLOCKED", "BLOCK_ASKS", "NULL_DATA"]) delete G[k];
  G.HONOUR_RANGE = true; G.HONOUR_NOT_IN = true; G.HONOUR_LIMIT = true;
  G.SCOPE_LOG = [];
  const who = o.who || "kitchen";
  const u = (role, extra) => ({ ok: true, user: { id: role[0] + "1", role, name: "Diag " + role, username: "diag" + role, restaurant_id: RID, permissions: {}, ...(o.user || {}), ...(extra || {}) } });
  G.ACTOR = who === "admin" ? { ok: true, user: null }
    : who === "nobody" ? { ok: false, transient: false }
    : who === "blip" ? { ok: false, transient: true }
    : u(who);
  G.FIX.restaurants = [
    { id: RID, slug: "french-house", name: "French House", logo_text: "FH", accent_color: "#c00", active: true, owner_entitlements: o.ents || {}, manager_permissions: {}, access_config: o.accessConfig || {} },
    { id: RID2, slug: "aangan", name: "Aangan", logo_text: null, active: true, owner_entitlements: {}, manager_permissions: {}, access_config: {} },
  ];
  G.FIX.settings = [
    { id: "site", restaurant_id: RID, kitchen_can_accept_platform: false, auto_print_kot: false, auto_print_kot_allowed: false, platform_channels: {}, table_names: {}, modules: {}, ...(o.settings || {}) },
    { id: "site2", restaurant_id: RID2, kitchen_can_accept_platform: true, auto_print_kot: true, auto_print_kot_allowed: true, platform_channels: {}, table_names: { 1: "AANGAN-1" }, modules: {} },
  ];
  for (const [k, v] of Object.entries(o.fix || {})) G.FIX[k] = JSON.parse(JSON.stringify(v));
  if (o.rpc) for (const [k, v] of Object.entries(o.rpc)) G.RPC_ANSWERS[k] = v;
  if (o.rpcImpl) G.RPC_IMPL = o.rpcImpl;
  if (o.fail) G.FAIL = o.fail;
  if (o.blocked) G.BLOCKED = o.blocked;
  if (o.nullData) G.NULL_DATA = o.nullData;
  return G;
}
/** Call one kitchen handler in memory. Returns { status, json, text }. */
export async function call(verb, path, opts = {}) {
  const r0 = route();
  const { G } = await st();
  G.SCOPE_WHERE = `${verb} ${path}${opts.query || ""}`;
  const { NextRequest } = require_("next/server");
  const headers = { "content-type": "application/json", ...(opts.headers || {}) };
  const init = { method: verb, headers };
  if (opts.body !== undefined) init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  const r = await r0[verb](new NextRequest(`http://localhost/api/kitchen/${path}${opts.query || ""}`, init),
    { params: Promise.resolve({ path: path ? path.split("/") : [] }) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}
export const G = async () => (await st()).G;
/** Every statement the last call made on a restaurant-owned table that did NOT name the restaurant. */
export async function unscoped(tables = ["orders", "order_items", "menu_items", "aggregator_orders", "settings", "table_tags", "print_jobs", "printer_events", "print_stations"]) {
  const g = await G();
  return (g.SCOPE_LOG || []).filter((q) => tables.includes(q.table)
    && !q.filters.some((f) => f.col === "restaurant_id" || (q.table === "restaurants" && f.col === "id"))
    && !(q.op === "insert" && q.patch && (Array.isArray(q.patch) ? q.patch.every((p) => p.restaurant_id) : q.patch.restaurant_id))
    && !(q.op === "upsert" && q.patch && q.patch.restaurant_id));
}

// ── PANEL / LIVE ─────────────────────────────────────────────────────────────────────────────
export const BASE = process.env.T11_BASE || "http://localhost:4411";
export const PANEL_SEL = "iframe[src*='/panels/kitchen/index.html']";
let browser = null, ctxMain = null, route_ = null, storage = null;
export async function chromium() { return (await import("playwright")).chromium; }
export async function signedContext(opts = {}) {
  const cr = await chromium();
  if (!browser) browser = await cr.launch();
  if (!storage) {
    const { loginAs } = await import("../login.mjs");
    ctxMain = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    route_ = await loginAs(ctxMain, "kitchen", BASE);
    storage = await ctxMain.storageState();
  }
  return { ctx: await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts, storageState: storage }), route: route_ };
}
/** Open the kitchen board in a fresh signed-in context and hand back the panel frame. */
export async function openBoard(opts = {}) {
  const { ctx, route: r } = await signedContext(opts.ctx || {});
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e).slice(0, 160)));
  if (opts.beforeGoto) await opts.beforeGoto(page, ctx);
  await page.goto(BASE + r + (opts.query || ""), { waitUntil: "networkidle", timeout: 90000 });
  const frame = await (await page.waitForSelector(PANEL_SEL, { timeout: 45000 })).contentFrame();
  await frame.waitForFunction(() => window.state && state.knownIds, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(opts.settle ?? 1200);
  return { ctx, page, frame, errors };
}
export async function closeAll() { if (browser) { await browser.close().catch(() => {}); browser = null; } }
export async function cookieHeader() {
  await signedContext();
  return (storage.cookies || []).map((c) => `${c.name}=${c.value}`).join("; ");
}
export async function liveGet(path) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/kitchen${path}`, { headers: { cookie: await cookieHeader() }, redirect: "manual" });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: r.status, json, text, ms: Date.now() - t0, bytes: Buffer.byteLength(text) };
}

// ── DB (service role, scoped + limited; French House only for writes) ─────────────────────────
const env = Object.fromEntries(rd(".env.local").split("\n").filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
export const FRENCH_HOUSE = "00000000-0000-0000-0000-000000000001";
// A busy dev database answers 57014 (statement timeout) now and then — measured: a clean-up DELETE
// was refused that way and left a VIP mark behind. Every call retries twice on a 5xx before it gives up.
export async function db(path, init = {}) {
  for (let i = 0; ; i++) {
    try { return await db1(path, init); }
    catch (e) { if (i >= 2 || !/db 5\d\d/.test(String(e.message))) throw e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
}
async function db1(path, init = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ }
  if (!r.ok) throw new Error(`db ${r.status}: ${t.slice(0, 200)}`);
  return j;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
