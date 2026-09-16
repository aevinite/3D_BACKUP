// harness.mjs — shared plumbing for T28's round-2 five hundred.
//
// ONE login per role for the whole run (scripts/sweep/login.mjs caches to disk across processes,
// because staff login is rate-limited to 5 per 5 minutes and tripping it alerts the owner's PHONE
// about his own test tooling). The admin never logs in at all — `adminHeaders()` presents the cookie
// the gate already accepts, so there are ZERO sign-in requests for it.
//
// Every row written to the database is registered with `owns()` and deleted BY ITS OWN ID at the end
// of the run, and on SIGINT/SIGTERM. Never "clean up whatever is there" — that is another terminal's
// fixture.
import { chromium } from "playwright";
import { adminHeaders, loginAs } from "../../login.mjs";
import { restoreOnExit } from "../../restore.mjs";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

export const BASE = (() => { const i = process.argv.indexOf("--base"); return i > -1 ? process.argv[i + 1] : "http://localhost:4000"; })();
export const ROOT = path.resolve(new URL("../../../..", import.meta.url).pathname);
export const FH = "00000000-0000-0000-0000-000000000001";   // My Little French House — written to
export const PP = "00000000-0000-0000-0000-000000000002";   // Pizza Palace — diagmulti's second
export const GHOST = "00000000-0000-0000-0000-0000000000ff"; // a well-formed id nothing owns

export const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch { return ""; } };
/** Comments stripped: every fix here carries a long comment quoting the code it replaced, so matching
 *  raw text would make a check pass on its own documentation.
 *
 *  ── LINE COMMENTS FIRST, AND THAT ORDER IS THE WHOLE POINT ────────────────────────────────────
 *  Written the other way round first, and it lost 1,800 characters of `lib/ownerScope.ts`. Its
 *  header line is `// Shared owner-panel auth/scope resolver for /api/owner/*.` — the `/*` inside
 *  that PATH opens a block comment as far as a naive stripper is concerned, and it then runs to the
 *  next `*&#47;` far below, swallowing the OwnerScope type itself. One check failed and said "the
 *  scope shape changed" about a file that had not changed at all.
 *
 *  That is the dangerous direction as well as the annoying one: a check asserting the ABSENCE of
 *  something inside a swallowed region would have PASSED, silently. Stripping line comments first
 *  removes the fake opener before it can be seen. */
export const code = (s) => String(s)
  .replace(/(^|[^:])\/\/.*$/gm, "$1 ")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

