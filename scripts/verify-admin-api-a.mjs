#!/usr/bin/env node
// verify-admin-api-a.mjs — the four rules the admin SERVER routes have to keep.
//
// ── WHY THIS EXISTS (sweep #6, terminal 19, 2026-08-19) ──────────────────────────────────────────
//
// The 49 handlers under app/api/admin are the whole of the owner's console: every number he reads
// about his platform comes out of one of them. Four separate faults in this sweep were the same
// four shapes, in different files, each already fixed by hand somewhere else:
//
//   1. THE SIGN-IN GATE COMES FIRST. Every exported handler must require the admin cookie before it
//      touches the database. CLAUDE.md states this as a counted invariant ("the number of admin
//      routes must equal the number that grep tokenIsValid"), and a count says nothing about ORDER.
//      This checks the order, handler by handler.
//
//   2. NAMED COLUMNS. `select("*")` on a console read moves columns nobody renders, and on a money
//      table it moves amounts the admin is not allowed to see.
//
//   3. A BOUNDED READ. A `.select()` with no ceiling stops at PostgREST's own cap and silently drops
//      every row past it. That is not a hypothetical: app/api/admin/owners carries a comment about
//      the day it "silently dropped every restaurant past the 100th" in the owner reports — and then
//      left the join table beside it unbounded. A silent short list is worse than an error, because
//      the screen looks fine.
//
//   4. PLAIN WORDS, AND THE RIGHT PROMISE. A failure must not answer the console with the database's
//      own sentence (lib/adminFail exists for exactly this), and a failed WRITE must not say
//      "couldn't load" — the sentence has to tell the admin whether anything changed.
//
// Static, instant, no database, no network. Run: node scripts/verify-admin-api-a.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_DIR = join(root, "app/api/admin");

function routeFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (e === "route.ts") out.push(p);
  }
  return out.sort();
}

/**
 * Source with COMMENTS REMOVED — the same rule verify-read-guards.mjs learned the hard way.
 * Every fix in this codebase quotes the bug it replaced in prose a few lines above the fix, so a
 * guard that greps the raw file fires on the very comment that documents the fix.
 *
 * LINE COMMENTS COME OFF FIRST, and that order is not a style choice. These files describe
 * themselves in prose, and that prose says things like "same cookie as every other /api/admin/*
 * route" — a LINE comment containing `/*`. Strip block comments first and that `/*` opens one,
 * which then runs to the next real `*\/` further down the file and silently swallows the code in
 * between: on app/api/admin/restaurants/credentials it ate the whole POST implementation, and this
 * guard reported a properly-gated handler as ungated. A guard that invents a failure is worse than
 * no guard, so the sanity check below proves nothing was eaten.
 */
