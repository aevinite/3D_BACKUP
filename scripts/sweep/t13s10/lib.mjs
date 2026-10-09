// scripts/sweep/t13s10/lib.mjs — the shared harness for sweep #10, terminal 13.
//
// Territory (7 files): app/api/tablet/[...path]/route.ts · lib/cancelWatch.ts · lib/floorSummary.ts ·
// lib/liveBoard.ts · lib/managerCan.ts · lib/tableOfAction.ts · lib/tableTags.ts.
//
// FOUR sources, and every row says which one it used (the `how` column starts with it):
//   · SRC  — the file as it is on disk, comments stripped where the rule is about code
//   · STUB — the REAL file bundled with esbuild and CALLED in memory against scripts/panel-stubs/*
//            (the harness terminal 9 built). Every gate and branch executes; no socket opens. This is
//            how the states the happy path never visits are DRIVEN: a module off, a read that fails,
//            a permission on PIN, a second restaurant, the admin looking in.
//   · LIVE — this terminal's own dev server (port 4413, never 4000), signed in ONCE as French
//            House's waiter (diagt1) through scripts/sweep/login.mjs (it caches across processes).
//   · DB   — one read-only SQL statement against the dev database, scoped and limited.
//
// Never: a signed-out call to a running app, a swapped id, a write to Aangan.
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const ROUTE_REL = "app/api/tablet/[...path]/route.ts";
export const rd = (rel) => readFileSync(join(ROOT, rel), "utf8");
export const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:"'`\\])\/\/[^\n"'`]*$/gm, "$1");
export const count = (t, re) => (t.match(re) || []).length;
export const FILES = {
  route: ROUTE_REL, cancelWatch: "lib/cancelWatch.ts", floorSummary: "lib/floorSummary.ts", liveBoard: "lib/liveBoard.ts",
  managerCan: "lib/managerCan.ts", tableOfAction: "lib/tableOfAction.ts", tableTags: "lib/tableTags.ts",
};
export const SRC = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, rd(f)]));
export const CODE = Object.fromEntries(Object.entries(SRC).map(([k, t]) => [k, strip(t)]));
const must = (i, what) => { if (i < 0) throw new Error(`t13s10: landmark not found — ${what}. Re-derive it; never let a check read an empty slice.`); return i; };
const R = SRC.route;
export const GET_START = must(R.indexOf("export async function GET("), "GET");
export const POST_START = must(R.indexOf("async function postImpl("), "postImpl");
export const HELPERS = R.slice(0, GET_START);
export const GETBLK = R.slice(GET_START, POST_START);
export const POSTBLK = R.slice(POST_START);
export const HC = strip(HELPERS), GC = strip(GETBLK), PC = strip(POSTBLK);

