// scripts/sweep/t9s10/lib.mjs — the shared harness for sweep #10, terminal 9.
//
// Territory: app/api/editor/[...path]/route.ts, from line 1 to the END of the POST `table-sections`
// branch (line 3,345 on 2026-10-09 — the branch that straddles the 3,332 split is owned by the
// range holding its first line). That is: the helper block, the WHOLE GET handler, the floor
// wrapper, and the first POST branches (the preamble, print/send, the off-plan and clash gates,
// table-sections). Taken by LANDMARK, never by line number, so a comment added above does not
// silently move the boundary onto somebody else's code.
//
// FOUR sources, and every row says which one it used:
//   · SRC  — the route as it is on disk, comments stripped where the rule is about code
//   · STUB — the REAL route bundled with esbuild and its handlers CALLED in memory against the
//            repo's panel stubs (scripts/panel-stubs/*). Every gate and branch executes; no socket
//            opens. This is how the states the happy path never visits are DRIVEN: a module off,
//            a read that fails, an empty restaurant, a second restaurant, nobody signed in.
//   · LIVE — this terminal's own dev server (port 4409, never 4000), signed in ONCE as French
//            House's manager through scripts/sweep/login.mjs (it caches across processes).
//   · DB   — one read-only SQL statement against the dev database, scoped and limited.
//
// Never: a signed-out call to a running app, a swapped id, a write to Aangan.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const ROUTE_REL = "app/api/editor/[...path]/route.ts";
export const rd = (rel) => readFileSync(join(ROOT, rel), "utf8");
export const src = rd(ROUTE_REL);
export const lineOf = (i) => src.slice(0, i).split("\n").length;
const must = (i, what) => { if (i < 0) throw new Error(`t9s10: landmark not found — ${what}. Re-derive it; never let a check read an empty slice.`); return i; };

export const GET_START = must(src.indexOf("export async function GET("), "GET");
export const GET_END = must(src.indexOf("// ── DROPPING THE FLOOR SNAPSHOT"), "the floor wrapper");
export const POST_START = must(src.indexOf("async function postImpl("), "postImpl");
// The end of MY half: the first line of the branch AFTER table-sections.
export const MY_END = must(src.indexOf('if (a === "customer-capture")', POST_START), "the customer-capture branch");
export const HELPERS = src.slice(0, GET_START);
export const GETBLK = src.slice(GET_START, GET_END);
export const WRAP = src.slice(GET_END, POST_START);
export const POSTA = src.slice(POST_START, MY_END);
export const MINE = src.slice(0, MY_END);
export const MY_LAST_LINE = lineOf(MY_END) - 1;
export const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:"'`])\/\/[^\n"'`]*$/gm, "$1");
export const HC = strip(HELPERS), GC = strip(GETBLK), PC = strip(POSTA), MC = strip(MINE);
export const count = (t, re) => (t.match(re) || []).length;

