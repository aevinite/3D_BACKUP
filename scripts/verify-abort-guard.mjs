#!/usr/bin/env node
// verify:abort-guard — a browser-side deadline is ASKED FOR, never assumed.
//
// ── WHY THIS EXISTS (T25 sweep, 2026-08-21) ──────────────────────────────────────────────────────
//
// READING `AbortSignal.timeout` THROWS on a browser that does not have it. Not calling it —
// reading it. So the innocent-looking line
//
//     signal: init?.signal ?? AbortSignal.timeout(15000)
//
// does not "skip the timeout" on an old phone; it throws a TypeError out of whatever was about to
// make the request.
//
// This repo learned that FIVE separate times and wrote it down each time — lib/menu.ts
// (`orderDeadline`), lib/guestOutbox.ts (`sendDeadline`), lib/session.ts (its `rpc` helper),
// public/panels/outbox.js and public/panels/issue-raise.js all feature-test the API before
// touching it. `public/panels/outbox.js` says it in as many words: *"READING AbortSignal.timeout
// throws on some older phones."*
//
// And then the ONE file every browser database read goes through — lib/supabase.ts, the shared
// anon client — did it unguarded anyway. Measured on the sweep branch with the getter made to
// throw (which is what a browser lacking the API does): a guest's DISH PAGE rendered 17 characters
// of text instead of 627, ZERO of the normal 23 Supabase REST requests were made, and the getter
// was hit 42 times in a single page view. The settings/features read, the ban check, ratings,
// reviews and every session RPC — join a table, the shared cart, call a waiter, place the order —
// were all dead. The dish GRID still drew, because it comes from `/api/r/<slug>/menu-data` (a
// plain fetch), which is exactly what kept it invisible.
//
// `AbortSignal.timeout` shipped in Chrome 103, Safari 15.4 and Firefox 100 — all 2022. The five
// guards exist because that population is real on a restaurant floor.
//
// ── THE RULE ─────────────────────────────────────────────────────────────────────────────────────
//
// In any file that can reach a BROWSER, every `AbortSignal.timeout(` call must be matched by a
// `typeof AbortSignal.timeout === "function"` feature test in the same file. One guard per call.
//
// A file is SERVER-ONLY, and therefore exempt, when it reads a non-`NEXT_PUBLIC_` environment
// variable or imports the service-role client — both of which mean it cannot run in a browser at
// all. Node has had the API since v17.3, so the server is never the risk.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const SCAN_DIRS = ["lib", "components", "app", "public/panels"];
const EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx"];

