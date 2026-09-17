// verify-rpc-scoped.mjs — A CALL THAT FORGETS THE RESTAURANT MUST NOT SILENTLY MEAN FRENCH HOUSE.
//
// WHY THIS EXISTS. 25 scoped RPCs declare `p_restaurant_id uuid DEFAULT
// '00000000-…-0001'`. That default was how the tenancy migration (078 and the 080–086 series) stayed
// ADDITIVE: every existing single-restaurant caller kept working while the app was made
// tenant-aware. It was never taken away, so today a caller that forgets the argument does not fail —
// it quietly answers for, or writes into, restaurant #1.
//
// The 2026-08-21 sweep found exactly one such caller: app/api/admin/floor/route.ts asked
// `lfh_floor_state()` with no restaurant, so the admin console's single-restaurant floor branch would
// have shown FRENCH HOUSE'S TABLES whatever restaurant the admin had open. Nothing reached that
// branch (the console's only caller uses ?all=1), so nobody was shown wrong tables — it was one new
// caller away. That is the shape this file exists to stop: not a bug that is happening, a trap that
// is set.
//
// THE DEFAULTS ARE GONE NOW — AND THIS GUARD USED TO SAY OTHERWISE (T33, sweep #9, 2026-09-17).
// This header used to argue that removing them was a worse trade than the trap, and the summary
// line below used to report "25 of them still default it to #1". Both were true until 2026-09-15,
// when the owner asked for it: migration 385 removed the DEFAULT from all 22 signatures by
// DROP + CREATE, re-issuing every grant, and migration 386 replaced the same guess inside the
// bodies with `lfh_rid()`, which refuses a null instead of answering as French House.
//
// The count was wrong because of HOW it was computed, not because nobody updated a comment: the
// loop below walks EVERY migration file and adds a function to `hasDefault` the first time any
// file gives it a default — it never noticed a LATER file taking that default away. So it kept
// reporting a state the folder had left behind, on a line whose whole job is to tell the reader
// how exposed they still are. It now reads the NEWEST definition of each function, in the
// filename order the seeder itself applies, which is the technique `verify-rid-required.mjs`
// already uses for the body half of the same question. Today that number is 0.
//
// The ASSERTION has not changed and is still the point of the file: no call site may leave the
// restaurant out. That matters just as much with the defaults gone — a call that omits the
// argument now fails to resolve the function at all, which is a broken screen instead of a quiet
// wrong answer, and it should be caught here rather than in front of a guest.
//
// STATIC. Reads the migrations to learn which RPCs take a restaurant, then reads every call site.
// No database, no network, no writes.
//
//   node scripts/verify-rpc-scoped.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const pass = (m) => console.log("  ✓ " + m);
const fail = (m) => { console.log("  ✗ " + m); failed++; };

// ── 1. which RPCs declare a restaurant parameter, and which give it a default ────────────────
const MIG = join(root, "supabase", "migrations");
// LAST DEFINITION WINS, because that is what the database ends up running. The seeder applies
// these with readdirSync().sort(), so a function redefined in a later file replaces whatever an
// earlier one said about it — including whether its restaurant has a default. Recording the FIRST
// sighting instead (which this did until 2026-09-17) reports a default that migration 385 removed.
const takesRid = new Set(), hasDefault = new Set();
{
  // A DROP IS ALSO A NEWEST STATEMENT. Three retired functions — lfh_open_session (dropped by
  // migration 304) and the two verification stubs (by 267/360) — still carry the old default in
  // the last file that CREATED them, and counting those reports a guess that no longer exists to
  // make. Whichever statement about a function comes last in filename order is the one the seeder
  // leaves standing, so a later DROP removes it from this census exactly as the database does.
  const latest = new Map();               // function name → the args of its newest definition
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIG, f), "utf8");
    const events = [];
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?\s*\(([\s\S]*?)\)\s*RETURNS/gi))
      events.push([m.index, m[1].toLowerCase(), m[2]]);
    for (const m of sql.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z0-9_]+)"?/gi))
      events.push([m.index, m[1].toLowerCase(), null]);
    events.sort((a, b) => a[0] - b[0]);
    for (const [, name, args] of events) { if (args === null) latest.delete(name); else latest.set(name, args); }
  }
  for (const [name, args] of latest) {
    if (!/p_restaurant_id/i.test(args)) continue;
    takesRid.add(name);
    if (/p_restaurant_id[^,)]*\bDEFAULT\b/i.test(args)) hasDefault.add(name);
  }
}