const env = Object.fromEntries(read(".env.local").split("\n").filter((l) => l.includes("="))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
export const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ── the rows this run created, and the settings it flipped ───────────────────────────────────────
const written = [];
const restore = [];
export const owns = (table, id) => { if (id) written.push({ table, id }); };
export const undo = (fn, what) => restore.push({ fn, what });
let cleaned = false;
export async function cleanup() {
  if (cleaned) return; cleaned = true;
  for (const r of restore.reverse()) {
    try { await r.fn(); } catch (e) { console.log(`  !! could not restore ${r.what}: ${(e && e.message) || e}`); }
  }
  for (const w of written) {
    const d = await sb.from(w.table).delete().eq("id", w.id);
    if (d.error) console.log(`  !! could not delete ${w.table}/${w.id}: ${d.error.message}`);
  }
  if (written.length || restore.length) console.log(`  · cleaned ${written.length} row(s) by id, restored ${restore.length} setting(s)`);
}
// ── ONE RESTORE MECHANISM IN THIS REPO, AND IT IS NOT THIS FILE'S OWN (2026-09-16) ──────────────
// This wired `process.on("SIGINT" | "SIGTERM")` by hand. `scripts/sweep/restore.mjs` already exists
// for exactly this — five guards use it — and it covers one more interruption than the hand-rolled
// version did: `uncaughtException`. A crash the run did not expect is precisely when a flipped
// setting gets left behind, so hand-rolling it was strictly worse for no gain.
//
// Registered as ONE job, so the order inside `cleanup()` is preserved: settings go back first, then
// the rows this run created are deleted by their own id. `cleaned` makes it idempotent, so a normal
// finish (which calls `cleanup()` in its own `finally`) means this job fires and does nothing.
restoreOnExit("T28 round 2 — the settings this run flipped and the rows it wrote", cleanup);

// ── the callers ──────────────────────────────────────────────────────────────────────────────────
export async function contexts() {
  const browser = await chromium.launch();
  const mk = () => browser.newContext();
  const ctx = {
    browser,
    /** ADMIN super-user. No sign-in request is ever made for this one. */
    A: await browser.newContext({ extraHTTPHeaders: adminHeaders(BASE) }),
    /** nobody at all — no cookie of any kind */
    N: await mk(),
  };
  ctx.O = await mk(); await loginAs(ctx.O, "owner", BASE);             // diago1 — owns French House
  ctx.M = await mk(); await loginAs(ctx.M, "ownerMulti", BASE);        // diagmulti — owns FH + Pizza Palace
  ctx.G = await mk(); await loginAs(ctx.G, "manager", BASE);           // diagm1 — a MANAGER, not an owner
  ctx.K = await mk(); await loginAs(ctx.K, "kitchen", BASE);           // a kitchen login — an owner route must refuse it
  return ctx;
}

/** Two cache stamps are the same MOMENT or they are not — never the same string. A fresh compute
 *  answers JS's `…Z`, the stored row answers Postgres's `…+00:00`, and comparing the text reports a
 *  cache miss on the first open of every key. */
export const sameStamp = (a, b) => !!a && !!b && Date.parse(a) === Date.parse(b);

export const T = 180_000;
export async function hit(ctx, method, urlPath, opts = {}) {
  const url = urlPath.startsWith("http") ? urlPath : BASE + urlPath;
  const r = await ctx.request.fetch(url, { method, timeout: T, ...opts });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch { /* not json */ }
  return { status: r.status(), j, txt, headers: r.headers() };
}
export const GET = (c, p, o) => hit(c, "GET", p, o);
export const POST = (c, p, data, o) => hit(c, "POST", p, { data, ...o });
export const PATCH = (c, p, data, o) => hit(c, "PATCH", p, { data, ...o });
export const DEL = (c, p, o) => hit(c, "DELETE", p, o);

// ── the rows ─────────────────────────────────────────────────────────────────────────────────────
// Auto-numbered in declaration order from each block's first id. Typed ids are how a generated band
// ends up with two of the same number; INDEX.md records six collisions and 3,005 overrun rows.
export function block(first, name) {
  const rows = [];
  const ids = Array.isArray(first) ? first.slice() : null;   // a split block: an explicit id list
  let n = 0;
  const nextId = () => (ids ? ids[n++] : `P${first + n++}`);
  const row = (claim, how, fn) => { rows.push({ id: nextId(), claim, how, fn, block: name }); };
  return { rows, row, name };
}

/** The subject file goes in EVERY claim. A row that names only its function is invisible to the
 *  by-subject count rule 2b prescribes — round 1's fifty named `normalizeIncoming` and nothing else,
 *  so the measurement read lib/aggregators.ts as having ZERO rows when it had twenty-one, and the
 *  next terminal would have re-aimed fifty checks at covered ground. */
export const of_ = (file) => (claim) => `\`${file}\` — ${claim}`;

export async function runBlocks(blocks, ctx) {
  const results = [];
  for (const b of blocks) {
    console.log(`\n── ${b.name}  (${b.rows.length} phases)`);
    for (const r of b.rows) {
      let v;
      try { v = await r.fn(ctx); } catch (e) { v = `threw: ${(e && e.message) || e}`; }
      const pass = v === true;
      const skip = typeof v === "string" && v.startsWith("SKIP:");
      results.push({ id: r.id, block: b.name, claim: r.claim, how: r.how,
        result: skip ? "⏭" : pass ? "✅" : "❌", why: pass ? "" : String(v).replace(/^SKIP:\s*/, "") });
      if (pass) process.stdout.write(".");
      else if (skip) process.stdout.write("⏭");
      else process.stdout.write(`\n  ❌ ${r.id} ${r.claim}\n     → ${v}\n`);
    }
  }
  return results;
}

export function report(results, label) {
  const bad = results.filter((r) => r.result === "❌");
  const skipped = results.filter((r) => r.result === "⏭");
  console.log(`\n\n${label}: ${results.length} phases · ✅ ${results.length - bad.length - skipped.length} · ❌ ${bad.length} · ⏭ ${skipped.length}`);
  for (const r of bad) console.log(`  FAIL ${r.id} [${r.block}] ${r.claim}\n       → ${r.why}`);
  for (const r of skipped) console.log(`  SKIP ${r.id} ${r.claim} → ${r.why}`);
  try {
    fs.mkdirSync(path.join(ROOT, "node_modules/.cache"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, "node_modules/.cache/t28-r2-results.json"), JSON.stringify(results, null, 1));
  } catch { /* the console output is the real result */ }
  return bad.length;
}

/** Nothing answering is not a fault — say so and exit 2, never a stack trace that reads like a bug. */
export async function requireServer() {
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.log(`\nNothing is answering at ${BASE}, so these phases cannot run.`);
    console.log("  · start it:  npm run dev        (it serves on 4000)");
    console.log(`  · or:        -- --base <url>    (${(e && e.message) || e})`);
    console.log("\nThis is NOT a fault in the app and NOT a fault in this suite — nothing was checked.");
    process.exit(2);
  }
}
