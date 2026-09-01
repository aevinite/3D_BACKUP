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
// ── THE SPLIT IS GONE: RULES 2–4 NOW WATCH EVERY ADMIN ROUTE (T20 sweep #7, 2026-08-27) ──────────
// This guard used to run rules 2–4 over `ALL.slice(0, 25)` only, with the note "the remaining 24 are
// part B's territory and get the same treatment when that pass runs". That is this pass, and there is
// no reason for the boundary to survive it: a half-watched tree is how the same four shapes came back
// in a second file, which is the whole reason the guard exists.
//
// Two things fall out of dropping it, and both matter more than the tidiness:
//   · `head -25` + `tail -24` over a list that GREW to 50 left position 26 watched by nobody — the
//     exact hole LEDGER/INDEX.md records as a boundary rule ("head -N / tail -M must add up to the
//     whole list"). Deriving from `ALL` cannot leave a hole.
//   · a route added tomorrow is covered the day it lands, instead of at the next sweep.
const PART_A = ALL;
console.log(`  note  rules 2–4 cover all ${ALL.length} admin route files (they covered the first 25 until 2026-08-27)`);

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
  // …but only functions the file really DECLARES. These files describe themselves in prose, and
  // that prose says things like "enforced here AND in the SQL function admin_purge_restaurant
  // (mig 128)" — a comment, not a declaration. Scanning the raw text found it, stripping removed it,
  // and the canary then reported the stripper as having "swallowed" code it never had (live, on
  // app/api/admin/restaurants/route.ts). So the declaration list is taken from lines that are not
  // comments; the canary still catches a runaway block comment eating real code, which is its job.
  const codeOnly = raw
    .split(/\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  const declared = [...codeOnly.matchAll(/(?:async\s+function|function)\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
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
  // ── SKIP THE PARAMETER LIST FIRST (fixed 2026-08-20) ────────────────────────────────────────
  // This took the first `{` after the declaration, which is the function body for
  // `(req: NextRequest)` — and the TYPE ANNOTATION for the catch-all routes, whose signature is
  //     export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> })
  // There the first `{` is `{ params: … }`, so the "body" came back as that type and of course
  // contained no gate. Live, this guard reported BOTH verbs of
  // app/api/admin/printing/[...path]/route.ts as having no admin cookie check at all, when both
  // check it on their very first line. A guard that invents a failure is worse than no guard — it
  // had been failing on every run, so a REAL gate regression would have arrived as more of the same
  // noise. So: walk the parameter list to its matching `)` and only then look for the body.
  const paren = src.indexOf("(", at);
  let from = at;
  if (paren >= 0) {
    let d = 0;
    for (let i = paren; i < src.length; i++) {
      if (src[i] === "(") d++;
      else if (src[i] === ")") { d--; if (d === 0) { from = i + 1; break; } }
    }
  }
  const open = src.indexOf("{", from);
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
// The declared exceptions, each with the reason it is one.
//
// custlog's was REMOVED on 2026-08-27 (T17 sweep #7, owner asked for it). Its reason —
// "contact info only, no money column" — was never the whole rule: `blocklist` holds ten
// columns and the Customers tab renders six, and two of the four it never showed were
// `unban_phone` / `unban_requested_at`, the number a banned guest leaves when asking to be let
// back in. That route now names its columns, so it must stay named: leaving a spent allowance
// behind is how a `select("*")` creeps back in under a reason nobody re-reads.
const STAR_OK = {
  "app/api/admin/billing/route.ts": 'the ONE-restaurant billing row, whose every column the editor renders',
  // ── Two more, checked line by line when rule 2 was extended to part B (T20 sweep #7, 2026-08-27) ─
  "app/api/admin/restaurants/bill-preview/route.ts":
    'the preview renders a restaurant\'s bill from its WHOLE settings row (billPreviewHtml reads header, tax, footer, paper and sign-off), and it writes nothing',
  "app/api/admin/restaurants/export/route.ts":
    'a full recovery backup IS every column of every tenant table — that is the feature; the two credential families are stripped explicitly (panelSafeSettings + the named staff_users list)',
};

/**
 * THE SETTINGS CLONE TEMPLATE — exempt by SHAPE, not by filename (T20 sweep #7, 2026-08-27).
 *
 * Seven part-B routes carry `sb.from("settings").select("*").eq("restaurant_id", DEFAULT_…)`. That is
 * not a lazy read: `settings` has 110 columns, most of them NOT NULL, and the row is handed straight
 * to `cleanClonedSettings()` so a brand-new restaurant's row satisfies every one of them. Naming 110
 * columns in seven places would be strictly worse than `*` — it would rot the first time a column is
 * added, and the symptom would be a NOT NULL violation on the admin's screen while creating a
 * restaurant.
 *
 * Matched on the shape rather than listed by name so an EIGHTH clone site is covered the day it lands,
 * while a genuinely new `select("*")` in any of those same files still fails.
 */
const CLONE_TEMPLATE = /\.from\(\s*["'`]settings["'`]\s*\)\s*\.select\(\s*["'`]\*["'`]\s*\)\s*\.eq\(\s*["'`]restaurant_id["'`]\s*,\s*DEFAULT_R(?:ESTAURANT_)?ID\s*\)/g;
for (const rel of PART_A) {
  const src = strip(readFileSync(join(root, rel), "utf8"));
  const stars = [...src.matchAll(/\.select\(\s*(["'`])\*\1/g)].length;
  const clones = [...src.matchAll(CLONE_TEMPLATE)].length;
  if (!stars) ok(`${rel} names its columns on every read`);
  else if (clones >= stars) ok(`${rel}'s ${stars} select(*) is the settings clone template (every NOT NULL column of a new restaurant's row)`);
  else if (STAR_OK[rel]) ok(`${rel} has ${stars - clones} declared select(*): ${STAR_OK[rel]}`);
  else fail(`${rel} uses select("*") on ${stars - clones} read(s) that are not the settings clone template — name the columns the screen renders (rule 2)`);
}

// ── RULE 3 — every list read is bounded ──────────────────────────────────────────────────────────
// A `.select(` is bounded when the SAME chain also carries one of: .limit( .range( .maybeSingle(
// .single( or head:true. The chain runs to the terminating `)` of the awaited expression, so this
// walks forward from each .select( to the end of its statement.
/**
 * A BUILDER HELD IN A VARIABLE (T20 sweep #7, 2026-08-27).
 *
 * `chainBefore` only sees the two physical lines above a `.select(`, so it misses the two shapes
 * part B uses, and both were reported as unbounded reads when rule 3 was extended to it:
 *
 *   let upd = sb.from("x").update({…}).eq(…);       ← a WRITE, built up over several lines
 *   if (scope) upd = upd.eq("restaurant_id", scope);
 *   const bulk = await upd.select("id");            ← its returning clause, not a list read
 *
 *   let cand = sb.from("x").select("id, detail");   ← the .select( is here…
 *   cand = reopen ? cand.not(…) : cand.is(…);
 *   const q = await cand.limit(500);                ← …and the ceiling is HERE
 *
 * So: when a `.select(` sits on `<var>.select(`, judge the whole chain by what the FILE does with
 * that variable — was it built from a write, and does it ever get a ceiling. This is the same
 * assign-then-look-back trick rule 4b already uses for `adminFail`. A guard that reports a properly
 * bounded read as unbounded is the "guard that invents a failure" this file's own header warns about.
 */
/**
 * Everything from the start of this statement up to `at` — statementFrom(), backwards.
 *
 * It has to SKIP BALANCED braces and brackets, and that is not a nicety: the chain this exists to
 * read is `sb.from(x).update(cond ? { a } : { b }).in("id", ids).select("id")`, and a scan that
 * treated the object literal's own `}` as the start of the statement stopped one line short of the
 * `.update(` — which is exactly the word it was looking for. Depth-tracked, so only an UNMATCHED
 * `{` / `(` (a real block or call boundary) ends the walk.
 */
function statementHeadFrom(src, at) {
  let curly = 0, round = 0, square = 0;
  for (let i = at - 1; i >= 0; i--) {
    const c = src[i];
    if (c === "}") curly++;
    else if (c === ")") round++;
    else if (c === "]") square++;
    else if (c === "{") { if (curly === 0) return src.slice(i + 1, at); curly--; }
    else if (c === "(") { if (round === 0) return src.slice(i + 1, at); round--; }
    else if (c === "[") { if (square === 0) return src.slice(i + 1, at); square--; }
    else if (curly || round || square) continue;
    else if (c === ";") return src.slice(i + 1, at);
    else if (c === "\n" && src[i - 1] === "\n") return src.slice(i + 1, at);
  }
  return src.slice(0, at);
}

function builderVerdict(src, at) {
  // The whole statement so far — this is what catches a chain broken over several lines, which
  // `chainBefore`'s two-line window cannot see (`sb.from(x)\n.update(…)\n.in(…)\n.select("id")`).
  const head = statementHeadFrom(src, at);
  if (/\.(update|insert|upsert|delete)\s*\(/.test(head)) return "write";

  // The variable this chain is being BUILT INTO, if any: `let cand = sb.from(…).select(…)`.
  const built = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^=]*$/.exec(head)?.[1];
  // …or the variable it is being read OFF: `await upd` + `.select("id")`. The dot belongs to the
  // `.select(` match itself, so `head` ends on the identifier.
  const off = /([A-Za-z_$][\w$]*)\s*$/.exec(head)?.[1];
  for (const v of [built, off]) {
    if (!v || v === "sb" || v === "supabaseAdmin" || v === "supabase") continue;
    const decl = new RegExp(`(?:const|let|var)\\s+${v}\\s*=\\s*([\\s\\S]{0,400}?);`).exec(src);
    if (decl && /\.(update|insert|upsert|delete)\s*\(/.test(decl[1])) return "write";
    // Any later use of the variable that adds a ceiling counts — it is the same query.
    if (new RegExp(`\\b${v}\\s*\\.\\s*(limit|range|maybeSingle|single)\\s*\\(`).test(src)) return "bounded";
  }
  return null;
}

// Some chains genuinely cannot be judged by shape. Each one is READ and given a written reason —
// never a blanket skip.
const BOUND_OK = {};

for (const rel of PART_A) {
  const src = strip(readFileSync(join(root, rel), "utf8"));
  const unbounded = [];
  for (const m of src.matchAll(/\.select\s*\(/g)) {
    // A write's returning-clause is not a list read (see chainBefore).
    if (/\.(update|insert|upsert|delete)\s*\(/.test(chainBefore(src, m.index))) continue;
    const verdict = builderVerdict(src, m.index);
    if (verdict === "write" || verdict === "bounded") continue;
    const chain = statementFrom(src, m.index);
    // `head` is also passed as a shared object (`const head = { count: "exact", head: true }`) —
    // app/api/admin/dashboard does that for eleven reads, and it is still a head count.
    if (/\.limit\s*\(|\.range\s*\(|\.maybeSingle\s*\(|\.single\s*\(|head:\s*true|,\s*head\s*\)/.test(chain)) continue;
    unbounded.push(firstLineOf(src, m.index));
  }
  if (!unbounded.length) ok(`${rel} bounds every list read`);
  else if (BOUND_OK[rel]) ok(`${rel} has ${unbounded.length} declared unbounded read(s): ${BOUND_OK[rel]}`);
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
  // ── Three more, each read line by line when rule 4a was extended to part B (T20 sweep #7,
  //    2026-08-27). None of them puts a database sentence in a TOAST; that is the thing rule 4a is
  //    about, and each of these is a different, deliberate destination. ──────────────────────────────
  "app/api/admin/restaurants/export/route.ts":
    "the words go INSIDE THE BACKUP FILE, in place of the table that failed, so whoever restores from it knows which table came back empty and why — the file's `_meta.failed` + `complete:false` are built from exactly these entries",
  "app/api/admin/restaurants/route.ts":
    "two destinations, both deliberate: the PURGE passes the SQL function's own sentence through (it raises in words a person can act on — 'already been purged', and the four known ones are translated above it), and the starter-menu seed's message becomes the `seedError` field, which is the only thing that tells the admin WHY a created restaurant has no sample menu",
  "app/api/admin/restaurants/settings/route.ts":
    "ensureCodes() returns `{ error: string }` to its own CALLER inside this file, and that caller wraps it in adminFail(...) — so the words reach `detail` and the log, which is where rule 4a wants them, and the toast gets adminFail's plain sentence",
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

// ── RULE 5 — a WRITE'S RETURNING CLAUSE MUST NOT BE COUNTED (T19 sweep #7, 2026-09-01) ──────────
//
// Rule 3 deliberately does not flag `const r = await upd.select("id")` as an unbounded list read,
// and it is right not to: that is an update's RETURNING clause, not a read. But the rows it hands
// back are still capped by PostgREST's own limit — so counting them is the same silent-short-number
// fault wearing a write's clothes. Two live examples, both fixed in the same commit as this rule:
//
//   Rate limits → "Clear all alerts": `const n = r.data?.length ?? 0` on an unbounded update, and
//   that n goes into the AUDIT LINE. Clearing 1,500 alerts would have recorded 1,000.
//   The bell's "mark all seen": the same shape, reported back to the screen.
//
// app/api/admin/error-memory already carries the pattern this rule enforces, in its own words:
// "COUNTED BEFORE, NOT COUNTED FROM WHAT CAME BACK … A head count moves no rows and cannot be
// shortened." So the rule is: if a variable is assigned from a chain containing .update( / .delete(
// / .insert( AND a .select(, then `<var>.data.length` is only allowed when the same chain carries an
// explicit ceiling (.limit / .range) or the ids it filters on were themselves capped — the second
// case is spelled out in a comment, so the allowance is named rather than guessed.
// THREE THINGS ARE DELIBERATELY NOT FLAGGED, because all three are already safe, and a guard that
// invents a failure is worse than no guard (this file's own header):
//   · a PRESENCE test — `if (!r.data?.length) return 404`. It asks "did anything match", not "how
//     many", and one row is one row whatever the cap is (app/api/admin/maintenance).
//   · a write filtered by `.in("id", ids)`. The id list is built in code and is finite: ack slices
//     it to 200, resolve-error takes it from a read capped at 500. Both are far under PostgREST's
//     own cap, so the returned rows cannot be shortened.
//   · a chain that states its own `.limit(`/`.range(`.
// What IS flagged is the dangerous shape: a FILTER-based bulk write, no ceiling, and its returned
// rows counted as the number that gets reported or recorded.
for (const rel of PART_A) {
  const src = strip(readFileSync(join(root, rel), "utf8"));
  const counted = [];
  for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\.data\??\.length/g)) {
    const v = m[1];
    // A boolean presence test, not a count: `!r.data?.length`, `r.data?.length === 0`, `? :`.
    const before = src.slice(Math.max(0, m.index - 12), m.index);
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 14);
    if (/[!(]\s*$/.test(before) && !/\?\?/.test(after)) continue;
    if (/^\s*(===|!==|==|!=|>|<)\s*0/.test(after)) continue;
    const assign = new RegExp(`(?:const|let|var)\\s+${v}\\s*=\\s*(?:await\\s+)?([\\s\\S]{0,600}?);`).exec(src);
    let chain = assign ? assign[1] : "";
    // FOLLOW THE BUILDER, the same way rule 3 had to learn to (T20 sweep #7). The dangerous shape is
    // written over several lines, so the `.update(` is not in this statement at all:
    //     let upd = sb.from("x").update({…}).eq(…).is(…);
    //     if (scope) upd = upd.eq("restaurant_id", scope);
    //     const bulk = await upd.select("id");     ← this is what `<var>.data.length` counts
    // Without this step the rule sees only `upd.select("id")`, finds no write verb, and passes the
    // very shape it exists for — which is exactly what it did on its first run.
    const viaBuilder = /^\s*([A-Za-z_$][\w$]*)\s*\.\s*select\s*\(/.exec(chain);
    if (viaBuilder) {
      const b = viaBuilder[1];
      // Every line that assigns the builder, joined — the write verb is in the first, the extra
      // filters in the later ones, and a ceiling could be in any of them.
      const parts = [...src.matchAll(new RegExp(`(?:const|let|var)?\\s*\\b${b}\\s*=\\s*([\\s\\S]{0,400}?);`, "g"))].map((x) => x[1]);
      if (parts.length) chain = chain + " " + parts.join(" ");
    }
    if (!/\.(insert|update|upsert|delete)\s*\(/.test(chain)) continue;   // a plain read — rule 3's business
    if (!/\.select\s*\(/.test(chain)) continue;                          // no returning clause to count
    if (/\.(limit|range)\s*\(/.test(chain)) continue;                    // it states its own ceiling
    if (/\.in\s*\(/.test(chain)) continue;                               // a finite id list, built in code
    counted.push(v);
  }
  if (!counted.length) ok(`${rel} never counts a write's returning rows as the number it reports`);
  else fail(`${rel} counts a write's returning rows (${counted.join(", ")}) — those stop at PostgREST's own cap, so the number can be smaller than what was changed. Count first with a head count on the same filter (rule 5)`);
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
