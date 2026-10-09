// scripts/sweep/t24-fixtures.mjs — the facts sweep #8 terminal 24 measures against, gathered ONCE.
//
// Territory: app/api/editor/[...path]/route.ts lines 1 → ~3000 — the helper block, the whole GET
// handler, the write wrapper and the first POST branches.
//
// Three sources, and each check says which one it used:
//   · SRC   — the route file as it is on disk (a code-reading check)
//   · LIVE  — the running app on this terminal's own port, signed in as a real manager
//   · DB    — one read-only SQL statement against the dev database (never a write)
//
// ONE login for the whole run (scripts/sweep/login.mjs caches across processes) — the app's own
// staff-login limit is 5 per 5 minutes and tripping it pings the owner's phone about himself.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ROUTE_REL = "app/api/editor/[...path]/route.ts";

const readFile = (rel) => readFileSync(join(ROOT, rel), "utf8");

// ── THE HALF THIS TERMINAL OWNS ────────────────────────────────────────────────────────────────
// Taken by LANDMARK, never by a hard-coded line number: the file grows every week and a check
// pinned to "line 3000" starts asserting about somebody else's code the first time a comment is
// added above it. The half ends where the POST handler's `order` branch does, which is the last
// thing inside the first ~3,000 lines.
export const src = readFile(ROUTE_REL);
export const srcLines = src.split("\n");
export const GET_START = src.indexOf("export async function GET(");
export const GET_END = src.indexOf("// ── DROPPING THE FLOOR SNAPSHOT");
export const HELPERS = src.slice(0, GET_START);
export const GETBLK = src.slice(GET_START, GET_END);
export const POST_START = src.indexOf("async function postImpl(");
export const MYEND = src.indexOf('if (a === "order" && path.length === 1)');
// …down to the END of the `order` branch (its own `order_place` diary line), which is where the
// first ~3,000 lines of this file stop. A landmark, not a line number — see the note above.
// The landmark is the ACTION NAME, not the call shape. It used to be `await log("editor",
// "order_place"`, and on 2026-09-17 "Send to kitchen" started writing that line inside a
// Promise.all with no `await` of its own — indexOf() then answered -1, the slice collapsed to
// nothing, and every POST row read an empty string and went red for a reason that had nothing to
// do with the route (found by sweep #10 T9). A missing landmark now THROWS, so it can never again
// pass as "the code is gone".
// …and the END is the start of the NEXT branch, not the diary line: on 2026-09-17 that line also
// moved UP, above the quick-order discount block, so ending the slice there cut the discount
// rules out of it and fifteen rows about them went red over code that was still there.
const ORDER_END_AT = MYEND > POST_START ? src.indexOf('if (a === "parcel" && path.length === 1)', MYEND) : -1;
if (ORDER_END_AT < 0 || src.indexOf('"order_place"', MYEND) < 0 || src.indexOf('"order_place"', MYEND) > ORDER_END_AT)
  throw new Error("t24-fixtures: the order branch is not where this slice expects it — re-derive the landmark, do not let the POST rows read an empty slice");
export const POSTBLK_A = src.slice(POST_START, ORDER_END_AT);
export const MINE = src.slice(0, GET_END) + POSTBLK_A;

export const panel = readFile("public/panels/editor/app.js");
export const billdoc = readFile("public/panels/billdoc.js");

/** The whole fluent chain that starts at `sb.from(` — taken by bracket matching, so a `.eq()`
 *  wrapped three lines down still counts as part of the same statement. This is the shape a
 *  previous sweep got wrong by using a fixed character window, which silently borrowed the NEXT
 *  read's `.limit()` and passed over a real one. */
export function chains(text) {
  const out = [];
  const re = /sb\s*\n?\s*\.?from\(/g;
  let m;
  while ((m = re.exec(text))) {
    let d = 0, j = m.index + m[0].length - 1;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === "(") d++;
      else if (c === ")") {
        d--;
        if (d === 0) {
          let k = j + 1;
          while (k < text.length && /\s/.test(text[k])) k++;
          if (text[k] === ".") continue;
          break;
        }
      }
    }
    const chain = text.slice(m.index, j + 1);
    out.push({ line: text.slice(0, m.index).split("\n").length, chain, flat: chain.replace(/\s+/g, " ") });
  }
  return out;
}