/** One GET endpoint's body, from its `if (p === "x")` to the next endpoint test. */
export function endpoint(name) {
  const starts = [`if (p === "${name}")`, `if (path[0] === "${name}"`];
  let i = -1;
  for (const s of starts) { i = GETBLK.indexOf(s); if (i >= 0) break; }
  if (i < 0) return "";
  const nexts = [...GETBLK.matchAll(/\n {4}(?:\/\/[^\n]*\n {4})*if \((?:p === "|path\[0\] === ")/g)].map((m) => m.index).filter((x) => x > i + 10);
  const end = nexts.length ? Math.min(...nexts) : GETBLK.indexOf('return err("unknown GET endpoint"');
  return GETBLK.slice(i, end > i ? end : GETBLK.length);
}
/** One top-level helper's body, by its declaration text. */
export function helper(decl) {
  const i = HELPERS.indexOf(decl);
  if (i < 0) return "";
  const rest = HELPERS.slice(i);
  const m = rest.slice(1).search(/\n(?:async function |function |const [A-Za-z_]+ = |export const |type |\/\/ ──)/);
  return m < 0 ? rest : rest.slice(0, m + 1);
}
/** Every `sb.from(...)` chain in a text, bracket-matched (a fixed character window once borrowed
 *  the NEXT read's `.limit()` and passed over a real one). */
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

// ── THE ID BLOCK — P178001…P179000, sweep #10 terminal 9's alone ──────────────────────────────
export const ID_FLOOR = 178001, ID_CEILING = 179000;
const defs = [];
/** check(id, file, what, how, fn) — `fn` returns true/false, {ok,note}, or "skip: …". */
export const check = (id, what, how, fn) => defs.push({ id, what, how, fn });
export const SUBJECT = "`app/api/editor/[...path]/route.ts`";

export async function runAll({ ledger = false, quiet = false, only = null } = {}) {
  const seen = new Set();
  for (const d of defs) {
    if (seen.has(d.id)) throw new Error(`duplicate id ${d.id}`);
    seen.add(d.id);
    const n = Number(String(d.id).slice(1));
    if (/^P17[89]\d{3}$/.test(d.id) && (n < ID_FLOOR || n > ID_CEILING)) throw new Error(`${d.id} is outside this terminal's block`);
  }
  const rows = [];
  for (const d of defs) {
    if (only && d.id !== only) continue;
    let res, note = "";
    try { res = await d.fn(); } catch (e) { res = false; note = `threw: ${(e && e.message) || e}`.slice(0, 160); }
    let mark;
    if (typeof res === "string" && res.startsWith("skip:")) { mark = "⏭"; note = res.slice(5).trim(); }
    else if (res && typeof res === "object") { mark = res.ok ? "✅" : "❌"; note = res.note || note; }
    else mark = res ? "✅" : "❌";
    rows.push({ ...d, mark, note });
    if (!ledger && (!quiet || mark === "❌")) console.log(`${mark} ${d.id}  ${d.what}${note ? `   — ${note}` : ""}`);
  }
  const esc = (x) => String(x).replace(/\|/g, "\\|").replace(/\n/g, " ");
  if (ledger) {
    for (const r of rows) console.log(`| ${r.id} | ${esc(r.what)} | ${esc(r.how)} | ${r.mark} | ${esc(r.note)} |`);
  } else {
    const bad = rows.filter((r) => r.mark === "❌"), sk = rows.filter((r) => r.mark === "⏭");
    console.log(`\n${rows.length} checks · ${rows.length - bad.length - sk.length} ✅ · ${bad.length} ❌ · ${sk.length} ⏭`);
    if (bad.length) { console.log("failures:"); for (const b of bad) console.log(`  ${b.id}  ${b.what}${b.note ? ` — ${b.note}` : ""}`); }
  }
  return rows;
}

// ── STUB: the real route, bundled, called in memory ──────────────────────────────────────────
const require_ = createRequire(import.meta.url);
let _route = null, _G = null, _reset = null;
export async function stubRoute() {
  if (_route) return { route: _route, G: _G, resetWorld: _reset };
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:9/stub";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "stub-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "stub-service-key";
  const out = join(ROOT, "node_modules/.cache/t9s10-editor-route.cjs");
  execFileSync("npx", ["esbuild", ROUTE_REL, "--bundle", "--platform=node", "--format=cjs", "--alias:@=.",
    "--alias:@/lib/supabaseAdmin=./scripts/panel-stubs/sb.mjs",
    "--alias:@/lib/userAuth=./scripts/panel-stubs/userAuth.mjs",
    "--alias:@/lib/oplog=./scripts/panel-stubs/oplog.mjs",
    "--external:next/server", "--external:next/cache", "--external:next/headers",
    `--outfile=${out}`, "--log-level=warning"], { cwd: ROOT });
  const st = await import(pathToFileURL(join(ROOT, "scripts/panel-stubs/state.mjs")).href);
  _G = st.G; _reset = st.resetWorld; _route = require_(out);
  return { route: _route, G: _G, resetWorld: _reset };
}
export const RID = "rest-1", RID2 = "rest-2";
const MANAGER = (extra = {}) => ({ id: "u1", role: "manager", name: "Diag Manager", username: "diagm1", restaurant_id: RID, permissions: {}, ...extra });
/** A fresh in-memory world. `who`: manager | owner | admin | nobody | blip. */
export async function world(o = {}) {
  const { G, resetWorld } = await stubRoute();
  resetWorld();
  delete G.FAIL; delete G.FAIL_NTH; delete G.CALLS; delete G.RPC_IMPL;
  G.HONOUR_RANGE = true; // real paging (scripts/panel-stubs/sb.mjs opt-in) — a paged report must not loop
  const who = o.who || "manager";
  G.ACTOR = who === "admin" ? { ok: true, user: null }
    : who === "owner" ? { ok: true, user: { id: "o1", role: "owner", name: "Owner", username: "own1", restaurant_id: RID, permissions: {} } }
    : who === "nobody" ? { ok: false, transient: false }
    : who === "blip" ? { ok: false, transient: true }
    : { ok: true, user: MANAGER(o.user || {}) };
  G.FIX.restaurants = o.restaurants || [
    { id: RID, slug: "french-house", name: "French House", manager_permissions: o.perms || {}, owner_entitlements: o.ents || {}, access_config: o.accessConfig || {} },
    { id: RID2, slug: "aangan", name: "Aangan", manager_permissions: {}, owner_entitlements: {}, access_config: {} },
  ];
  G.FIX.settings = o.settingsRows || [
    { id: "site", restaurant_id: RID, table_count: 20, tax_rate: 0.05, restaurant_name: "French House", gstin: "24AAAAA0000A1Z5", modules: {}, ...(o.settings || {}) },
    { id: "site2", restaurant_id: RID2, table_count: 12, tax_rate: 0.05, restaurant_name: "Aangan", gstin: "", modules: {} },
  ];
  for (const [k, v] of Object.entries(o.fix || {})) G.FIX[k] = JSON.parse(JSON.stringify(v));
  if (o.rpc) for (const [k, v] of Object.entries(o.rpc)) G.RPC_ANSWERS[k] = v;
  if (o.rpcImpl) G.RPC_IMPL = o.rpcImpl;
  if (o.fail) G.FAIL = o.fail;
  return G;
}
/** Call one handler. Returns { status, json, text, headers }. */
export async function call(verb, path, opts = {}) {
  const { route } = await stubRoute();
  const { NextRequest } = require_("next/server");
  const headers = { "content-type": "application/json", cookie: "aevidine_admin_rid=" + (opts.adminRid || RID), ...(opts.headers || {}) };
  const init = { method: verb, headers };
  if (opts.body !== undefined) init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  if (opts.form) { delete headers["content-type"]; init.body = opts.form; }
  const r = await route[verb](new NextRequest(`http://localhost/api/editor/${path}${opts.query || ""}`, init),
    { params: Promise.resolve({ path: path ? path.split("/") : [] }) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, headers: r.headers };
}

// ── LIVE ───────────────────────────────────────────────────────────────────────────────────────
export const BASE = process.env.T9_BASE || "http://127.0.0.1:4409";
let cookies = null;
export async function liveCookie(role = "manager") {
  if (cookies) return cookies;
  const { chromium } = await import("playwright");
  const { loginAs } = await import("../login.mjs");
  const b = await chromium.launch();
  try { const ctx = await b.newContext(); await loginAs(ctx, role, BASE); cookies = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; "); }
  finally { await b.close(); }
  return cookies;
}
const liveCache = new Map();
/** GET one editor endpoint as French House's manager — once per path per run. */
export async function live(path) {
  if (liveCache.has(path)) return liveCache.get(path);
  const t0 = Date.now();
  let out;
  try {
    const r = await fetch(`${BASE}/api/editor${path}`, { headers: { cookie: await liveCookie() }, redirect: "manual" });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    out = { status: r.status, json, text, ms: Date.now() - t0, headers: r.headers };
  } catch (e) { out = { status: 0, json: null, text: String(e && e.message), ms: Date.now() - t0 }; }
  liveCache.set(path, out);
  return out;
}
export const noLive = (r) => (!r || !r.status ? "skip: this terminal's dev server did not answer" : null);

// ── DB (read-only) ─────────────────────────────────────────────────────────────────────────────
const env = Object.fromEntries(rd(".env.local").split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
export async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, read_only: true }),
  });
  if (!r.ok) throw new Error(`db: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
// French House is written to; Aangan is the READ-ONLY control and is only ever READ here.
export const FRENCH_HOUSE = "00000000-0000-0000-0000-000000000001";
