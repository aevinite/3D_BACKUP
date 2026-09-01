#!/usr/bin/env node
// verify:rpc-contract — every database function the app calls exists, and every argument it is
// handed is one that function declares.
//
// ── WHY THIS EXISTS (T25 round 3, sweep #7, 2026-08-31) ──────────────────────────────────────────
//
// This app talks to its database through 112 named functions and 188 call sites. `lib/session.ts`
// alone is 21 one-line wrappers around `lfh_*` RPCs — the guest's whole table-session API: join a
// table, leave it, approve a member, send an OTP, read the shared cart, call a waiter.
//
// Nothing checked that those names and arguments still line up. And the failure mode is nasty: get an
// argument name wrong and PostgREST does not say "wrong argument", it answers
//
//     Could not find the function public.lfh_join_session(p_tabel, …) in the schema cache
//
// …a 404, at runtime, on the guest's phone, with a sentence that reads like the function is missing.
// A rename in a migration and a rename in TypeScript are two separate edits, and the second one is
// the one nobody remembers on a Friday.
//
// MEASURED when this guard was written: 197 functions defined across the migrations, 188 call sites,
// 112 distinct functions — and **zero** drift. So this is a fence, not a fix: it holds a property that
// is true today and would otherwise break silently.
//
// ── WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT ────────────────────────────────────────────
//
//   1. every `.rpc("name", …)` — and every bare `rpc("name", …)` through a local wrapper — names a
//      function some migration CREATEs;
//   2. every `p_*` argument at a call site is declared by that function.
//
// It does NOT check the reverse (a required parameter nobody passes). That needs to read a call whose
// argument object is built from a variable or a spread, which cannot be done honestly from the text —
// the first attempt produced ten accusations and all ten were the parser, not the code. Better a
// narrow check that is right than a wide one that cries wolf.
//
//   node scripts/verify-rpc-contract.mjs        (npm run verify:rpc-contract)
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = join(ROOT, "supabase/migrations");

/** Split a parameter list on commas at depth 0 — never a regex. A regex without /m misses the LAST
 *  parameter whenever a comment sits before it, which is exactly how the first cut of this parser
 *  accused two correct call sites of passing an argument their function declares. */
function splitParams(raw) {
  // COMMENTS OUT FIRST, then split. A trailing `-- {id, sig} of lines this device removed` carries
  // COMMAS, so splitting first put the next parameter in the middle of a part and its name was lost —
  // which is how this guard accused lib/session.ts of passing `p_qty` to a function that declares it
  // on line 26. Third parser bug in this one file, and the only reason any of them showed up is that
  // the guard was sabotaged instead of read.
  const text = raw.replace(/--[^\n]*/g, " ");
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((t) => t.replace(/--[^\n]*/g, " ").trim()).filter(Boolean);
}

// Every CREATE FUNCTION in the migrations. They apply in filename order, so the last definition wins.
const defs = new Map();
for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(MIG, f), "utf8").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\)\s*RETURNS/gi)) {
    const args = splitParams(m[2])
      .map((t) => (t.match(/^(?:IN|OUT|INOUT|VARIADIC)?\s*(\w+)\s+\w/i) || [])[1])
      .filter(Boolean);
    defs.set(m[1], { file: f, args });
  }
}