// ── 2. every .rpc() call site in the repo ───────────────────────────────────────────────────
// `reference/` is the FROZEN SNAPSHOT of the old single-restaurant app, and it is gitignored — it
// is not shipped, not imported, and never runs. Every one of its .rpc() calls omits
// p_restaurant_id because back then there genuinely was only one restaurant, so scanning it made
// this guard permanently red on any machine that has the snapshot, for three faults that cannot
// happen. A guard that invents a failure protects nothing: people learn to ignore its red, and the
// day a REAL unscoped call appears it is one line in a list everybody skips.
// (T28, sweep #7, 2026-08-30 — found by running all 153 guards and re-running every red alone.)
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", ".claude", "reference"]);
const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    if (SKIP_DIRS.has(e) || e.startsWith(".")) continue;
    const p = join(d, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) files.push(p);
  }
})(root);

// A call site is SCOPED when p_restaurant_id appears inside its own argument object. The object is
// found by balancing braces from the first `{` after the RPC name — a fixed character window gets
// this wrong on long argument lists, which is how an earlier pass of this sweep produced four false
// positives on editor/repair routes that were correct all along.
function argObject(text, from) {
  const open = text.indexOf("{", from);
  if (open < 0 || open - from > 80) return null;      // no object argument at all
  let depth = 0;
  for (let i = open; i < text.length && i < open + 20000; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return text.slice(open, i + 1); }
  }
  return null;
}

const offenders = [];
let checked = 0;
for (const p of files) {
  if (p.endsWith("verify-rpc-scoped.mjs")) continue;   // this file names the RPCs in prose
  const t = readFileSync(p, "utf8");
  for (const m of t.matchAll(/\.rpc\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g)) {
    const fn = m[1].toLowerCase();
    if (!takesRid.has(fn)) continue;
    checked++;
    const obj = argObject(t, m.index + m[0].length);
    if (obj && /p_restaurant_id/.test(obj)) continue;
    // A call with NO object at all, on a function that defaults the restaurant, is the trap.
    const line = t.slice(0, m.index).split("\n").length;
    offenders.push(`${relative(root, p)}:${line} calls ${fn}() without p_restaurant_id`
      + (hasDefault.has(fn) ? " — it would silently mean restaurant #1" : " — and that argument has no default, so it would fail at runtime"));
  }
}

// NOTHING TO CHECK IS A FAILURE, NOT A PASS (sweep #7 / T28, 2026-08-27). This guard finds its own
// subjects by walking a folder. Rename the folder, change the naming convention, or run it from the
// wrong place and the walk returns an EMPTY list — every check then passes because none of them ran,
// and the line above says OK. That is the exact shape verify:cache died in for a month. The floor is
// deliberately well below today's real count, so it never has to be edited when the app grows.
if (takesRid.size < 20 || checked < 20) {
  console.log(`\n✗ verify:rpc-scoped read ${takesRid.size} restaurant-scoped RPC(s) out of the migrations and found ${checked} call site(s) — there are dozens of each. Nothing was checked.`);
  process.exit(1);
}
console.log("\nEvery call to a restaurant-scoped RPC names its restaurant");
console.log(`  ${takesRid.size} RPCs take a restaurant (${hasDefault.size ? hasDefault.size + " of them still default it to #1"
    : "none of them defaults it — migrations 385/386 took the guess out of the signatures AND the bodies"}); ${checked} call sites checked`);
if (offenders.length) {
  fail(`${offenders.length} call site(s) do not say which restaurant:`);
  for (const o of offenders) console.log("      · " + o);
  console.log("      Fix: pass p_restaurant_id at the call site. Never rely on the default —");
  console.log("      it is a leftover from the tenancy migration, not a decision.");
} else {
  pass(`no call site relies on the "assume restaurant #1" default`);
}

console.log(failed ? `\n✗ ${failed} check(s) failed` : "\n✓ no read or write can quietly land on the wrong restaurant");
process.exit(failed ? 1 : 0);
