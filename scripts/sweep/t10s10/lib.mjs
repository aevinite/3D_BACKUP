// scripts/sweep/t10s10/lib.mjs — the shared harness for sweep #10, terminal 10.
//
// Territory: app/api/editor/[...path]/route.ts from the POST `customer-capture` branch to the END
// of the file — every POST branch after `table-sections`, the generic upsert, the whole PATCH and
// the whole DELETE. Taken by LANDMARK, never by line number: terminal 9 owns everything above
// `if (a === "customer-capture")`, and a comment added up there must not move this boundary.
//
// The in-memory route (STUB), the dev-database read (DB) and the signed-in live call (LIVE) are
// IMPORTED from terminal 9's harness, not copied — one bundling recipe, one stub world, one login
// cache. Only the id block, the slices and the check registry are this terminal's own.
//
//   · SRC  — the route as it is on disk, comments stripped where the rule is about code
//   · STUB — the REAL route bundled with esbuild and its handlers CALLED against scripts/panel-stubs
//   · DB   — one read-only SQL statement against the dev database, scoped and limited
//   · LIVE — this terminal's own dev server (port 4410, never 4000), signed in ONCE
//
// Never: a signed-out call to a running app, a swapped id, a write to Aangan.
import { src, strip, chains, stubRoute, world, call, sql, rd, ROOT, RID, RID2 } from "../t9s10/lib.mjs";

export { src, strip, chains, stubRoute, world, call, sql, rd, ROOT, RID, RID2 };
export const ROUTE_REL = "app/api/editor/[...path]/route.ts";
export const lineOf = (i) => src.slice(0, i).split("\n").length;
const must = (i, what) => { if (i < 0) throw new Error(`t10s10: landmark not found — ${what}. Re-derive it; never let a check read an empty slice.`); return i; };

export const MY_START = must(src.indexOf('if (a === "customer-capture")'), "the customer-capture branch");
export const PATCH_START = must(src.indexOf("async function patchImpl("), "patchImpl");
export const DELETE_START = must(src.indexOf("async function deleteImpl("), "deleteImpl");
export const POSTB = src.slice(MY_START, PATCH_START);      // my POST branches
export const PATCHB = src.slice(PATCH_START, DELETE_START);
export const DELB = src.slice(DELETE_START);
export const MINE = src.slice(MY_START);
export const MC = strip(MINE), PBC = strip(POSTB), PAC = strip(PATCHB), DC = strip(DELB);
export const MY_FIRST_LINE = lineOf(MY_START);
export const count = (t, re) => (t.match(re) || []).length;

/** One POST/PATCH/DELETE branch body, from the `if (` that names it to the next sibling at the
 *  same indent. `test` is the literal text inside the if, e.g. `a === "orders" && c === "accept"`. */
export function branch(test, from = MINE) {
  const i = from.indexOf(`if (${test}`);
  if (i < 0) return "";
  const rest = from.slice(i + 4);
  const m = rest.search(/\n {4}(?:\/\/[^\n]*\n {4})*if \((?:a |path\.length)|\n {4}\/\/ ──|\n {4}return err\("unknown/);
  return from.slice(i, m < 0 ? from.length : i + 4 + m);
}

// ── THE ID BLOCK — P179001…P180000, sweep #10 terminal 10's alone ─────────────────────────────
export const ID_FLOOR = 179001, ID_CEILING = 180000;
const defs = [];
/** check(id, what, how, fn) — `fn` returns true/false, {ok,note}, or "skip: …". `file` defaults
 *  to the route; pass a 5th argument to name a different subject file. */
export const check = (id, what, how, fn, file) => defs.push({ id, what, how, fn, file });
export const SUBJECT = "`app/api/editor/[...path]/route.ts`";

export async function runAll({ ledger = false, quiet = false, only = null, allowForeign = false } = {}) {
  const seen = new Set();
  for (const d of defs) {
    if (seen.has(d.id)) throw new Error(`duplicate id ${d.id}`);
    seen.add(d.id);
    const n = Number(String(d.id).slice(1));
    if (!allowForeign && (n < ID_FLOOR || n > ID_CEILING)) throw new Error(`${d.id} is outside this terminal's block`);
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
    for (const r of rows) console.log(`| ${r.id} | ${r.file || SUBJECT} — ${esc(r.what)} | ${esc(r.how)} | ${r.mark} | ${esc(r.note)} |`);
  } else {
    const bad = rows.filter((r) => r.mark === "❌"), sk = rows.filter((r) => r.mark === "⏭");
    console.log(`\n${rows.length} checks · ${rows.length - bad.length - sk.length} ✅ · ${bad.length} ❌ · ${sk.length} ⏭`);
    if (bad.length) { console.log("failures:"); for (const b of bad) console.log(`  ${b.id}  ${b.what}${b.note ? ` — ${b.note}` : ""}`); }
  }
  return rows;
}

// ── LIVE (this terminal's port) ───────────────────────────────────────────────────────────────
export const BASE = process.env.T10_BASE || "http://127.0.0.1:4410";
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
/** One signed-in request to this terminal's dev server as French House's manager. GETs are cached. */
export async function live(path, { method = "GET", body } = {}) {
  const key = method + " " + path;
  if (method === "GET" && liveCache.has(key)) return liveCache.get(key);
  const t0 = Date.now();
  let out;
  try {
    const r = await fetch(`${BASE}/api/editor${path}`, {
      method, redirect: "manual",
      headers: { cookie: await liveCookie(), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    out = { status: r.status, json, text, ms: Date.now() - t0 };
  } catch (e) { out = { status: 0, json: null, text: String(e && e.message), ms: Date.now() - t0 }; }
  if (method === "GET") liveCache.set(key, out);
  return out;
}
export const noLive = (r) => (!r || !r.status ? "skip: this terminal's dev server did not answer" : null);
export const FRENCH_HOUSE = "00000000-0000-0000-0000-000000000001";