/** One POST branch's text, from its `if (a === …` test to the next top-level branch test. */
export function branch(test) {
  const i = POSTBLK.indexOf(test);
  if (i < 0) return "";
  const re = /\n {4}(?:\/\/[^\n]*\n {4})*if \(a === "/g;
  re.lastIndex = i + test.length;
  const m = re.exec(POSTBLK);
  return POSTBLK.slice(i, m ? m.index : POSTBLK.length);
}
/** One GET endpoint's text, from its `path.join("/") === "x"` to the next endpoint test. */
export function getEndpoint(name) {
  const i = GETBLK.indexOf(`path.join("/") === "${name}"`);
  if (i < 0) return "";
  const re = /\n {4}(?:\/\/[^\n]*\n {4})*if \(path\.join\("\/"\) === "/g;
  re.lastIndex = i + 10;
  const m = re.exec(GETBLK);
  return GETBLK.slice(i, m ? m.index : GETBLK.length);
}
/** A top-level helper's text in any of my files, by its declaration. */
export function helperIn(text, decl) {
  const i = text.indexOf(decl);
  if (i < 0) return "";
  const rest = text.slice(i);
  const m = rest.slice(1).search(/\n(?:export |async function |function |const [A-Za-z_]+ = |type |\/\/ ──)/);
  return m < 0 ? rest : rest.slice(0, m + 1);
}
/** Every `sb.from(...)` chain in a text, bracket-matched. */
export function chains(text) {
  const out = [];
  const re = /sb\s*\n?\s*\.?from\(/g;
  let m;
  while ((m = re.exec(text))) {
    let d = 0, j = m.index + m[0].length - 1;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === "(") d++;
      else if (c === ")") { d--; if (d === 0) { let k = j + 1; while (k < text.length && /\s/.test(text[k])) k++; if (text[k] === ".") continue; break; } }
    }
    const chain = text.slice(m.index, j + 1);
    out.push({ at: m.index, chain, flat: chain.replace(/\s+/g, " "), table: (chain.match(/from\("([^"]+)"\)/) || [])[1] });
  }
  return out;
}

// ── THE ID BLOCK — P182001…P183000, sweep #10 terminal 13's alone ─────────────────────────────
export const ID_FLOOR = 182001, ID_CEILING = 183000;
const defs = [];
/** check(id, file, what, how, fn) — `fn` returns true/false, {ok,note}, or "skip: …". `file` is the SUBJECT. */
export const check = (id, file, what, how, fn) => defs.push({ id, file, what, how, fn });
/** A re-run of an EXISTING ledger row: the id is the old one, and `ledger` names where it lives. */
export const rerun = (id, ledger, what, how, fn) => defs.push({ id, ledger, file: "", what, how, fn, rerun: true });

export async function runAll({ ledger = false, quiet = false, only = null } = {}) {
  const seen = new Set();
  for (const d of defs) {
    if (seen.has(d.id)) throw new Error(`duplicate id ${d.id}`);
    seen.add(d.id);
    if (!d.rerun) {
      const n = Number(String(d.id).slice(1));
      if (n < ID_FLOOR || n > ID_CEILING) throw new Error(`${d.id} is outside this terminal's block`);
    }
  }
  const rows = [];
  for (const d of defs) {
    if (only && !only.includes(d.id)) continue;
    let res, note = "";
    try { res = await d.fn(); } catch (e) { res = false; note = `threw: ${(e && e.message) || e}`.slice(0, 180); }
    let mark;
    if (typeof res === "string" && res.startsWith("skip:")) { mark = "⏭"; note = res.slice(5).trim(); }
    else if (res && typeof res === "object") { mark = res.ok ? "✅" : "❌"; note = res.note || note; }
    else mark = res ? "✅" : "❌";
    rows.push({ ...d, mark, note });
    if (!ledger && (!quiet || mark === "❌")) console.log(`${mark} ${d.id}  ${d.what}${note ? `   — ${note}` : ""}`);
  }
  const esc = (x) => String(x).replace(/\|/g, "\\|").replace(/\n/g, " ");
  if (ledger) {
    for (const r of rows) console.log(`| ${r.id} | \`${r.file}\` — ${esc(r.what)} | ${esc(r.how)} | ${r.mark} | ${esc(r.note)} |`);
  } else {
    const bad = rows.filter((r) => r.mark === "❌"), sk = rows.filter((r) => r.mark === "⏭");
    console.log(`\n${rows.length} checks · ${rows.length - bad.length - sk.length} ✅ · ${bad.length} ❌ · ${sk.length} ⏭`);
    if (bad.length) { console.log("failures:"); for (const b of bad) console.log(`  ${b.id}  ${b.what}${b.note ? ` — ${b.note}` : ""}`); }
  }
  return rows;
}

// ── STUB: the real files, bundled, called in memory ──────────────────────────────────────────
const require_ = createRequire(import.meta.url);
const CACHE = join(ROOT, "node_modules/.cache");
const ALIASES = ["--alias:@=.",
  "--alias:@/lib/supabaseAdmin=./scripts/sweep/t13s10/stubs/sb.mjs",
  "--alias:@/lib/userAuth=./scripts/sweep/t13s10/stubs/userAuth.mjs",
  "--alias:@/lib/oplog=./scripts/sweep/t13s10/stubs/oplog.mjs",
  "--external:next/server", "--external:next/cache", "--external:next/headers"];
const bundles = new Map();
/** Bundle one repo file (route or lib) against the stubs and require it. */
export function bundle(rel) {
  if (bundles.has(rel)) return bundles.get(rel);
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:9/stub";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "stub-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "stub-service-key";
  mkdirSync(CACHE, { recursive: true });
  const out = join(CACHE, `t13s10-${rel.replace(/[^A-Za-z0-9]+/g, "_")}.cjs`);
  execFileSync("npx", ["esbuild", rel, "--bundle", "--platform=node", "--format=cjs", ...ALIASES,
    `--outfile=${out}`, "--log-level=error"], { cwd: ROOT });
  const mod = require_(out);
  bundles.set(rel, mod);
  return mod;
}
let _G = null, _reset = null;
export async function state() {
  if (_G) return { G: _G, resetWorld: _reset };
  const st = await import(pathToFileURL(join(ROOT, "scripts/panel-stubs/state.mjs")).href);
  _G = st.G; _reset = st.resetWorld;
  return { G: _G, resetWorld: _reset };
}
export const RID = "rest-1", RID2 = "rest-2";
export const FULL_FLOOR = Array.from({ length: 20 }, (_, i) => i + 1);
export const WAITER = (extra = {}) => ({ id: "w1", role: "tablet", name: "Diag Waiter", username: "diagt1", restaurant_id: RID, permissions: {}, assigned_tables: FULL_FLOOR, ...extra });
/** A fresh in-memory world. `who`: waiter | manager | owner | admin | nobody | blip. */
export async function world(o = {}) {
  bundle(ROUTE_REL);
  const { G, resetWorld } = await state();
  resetWorld();
  delete G.FAIL; delete G.FAIL_NTH; delete G.CALLS; delete G.RPC_IMPL;
  G.HONOUR_RANGE = true; G.HONOUR_NOT_IN = true; G.HONOUR_LIMIT = true;
  G.NULL_DATA = o.nullData || undefined;
  G.SCOPE_LOG = [];
  const who = o.who || "waiter";
  G.ACTOR = who === "admin" ? { ok: true, user: null }
    : who === "owner" ? { ok: true, user: { id: "o1", role: "owner", name: "Owner", username: "own1", restaurant_id: RID, permissions: {}, ...(o.user || {}) } }
    : who === "manager" ? { ok: true, user: { id: "m1", role: "manager", name: "Diag Manager", username: "diagm1", restaurant_id: RID, permissions: {}, ...(o.user || {}) } }
    : who === "nobody" ? { ok: false, transient: false }
    : who === "blip" ? { ok: false, transient: true }
    : { ok: true, user: WAITER(o.user || {}) };
  G.FIX.restaurants = o.restaurants || [
    { id: RID, slug: "french-house", name: "French House", logo_text: "FH", accent_color: "#c00", logo_url: "https://x/logo.png", manager_permissions: o.perms || {}, owner_entitlements: o.ents || {}, access_config: o.accessConfig || {} },
    { id: RID2, slug: "aangan", name: "Aangan", manager_permissions: {}, owner_entitlements: {}, access_config: {} },
  ];
  G.FIX.settings = o.settingsRows || [
    { id: "site", restaurant_id: RID, table_count: 20, tax_rate: 0.05, restaurant_name: "French House", modules: {},
      take_orders_allowed: true, table_ops_allowed: true, table_tags_allowed: true, khata_allowed: true, banquet_allowed: true,
      tablet_take_orders: "on", tablet_table_ops: "on", tablet_table_tags: "on", tablet_khata: "on", tablet_banquet: "on",
      tablet_mark_paid: "on", tablet_discount: "on", tablet_parcel: "on", tablet_invoice: "on", platform_channels: { zomato: { key: "SECRET-KEY" } },
      ...(o.settings || {}) },
    { id: "site2", restaurant_id: RID2, table_count: 12, tax_rate: 0.05, restaurant_name: "Aangan", modules: {} },
  ];
  for (const [k, v] of Object.entries(o.fix || {})) G.FIX[k] = JSON.parse(JSON.stringify(v));
  if (o.rpc) for (const [k, v] of Object.entries(o.rpc)) G.RPC_ANSWERS[k] = v;
  if (o.rpcImpl) G.RPC_IMPL = o.rpcImpl;
  if (o.fail) G.FAIL = o.fail;
  if (o.failNth) G.FAIL_NTH = o.failNth;
  return G;
}
/** Call one tablet handler in memory. Returns { status, json, text }. */
export async function call(verb, path, opts = {}) {
  const route = bundle(ROUTE_REL);
  const { G } = await state();
  G.SCOPE_WHERE = `${verb} ${path}${opts.query || ""}`;
  const { NextRequest } = require_("next/server");
  const headers = { "content-type": "application/json", ...(opts.headers || {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  const init = { method: verb, headers };
  if (opts.body !== undefined) init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  const r = await route[verb](new NextRequest(`http://localhost/api/tablet/${path}${opts.query || ""}`, init),
    { params: Promise.resolve({ path: path ? path.split("/") : [] }) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}
/** Writes on a table, from the stub's log. */
export const writesOn = (G, ...tables) => G.WRITES.filter((w) => tables.includes(w.table));

// ── LIVE ───────────────────────────────────────────────────────────────────────────────────────
export const BASE = process.env.T13_BASE || "http://127.0.0.1:4413";
let cookies = null;
export async function liveCookie(role = "tablet") {
  if (cookies) return cookies;
  const { chromium } = await import("playwright");
  const { loginAs } = await import("../login.mjs");
  const b = await chromium.launch();
  try { const ctx = await b.newContext(); await loginAs(ctx, role, BASE); cookies = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; "); }
  finally { await b.close(); }
  return cookies;
}
const liveCache = new Map();
/** GET one tablet endpoint as French House's waiter — once per path per run. */
export async function live(path) {
  if (liveCache.has(path)) return liveCache.get(path);
  const t0 = Date.now();
  let out;
  try {
    const r = await fetch(`${BASE}/api/tablet${path}`, { headers: { cookie: await liveCookie() }, redirect: "manual" });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    out = { status: r.status, json, text, ms: Date.now() - t0, bytes: Buffer.byteLength(text) };
  } catch (e) { out = { status: 0, json: null, text: String(e && e.message), ms: Date.now() - t0, bytes: 0 }; }
  liveCache.set(path, out);
  return out;
}
export const noLive = (r) => (!r || !r.status ? "skip: this terminal's dev server did not answer" : null);

// ── DB (read-only) ─────────────────────────────────────────────────────────────────────────────
const env = Object.fromEntries(rd(".env.local").split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const sqlCache = new Map();
export async function sql(query) {
  if (sqlCache.has(query)) return sqlCache.get(query);
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, read_only: true }),
  });
  if (!r.ok) throw new Error(`db: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  sqlCache.set(query, j);
  return j;
}
// French House is written to; Aangan is the READ-ONLY control and is only ever READ here.
export const FRENCH_HOUSE = "00000000-0000-0000-0000-000000000001";
