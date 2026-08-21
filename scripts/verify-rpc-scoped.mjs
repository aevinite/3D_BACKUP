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
// WHY NOT JUST REMOVE THE DEFAULTS? Because PostgreSQL cannot change a parameter default in place —
// there is no `ALTER FUNCTION … SET DEFAULT`. Removing them means `CREATE OR REPLACE` on all 25,
// i.e. re-stating the full body of 25 live functions that price orders, hand out bill numbers and
// decide permissions. Re-typing that to defend against a hypothetical is a far bigger risk than the
// trap itself, and this sweep already reverted five function bodies once by re-running an old
// migration. So the defaults stay and the CALL SITES are what gets checked — which is the thing that
// actually decides whether a wrong restaurant is ever asked for.
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
const takesRid = new Set(), hasDefault = new Set();
for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(MIG, f), "utf8");
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?\s*\(([\s\S]*?)\)\s*RETURNS/gi)) {
    const name = m[1].toLowerCase(), args = m[2];
    if (!/p_restaurant_id/i.test(args)) continue;
    takesRid.add(name);
    if (/p_restaurant_id[^,)]*\bDEFAULT\b/i.test(args)) hasDefault.add(name);
  }
}

// ── 2. every .rpc() call site in the repo ───────────────────────────────────────────────────
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", ".claude"]);
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

console.log("\nEvery call to a restaurant-scoped RPC names its restaurant");
console.log(`  ${takesRid.size} RPCs take a restaurant (${hasDefault.size} of them still default it to #1); ${checked} call sites checked`);
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