// The call, and the feature test that makes it safe. Both deliberately loose about spacing and
// quote style so a reformat cannot turn a guarded call into an unguarded-looking one.
const CALL = /AbortSignal\s*\.\s*timeout\s*\(/g;
const GUARD = /typeof\s+AbortSignal\s*\.\s*timeout\s*===\s*["']function["']/g;

// "This file cannot run in a browser." A non-public env var is the honest signal: Next.js only
// inlines NEXT_PUBLIC_*, so anything else is `undefined` in a bundle and the file is server code.
const SERVER_ENV = /process\.env\.(?!NEXT_PUBLIC_)[A-Z0-9_]+/;
// An actual IMPORT of the service-role client — not a mention of it.
//
// ⚠️ THIS MUST BE MEASURED ON CODE, NEVER ON COMMENTS, and the first cut of this guard got it
// wrong in the most embarrassing possible way: `/supabaseAdmin/` matched the sentence
// "the same rule lib/supabaseAdmin.ts follows" in lib/supabase.ts's own header, so the guard
// exempted the exact file it was written for and printed a green tick over the live fault. A guard
// that invents a PASS is worse than no guard. Hence stripComments() below, and hence an import
// shape rather than a bare word.
const SERVICE_ROLE_IMPORT = /(?:import|require)[^;\n]*["'][^"']*(?:supabaseAdmin|lib\/alerts)["']/;

/**
 * Source with LINE comments blanked — and DELIBERATELY NOT block comments.
 *
 * ⚠️ A NAIVE `/\*[\s\S]*?\*\/` STRIPPER SILENTLY EATS THE FILE. Measured on
 * app/api/editor/[...path]/route.ts: 412,233 chars in, 370,262 out — 42 KB gone, including the whole
 * of `canDeleteBill()`, because a `/*` inside a regex literal or a string pairs with a `*\/` tens of
 * thousands of characters later. A guard that cannot see the code it is checking reports a PASS, and
 * a guard that invents a pass is worse than no guard at all.
 *
 * Line comments are enough: every explanatory note in this repo's own style is `//`, and the
 * `[^:\\]` guard keeps a `//` inside a URL intact.
 */
function stripComments(src) {
  return src.replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ");
}

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXTS.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
const bad = [];
let guardedFiles = 0;
let scanned = 0;

for (const file of files) {
  // Every decision below is made on CODE, never on comments — see the note on SERVICE_ROLE_IMPORT.
  const code = stripComments(readFileSync(file, "utf8"));
  const calls = (code.match(CALL) || []).length;
  if (!calls) continue;
  scanned++;
  const rel = relative(ROOT, file);
  // Server-only files are exempt — Node has had the API since v17.3.
  if (SERVER_ENV.test(code) || SERVICE_ROLE_IMPORT.test(code)) continue;
  const guards = (code.match(GUARD) || []).length;
  if (guards >= calls) { guardedFiles++; continue; }
  bad.push({ rel, calls, guards });
}

if (bad.length) {
  console.log(`\n✗ ${bad.length} browser-reachable file(s) evaluate AbortSignal.timeout without a feature test:\n`);
  for (const b of bad) {
    console.log(`  ${b.rel} — ${b.calls} call(s), ${b.guards} guard(s)`);
  }
  console.log(`
READING AbortSignal.timeout throws on a browser that lacks it, so the line above does not skip the
deadline — it throws out of the request. Wrap it the way lib/supabase.ts, lib/menu.ts,
lib/session.ts, lib/guestOutbox.ts and public/panels/outbox.js already do:

    function deadline() {
      try {
        return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(MS)
          : undefined;
      } catch { return undefined; }
    }

A device without the API then gets NO deadline, which is the behaviour it had before the deadline
existed — a slow read, not a dead one. A protection must never be the thing that breaks.
`);
  process.exit(1);
}

// ── AND EVERY fetch IN lib/ HAS A CEILING AT ALL (owner picked item 18, 2026-08-30) ──────────────
//
// Everything above is about a deadline being asked for SAFELY. This is the other half: five reads in
// lib/ had no deadline of any kind, so a request that never came back left a spinner turning for
// ever — the admin console's one safe fetch wrapper, the owner Dashboard's overview, the three reads
// a statement is assembled from, and the `/api/rt-config` fallback that decides whether live updates
// exist at all.
//
// MEASURED rather than argued: against a server that accepts the request and never answers, a fetch
// carrying `deadline(400)` gave up in 404ms as a TimeoutError; the same fetch without one was still
// waiting when the test gave up at 1,200ms.
//
// A `keepalive: true` beacon is exempt and named as such — nothing waits on one, and a deadline on a
// fire-and-forget ping would be a ceiling on something with no floor.
{
  const libDir = join(ROOT, "lib");
  const bare = [];
  for (const f of readdirSync(libDir).filter((n) => /\.tsx?$/.test(n))) {
    const src = readFileSync(join(libDir, f), "utf8");
    // Line comments dropped so a fetch QUOTED in prose is not counted. Never a block-comment
    // stripper — a `/*` inside a regex literal pairs with a `*/` thousands of characters later.
    const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*\s|\*\/|\/\*|\*$)/.test(l)).join("\n");
    for (const m of code.matchAll(/fetch\(/g)) {
      // Walk the call by paren-matching, so a wrapped argument list is seen whole.
      let i = code.indexOf("(", m.index), depth = 0, j = i;
      for (; j < code.length; j++) {
        if (code[j] === "(") depth++;
        else if (code[j] === ")") { depth--; if (!depth) break; }
      }
      const call = code.slice(m.index, j + 1);
      if (/signal|AbortSignal|deadline\(/.test(call)) continue;
      if (/keepalive:\s*true/.test(call)) continue;     // a beacon: nothing awaits it
      bare.push(`lib/${f}: ${call.replace(/\s+/g, " ").slice(0, 74)}…`);
    }
  }
  if (bare.length) {
    console.log(`\n✗ verify:abort-guard — ${bare.length} fetch(es) in lib/ have no deadline at all:\n`);
    for (const b of bare) console.log("  · " + b);
    console.log(`
A read with no ceiling is a spinner that never stops. Use the shared, feature-guarded helper — it is
in lib/partialRead.ts, which has NO IMPORTS on purpose so a "use client" screen can hold it:

    import { deadline, isDeadline, TOOK_TOO_LONG } from "@/lib/partialRead";
    const r = await fetch(url, { ...opts, signal: opts?.signal ?? deadline(30_000) });

…and tell a deadline apart from a refusal when you report it: saying "Network error" for a read that
left the device perfectly well sends a person to look at their wifi for nothing.
`);
    process.exit(1);
  }
  console.log(`  every fetch in lib/ carries a deadline (or is a keepalive beacon)`);
}

// NOTHING TO CHECK IS A FAILURE, NOT A PASS (sweep #7 / T28, 2026-08-27). This guard finds its own
// subjects by walking a folder. Rename the folder, change the naming convention, or run it from the
// wrong place and the walk returns an EMPTY list — every check then passes because none of them ran,
// and the line above says OK. That is the exact shape verify:cache died in for a month. The floor is
// deliberately well below today's real count, so it never has to be edited when the app grows.
if (files.length < 200) {
  console.log(`\n✗ verify:abort-guard scanned only ${files.length} file(s) — it should see hundreds. Its walk found nothing, so nothing was checked.`);
  process.exit(1);
}
console.log(`✓ verify:abort-guard — ${scanned} file(s) use AbortSignal.timeout; every browser-reachable one (${guardedFiles}) feature-tests it first`);