// Every `.rpc("name", { … })` in lib/ and app/.
const calls = [];
(function walk(dir) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { walk(rel); continue; }
    if (!/\.tsx?$/.test(e.name)) continue;
    // Line comments dropped so an RPC quoted in a note is not counted as a call.
    const code = readFileSync(join(ROOT, rel), "utf8").split("\n")
      .filter((l) => !/^\s*(\/\/|\*\s|\*\/|\/\*|\*$)/.test(l)).join("\n");
    // `\.rpc(` IS NOT ENOUGH, and sabotage is how that showed up: lib/session.ts calls its own local
    // `rpc(fn, args)` wrapper — 21 of them, the guest's entire table-session API — so every one of the
    // calls this guard exists for was INVISIBLE to it. A bare `rpc("name", {…})` counts too; the
    // wrapper's own declaration cannot match, because its first argument is a parameter, not a string.
    for (const m of code.matchAll(/(?:\.|\b)rpc\(\s*["'`](\w+)["'`]\s*(?:,\s*\{([^{}]*)\})?/g)) {
      // Only a `p_…:` at the start of a property is an argument — a date string like
      // "2026-08-01T00:00:05" was being read as three of them.
      const args = [...(m[2] || "").matchAll(/(?:^|,)\s*(p_\w+)\s*:/g)].map((a) => a[1]);
      calls.push({ file: rel, fn: m[1], args });
    }
  }
})("lib");
(function walk(dir) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { walk(rel); continue; }
    if (!/\.tsx?$/.test(e.name)) continue;
    const code = readFileSync(join(ROOT, rel), "utf8").split("\n")
      .filter((l) => !/^\s*(\/\/|\*\s|\*\/|\/\*|\*$)/.test(l)).join("\n");
    // `\.rpc(` IS NOT ENOUGH, and sabotage is how that showed up: lib/session.ts calls its own local
    // `rpc(fn, args)` wrapper — 21 of them, the guest's entire table-session API — so every one of the
    // calls this guard exists for was INVISIBLE to it. A bare `rpc("name", {…})` counts too; the
    // wrapper's own declaration cannot match, because its first argument is a parameter, not a string.
    for (const m of code.matchAll(/(?:\.|\b)rpc\(\s*["'`](\w+)["'`]\s*(?:,\s*\{([^{}]*)\})?/g)) {
      const args = [...(m[2] || "").matchAll(/(?:^|,)\s*(p_\w+)\s*:/g)].map((a) => a[1]);
      calls.push({ file: rel, fn: m[1], args });
    }
  }
})("app");

// Functions that exist but are created OUTSIDE the migrations folder (a Supabase extension, or one of
// Postgres' own). Named, with the reason, so the list cannot quietly grow.
const NOT_OURS = new Set([]);

const bad = [];
for (const c of calls) {
  if (NOT_OURS.has(c.fn)) continue;
  const d = defs.get(c.fn);
  if (!d) {
    bad.push(`${c.file} calls ${c.fn}(), which no migration creates. PostgREST will answer 404 with "Could not find the function …" at runtime.`);
    continue;
  }
  const unknown = c.args.filter((a) => !d.args.includes(a));
  if (unknown.length) {
    bad.push(`${c.file} passes ${unknown.join(", ")} to ${c.fn}(), which declares ${d.args.join(", ")} (${d.file}). PostgREST answers 404, not "wrong argument".`);
  }
}

// NOTHING TO CHECK IS A FAILURE, NOT A PASS. Both halves walk folders to find their subjects; a
// rename or a wrong working directory would leave both lists empty and every check would "pass".
if (defs.size < 150 || calls.length < 120) {
  console.log(`\n✗ verify:rpc-contract found ${defs.size} function definition(s) and ${calls.length} call site(s) — it should see hundreds of each. Its walk found nothing, so nothing was checked.`);
  process.exit(1);
}

if (bad.length) {
  console.log(`\n✗ verify:rpc-contract — ${bad.length} problem(s) across ${calls.length} call sites:\n`);
  for (const b of bad) console.log("  · " + b);
  console.log(`
A renamed database argument and a renamed TypeScript key are two separate edits. When they disagree,
nothing fails at build time — it fails on a guest's phone, as a 404 that reads like the function is
missing. Fix the call, or add the migration that declares the argument.
`);
  process.exit(1);
}
console.log(`✓ verify:rpc-contract — ${calls.length} call sites across ${new Set(calls.map((c) => c.fn)).size} functions: every name exists in a migration and every argument is declared`);