/** The body of one GET endpoint — from its `if (p === "<name>")` to the next endpoint test. */
export function endpointBlock(name) {
  const starts = [
    `if (p === "${name}")`,
    `if (path[0] === "${name}"`,
  ];
  let i = -1;
  for (const s of starts) { i = GETBLK.indexOf(s); if (i >= 0) break; }
  if (i < 0) return "";
  const nexts = [...GETBLK.matchAll(/\n {4}(?:\/\/[^\n]*\n {4})*if \((?:p === "|path\[0\] === ")/g)]
    .map((m) => m.index).filter((x) => x > i + 10);
  const end = nexts.length ? Math.min(...nexts) : GETBLK.indexOf('return err("unknown GET endpoint"');
  return GETBLK.slice(i, end > i ? end : GETBLK.length);
}

// ── LIVE ───────────────────────────────────────────────────────────────────────────────────────
export const BASE = process.env.T24_BASE || "http://127.0.0.1:4324";
let cookieHeader = null;

export async function managerCookies() {
  if (cookieHeader) return cookieHeader;
  const { chromium } = await import("playwright");
  const { loginAs } = await import("./login.mjs");
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    await loginAs(ctx, "manager", BASE);
    const cs = await ctx.cookies();
    cookieHeader = cs.map((c) => `${c.name}=${c.value}`).join("; ");
  } finally { await browser.close(); }
  return cookieHeader;
}