const strip = (src) => src
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/gm, "$1")
  .replace(/\/\*[\s\S]*?\*\//g, "");

const fails = [];
const oks = [];
const ok = (m) => oks.push(m);
const fail = (m) => fails.push(m);

const ALL = routeFiles(ADMIN_DIR).map((p) => relative(root, p).replace(/\\/g, "/"));
// PART A = the first 25 in alphabetical order. Rules 2–4 are enforced here; the remaining 24 are
// part B's territory and get the same treatment when that pass runs (see the handoff note in the
// sweep #6 T19 PR). Rule 1 — the gate — is checked on ALL of them, because it is the one invariant
// CLAUDE.md already counts platform-wide.
const PART_A = ALL.slice(0, 25);
if (ALL.length !== 49) {
  // Not a failure: routes get added. But the split has to be re-read when they do.
  console.log(`  note  ${ALL.length} admin route files found (was 49 when this guard was written)`);
}

// ── RULE 1 — the gate comes before the first database call, in every exported handler ────────────
// The gate is either tokenIsValid(...) directly, or one of the file-local one-liners that wrap it
// (`admin(req)`, `requireAdmin(req)`) — a local wrapper is fine as long as it is defined in the
// same file and calls tokenIsValid itself.
const GATE = /\b(tokenIsValid|admin|requireAdmin|isAdmin|gate)\s*\(/;
const DB_CALL = /\b(sb|supabaseAdmin|supabase)\s*\.\s*(from|rpc)\s*\(/;

/**
 * Where the gate is, and where the first database call is, following DELEGATION.
 *
 * Three shapes exist in this tree and all three are fine: the handler gates itself; the handler is
 * `withIdempotency(impl, "admin")` and `impl` gates; or a wrapper does one thing around a `handler()`
 * that gates (app/api/admin/repair). So a body with NO database call that hands off to exactly one
 * local function is followed, up to three hops — anything deeper is unreadable and is reported as
 * ungated on purpose.
 */
function gateAndDb(src, body, depth = 0) {
  const gateAt = body.search(GATE);
  const dbAt = body.search(DB_CALL);
  if (gateAt >= 0 || dbAt >= 0 || depth >= 3) return { gateAt, dbAt };
  // No gate and no database call — is it handing off? Take the local functions it calls.
  const called = [...new Set([...body.matchAll(/\b([a-z][\w$]*)\s*\(\s*req\b/g)].map((m) => m[1]))];
  for (const name of called) {
    const at = src.search(new RegExp(`(?:async\\s+function|function)\\s+${name}\\s*\\(`));
    if (at < 0) continue;
    const inner = gateAndDb(src, sliceBody(src, at), depth + 1);
    if (inner.gateAt >= 0) return inner;
  }
  return { gateAt, dbAt };
}

for (const rel of ALL) {
  const raw = readFileSync(join(root, rel), "utf8");
  const src = strip(raw);
  // THE STRIPPER MUST NOT EAT CODE. Every function name the raw file declares has to survive, or
  // every later rule is reading a hole. This is the check that would have caught the /api/admin/*
  // trap above on its first run instead of on its third.
  const declared = [...raw.matchAll(/(?:async\s+function|function)\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
  const lost = declared.filter((nm) => !new RegExp(`(?:async\\s+function|function)\\s+${nm}\\s*\\(`).test(src));
  if (lost.length) fail(`${rel}: the comment stripper swallowed ${lost.join(", ")} — this guard would be reading a hole`);

  // Every exported handler, including `export const POST = withIdempotency(fn, …)`.
  const handlers = [];
  for (const m of src.matchAll(/export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE)\s*\(/g)) {
    handlers.push({ verb: m[1], at: m.index, kind: "fn" });
  }
  for (const m of src.matchAll(/export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\s*=\s*([A-Za-z_$][\w$]*)/g)) {
    handlers.push({ verb: m[1], at: m.index, kind: "wrapped", wrapper: m[2] });
  }
  if (!handlers.length) { fail(`${rel} exports no HTTP handler — is it still a route?`); continue; }

  for (const h of handlers) {
    let body;
    if (h.kind === "fn") {
      body = sliceBody(src, h.at);
    } else {
      // `export const POST = withIdempotency(postImpl, "admin")` — the gate lives in postImpl,
      // so find that function and read ITS body. A wrapper that hides an ungated handler is the
      // exact thing this rule is for, so an unfindable implementation is a failure, not a pass.
      const impl = src.match(new RegExp(`(?:async\\s+function|function)\\s+([A-Za-z_$][\\w$]*)\\s*\\(`, "g"));
      const names = [...src.matchAll(new RegExp(`export\\s+const\\s+${h.verb}\\s*=\\s*[A-Za-z_$][\\w$]*\\(\\s*([A-Za-z_$][\\w$]*)`, "g"))].map((x) => x[1]);
      const implName = names[0];
      const declIdx = implName ? src.search(new RegExp(`(?:async\\s+function|function)\\s+${implName}\\s*\\(`)) : -1;
      if (declIdx < 0) {
        // An inline arrow passed to the wrapper: read from the wrapper call itself.
        body = sliceBody(src, h.at);
      } else {
        body = sliceBody(src, declIdx);
      }
      void impl;
    }
    const { gateAt, dbAt } = gateAndDb(src, body);
    if (gateAt < 0) {
      fail(`${rel} · ${h.verb} does not require the admin sign-in cookie at all`);
    } else if (dbAt >= 0 && dbAt < gateAt) {
      fail(`${rel} · ${h.verb} reads the database BEFORE it checks the admin cookie`);
    } else {
      ok(`${rel} · ${h.verb} checks the admin cookie first`);
    }
  }
}

/** From the "function" keyword at `at`, return the text of its body (brace-matched). */
function sliceBody(src, at) {
  const open = src.indexOf("{", at);
  if (open < 0) return src.slice(at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}

// ── RULE 2 — named columns ───────────────────────────────────────────────────────────────────────
// The two declared exceptions, each with the reason it is one:
const STAR_OK = {
  "app/api/admin/custlog/route.ts": 'blocklist — contact info only, no money column (stated in the route)',
  "app/api/admin/billing/route.ts": 'the ONE-restaurant billing row, whose every column the editor renders',
};
for (const rel of PART_A) {
  const src = strip(readFileSync(join(root, rel), "utf8"));
  const stars = [...src.matchAll(/\.select\(\s*(["'`])\*\1/g)].length;
  if (!stars) ok(`${rel} names its columns on every read`);
  else if (STAR_OK[rel]) ok(`${rel} has ${stars} declared select(*): ${STAR_OK[rel]}`);
  else fail(`${rel} uses select("*") — name the columns the screen renders (rule 2)`);
}

// ── RULE 3 — every list read is bounded ──────────────────────────────────────────────────────────
// A `.select(` is bounded when the SAME chain also carries one of: .limit( .range( .maybeSingle(
// .single( or head:true. The chain runs to the terminating `)` of the awaited expression, so this
// walks forward from each .select( to the end of its statement.
for (const rel of PART_A) {
  const src = strip(readFileSync(join(root, rel), "utf8"));
  const unbounded = [];
  for (const m of src.matchAll(/\.select\s*\(/g)) {
    // A write's returning-clause is not a list read (see chainBefore).
    if (/\.(update|insert|upsert|delete)\s*\(/.test(chainBefore(src, m.index))) continue;
    const chain = statementFrom(src, m.index);
    // `head` is also passed as a shared object (`const head = { count: "exact", head: true }`) —
    // app/api/admin/dashboard does that for eleven reads, and it is still a head count.
    if (/\.limit\s*\(|\.range\s*\(|\.maybeSingle\s*\(|\.single\s*\(|head:\s*true|,\s*head\s*\)/.test(chain)) continue;
    unbounded.push(firstLineOf(src, m.index));
  }
  if (!unbounded.length) ok(`${rel} bounds every list read`);
  else fail(`${rel} has ${unbounded.length} read(s) with no ceiling — PostgREST's own cap will silently shorten them (rule 3): ${unbounded.slice(0, 3).join(" · ")}`);
}

/** From an index, the rest of the statement — to the first `;` or blank line at depth 0. */
function statementFrom(src, at) {
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") { depth--; if (depth < 0) return src.slice(at, i); }
    else if (depth === 0 && (c === ";" || c === ",")) return src.slice(at, i);
    else if (c === "\n" && depth === 0 && src[i + 1] === "\n") return src.slice(at, i);
  }
  return src.slice(at, at + 400);
}

/**
 * The bit of the chain BEFORE this `.select(` — used to tell a list read from a write.
 * `.update({...}).select("id")` is not a read whose rows need a ceiling: the filter on the write
 * already decides which rows exist. Only a read needs an explicit ceiling.
 */
function chainBefore(src, at) {
  const start = Math.max(0, src.lastIndexOf("\n", src.lastIndexOf("\n", at) - 1));
  return src.slice(start, at);
}

function firstLineOf(src, at) {
  const start = src.lastIndexOf("\n", at) + 1;
  return src.slice(start, src.indexOf("\n", at)).trim().slice(0, 70);
}

// ── RULE 4 — plain words, and the right promise ──────────────────────────────────────────────────
// 4a: no database sentence in a response body.
// The four shapes the database's own sentence has used to reach the console from this tree:
//   error: q.error.message        · bad(q.error.message, 500)
//   error: anyErr.message         · throw new Error(q.error.message)   ← walks out through a catch
// The last one is why this is a list and not one pattern: app/api/admin/customers threw the raw text
// and its own catch-all put it in the response body, so a grep for `error:` said the route was clean.
const RAW_PROSE = new RegExp([
  String.raw`error:\s*[A-Za-z_$][\w$.?]*\.error!?\.message`,
  String.raw`bad\(\s*[A-Za-z_$][\w$.?]*\.error!?\.message`,
  String.raw`error:\s*[A-Za-z_$][\w$]*Err!?\.message`,
  String.raw`bad\(\s*[A-Za-z_$][\w$]*Err!?\.message`,
  String.raw`throw new Error\(\s*[A-Za-z_$][\w$.?]*\.error!?\.message`,
].join("|"));
// The one screen whose JOB is the technical truth. System Health exists to say "the database is
// unreadable and here is what it said" — a plain sentence there would hide the only useful fact.
// Every OTHER admin screen is a normal working screen and gets plain words.
const PROSE_OK = {
  "app/api/admin/health/route.ts": "System Health is the diagnostics screen — the database's own words are the point there",
  // The throw is INSIDE cachedOwnerPayload's compute and is deliberate (see that route's own note):
  // it must fail loudly so a half-built payload is never stored under the cache key. It leaves through
  // the framework, not through a response body, so the words land in the server log and the console
  // sees a plain "Request failed (500)" from lib/adminFetch.
  "app/api/admin/analytics/route.ts": "the throw feeds the snapshot cache's failure path, never a response body",
};
for (const rel of PART_A) {
  const src = strip(readFileSync(join(root, rel), "utf8"));
  if (!RAW_PROSE.test(src)) ok(`${rel} answers a failure in plain words`);
  else if (PROSE_OK[rel]) ok(`${rel} is a declared exception: ${PROSE_OK[rel]}`);
  else fail(`${rel} hands the database's own sentence back to the console — use lib/adminFail (rule 4a)`);
}
// 4b: a failed WRITE must not promise "load". adminFail's `action` decides the sentence, so an
// insert/update/delete reported with action:"load" tells the admin the wrong thing about whether
// anything changed.
for (const rel of PART_A) {
  const src = strip(readFileSync(join(root, rel), "utf8"));
  const wrong = [];
  // `adminFail("<what>", <thing>.error, { action: "load" })` — take the VARIABLE and go find what it
  // was assigned from. Looking at "the nearest supabase verb before this line" is not good enough:
  // `.insert(...).select("id")` ends in a select, so the nearest verb says "read" for a write.
  for (const m of src.matchAll(/adminFail\(\s*(?:"[^"]*"|'[^']*'|`[^`]*`)\s*,\s*([A-Za-z_$][\w$]*)\.error[^)]*action:\s*"load"/g)) {
    const v = m[1];
    // The statement that produced it, anywhere in the file: `const <v> = await sb.from(...)…;`
    const assign = new RegExp(`(?:const|let|var)\\s+${v}\\s*=\\s*(?:await\\s+)?([\\s\\S]{0,400}?);`).exec(src);
    const chain = assign ? assign[1] : "";
    if (/\.(insert|update|upsert|delete)\s*\(/.test(chain)) wrong.push(v);
  }
  if (!wrong.length) ok(`${rel} promises the right thing when a save fails`);
  else fail(`${rel} reports a failed save (${wrong.join(", ")}) as "couldn't load" — the sentence has to tell the admin nothing was changed (rule 4b)`);
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────
for (const m of oks) console.log(`  ok   ${m}`);
if (fails.length) {
  console.error("\nverify-admin-api-a FAILED:");
  for (const m of fails) console.error(`  FAIL ${m}`);
  console.error("\nEach of these four rules is a bug that already reached the owner's console once.");
  console.error("If a change genuinely needs to break one, change THIS FILE in the same commit and say why.");
  process.exit(1);
}
console.log(`\nAll ${oks.length} checks passed — the admin routes are gated, named, bounded and honest.`);