/** GET one editor endpoint as the signed-in manager. Returns { status, json, text, ms }. */
export async function api(path, opts = {}) {
  const headers = { cookie: opts.anon ? "" : await managerCookies() };
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/editor${path}`, { headers, redirect: "manual" });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, ms: Date.now() - t0, headers: r.headers };
}

// ── DB (read-only) ─────────────────────────────────────────────────────────────────────────────
const parseEnv = (t) => Object.fromEntries(t.split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const env = parseEnv(readFile(".env.local"));
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

// The restaurant this terminal reads. French House is the one that is written to; Aangan is the
// READ-ONLY control at factory defaults and is never touched here.
export const FRENCH_HOUSE = "00000000-0000-0000-0000-000000000001";

// ── THE LIVE FIXTURES, fetched ONCE for the whole run ──────────────────────────────────────────
// Every check that says "drive it live" reads from here. One request per path, per run — a sweep
// that re-fetches per check is a sweep that hammers its own dev server and the shared database.
export const L = {};
export const PATHS = {
  whoami: "/whoami", all: "/all", orders: "/orders", ordersBills: "/orders?bills=1",
  ordersTable: "/orders?table=1", ordersHistBill: "/orders?history=1&q=1&type=bill",
  ordersHistInv: "/orders?history=1&q=INV/2025-26/000001&type=inv",
  ordersHistAny: "/orders?history=1&q=1&type=any", ordersHistDate: "/orders?history=1&q=not-a-date&type=date",
  ordersHistDateOk: "/orders?history=1&q=2026-09-01&type=date",
  ordersHistCust: "/orders?history=1&q=zzzznobody&type=cust",
  ordersHistTable: "/orders?history=1&q=1&type=table",
  calls: "/calls", callsTable: "/calls?table=1", issues: "/issues", platform: "/platform",
  zreport: "/zreport", gst: "/gst-report", gstBad: "/gst-report?month=banana",
  gstMonth: "/gst-report?month=2026-08", summary: "/summary",
  summaryTable: "/summary?table=1", summaryBadTable: "/summary?table=abc", sessions: "/sessions",
  sessionsTable: "/sessions?table=1",
  stats: "/stats", statsYest: "/stats?range=yesterday", statsYear: "/stats?range=year",
  users: "/users", oplog: "/oplog", audit: "/audit", auditBadId: "/audit?detail=abc",
  auditLimit: "/audit?limit=999", auditLimit0: "/audit?limit=0", risk: "/staff-risk",
  riskYear: "/staff-risk?range=year", riskYest: "/staff-risk?range=yesterday",
  khata: "/khata", khataCust: "/khata/customers?q=", khataCustQ: "/khata/customers?q=a",
  onhouse: "/onhouse", onhouseDays: "/onhouse?days=99999", onhouseZero: "/onhouse?days=0",
  bqItems: "/banquet/items", bqBills: "/banquet/bills", bqBillsQ: "/banquet/bills?q=a",
  bqBillNone: "/banquet/bill", bqBillGhost: "/banquet/bill?id=00000000-0000-0000-0000-0000000000ff",
  custSearch: "/customer-search?q=987", custSearchShort: "/customer-search?q=9",
  custRecogNone: "/customer-recognize", custRecog: "/customer-recognize?phone=9999999999",
  sections: "/table-sections", pending: "/print-jobs/pending",
  printing: "/printing", printingState: "/printing/state",
  printJobGhost: "/print-jobs/00000000-0000-0000-0000-0000000000ff",
  unknown: "/no-such-endpoint-here",
};
// Every endpoint in this half, in the shape a signed-OUT caller would reach it.
export const ALL_GET_PATHS = [
  "/customer-recognize", "/table-sections", "/customer-search", "/whoami", "/banquet/items",
  "/banquet/bills", "/banquet/bill", "/khata", "/khata/customers", "/onhouse", "/all", "/ratings",
  "/orders", "/calls", "/issues", "/platform", "/zreport", "/gst-report", "/summary",
  "/print-jobs/pending", "/printing", "/printing/state", "/sessions", "/stats", "/users",
  "/oplog", "/staff-risk", "/audit",
];
export const ANON = {};
// ── SIGNED-OUT IS DRIVEN IN MEMORY, NEVER AGAINST A RUNNING APP (sweep #10 T9, 2026-10-09) ────
// Sweep #8 asked the dev server each of these paths with no cookie. The sweep-#10 rules forbid
// calling an endpoint without a login to see what happens, so the same question is now asked of
// the REAL route, bundled with esbuild exactly the way verify:t25-writes and verify:manager-gates
// bundle it, with the auth stub answering "nobody is signed in". The handler, gate() and every
// branch run for real; no socket is opened and no request leaves this process.
async function anonViaStub(paths) {
  const { execFileSync } = await import("node:child_process");
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const req_ = createRequire(import.meta.url);
  const out = join(ROOT, "node_modules/.cache/t24-anon-route.cjs");
  const prev = {
    u: process.env.NEXT_PUBLIC_SUPABASE_URL, a: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, s: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:9/stub";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "stub-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "stub-service-key";
  execFileSync("npx", ["esbuild", ROUTE_REL, "--bundle", "--platform=node", "--format=cjs", "--alias:@=.",
    "--alias:@/lib/supabaseAdmin=./scripts/panel-stubs/sb.mjs",
    "--alias:@/lib/userAuth=./scripts/panel-stubs/userAuth.mjs",
    "--alias:@/lib/oplog=./scripts/panel-stubs/oplog.mjs",
    "--external:next/server", "--external:next/cache", "--external:next/headers",
    `--outfile=${out}`, "--log-level=warning"], { cwd: ROOT });
  const { G, resetWorld } = await import(pathToFileURL(join(ROOT, "scripts/panel-stubs/state.mjs")).href);
  const { NextRequest } = req_("next/server");
  const route = req_(out);
  for (const p of paths) {
    resetWorld();
    G.ACTOR = { ok: false, transient: false };
    const r = await route.GET(new NextRequest(`http://localhost/api/editor${p}`),
      { params: Promise.resolve({ path: p.replace(/^\//, "").split("/") }) });
    // `reads` = how many database trips the handler made before answering — must be zero.
    ANON[p] = { status: r.status, text: await r.text(), reads: G.READS.length + G.RPCS.length };
  }
  if (prev.u === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (prev.a === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (prev.s === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}
export async function warmLive() {
  for (const [k, p] of Object.entries(PATHS)) {
    try { L[k] = await api(p); } catch (e) { L[k] = { status: 0, json: null, text: String(e && e.message) }; }
  }
  try { await anonViaStub(ALL_GET_PATHS); }
  catch (e) { for (const p of ALL_GET_PATHS) ANON[p] = { status: 0, json: null, text: String(e && e.message) }; }
  try { L.ratings = await api("/ratings"); } catch { L.ratings = { status: 0 }; }
}
export const live = (k) => (L[k] && L[k].status ? L[k] : null);
export const needLive = (k) => (live(k) ? null : "skip: this terminal's dev server did not answer on T24_BASE");
export const J = (k) => (live(k) ? live(k).json : null);
