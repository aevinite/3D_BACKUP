#!/usr/bin/env node
// verify:log-visibility — a route may not decide what an owner SEES by reading owner_entitlements
// by hand. It must come through lib/logVisibility.ts, and it must handle "I could not check".
//
// ── WHY THIS EXISTS, AND WHY IT DID NOT ─────────────────────────────────────────────────────────
//
// lib/logVisibility.ts was written after T9 finding F23, where /api/owner/oplog did this:
//
//     const rest = await sb.from("restaurants").select("id, name, owner_entitlements").in("id", ids);
//     for (const x of rest.data ?? []) entsById.set(x.id, mergeOwnerEntitlements(x.owner_entitlements));
//     rows = rows.filter((a) => { const ents = entsById.get(a.restaurant_id);
//                                 return !ents || ents[logKindKey(a.action)] !== false; });  // ← !ents means SHOW
//
// The read's error was never checked. A failed read leaves the map empty, `!ents` is true for every
// row, and EVERY row passes — including the kinds Aevidine had deliberately switched off. As that
// file puts it: "A visibility switch that fails OPEN is not a switch; it is a suggestion."
//
// Its own "HOW IT CANNOT COME BACK" section lists three things. Two of them are real and strong: the
// discriminated union, and `canSee()` being the only way to ask. The third read:
//
//     · `npm run verify:log-visibility` (scripts/verify-log-visibility.mjs) fails the build if any
//       route filters activity rows by reading `owner_entitlements` directly instead of coming
//       through here.
//
// …and it had NEVER BEEN WRITTEN. No file, no npm script, no commit for the path (T25, sweep #7,
// 2026-08-28). Both activity surfaces are correct today — /api/owner/oplog and the per-person
// Activity card in /api/owner/staff both go through loadLogVisibility — so nothing was broken. What
// was missing is the thing that stops the NEXT route re-introducing it, which is the whole point of
// the paragraph that promised it.
//
// Static, instant, no server and no database.
//
//   node scripts/verify-log-visibility.mjs        (npm run verify:log-visibility)
//   node scripts/verify-log-visibility.mjs --repo /path/to/other/checkout
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const ROOT = args.includes("--repo") ? args[args.indexOf("--repo") + 1]
  : join(dirname(fileURLToPath(import.meta.url)), "..");

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { console.log("  FAIL " + m); fails++; };
const read = (rel) => { const p = join(ROOT, rel); return existsSync(p) ? readFileSync(p, "utf8") : null; };
// LINE comments only — never a block-comment stripper, which eats a file at the first `/*` inside a
// regex literal (measured at 42 KB on app/api/editor/[...path]/route.ts; the guard that did it then
// reported a PASS over the very function it was checking).
const code = (s) => (s || "").split("\n").filter((l) => !/^\s*(\/\/|\*\s|\*\/|\/\*|\*$)/.test(l)).join("\n");

console.log(`\nLOG VISIBILITY · a switch that fails OPEN is not a switch — ${ROOT}\n`);

// 1 · the module still refuses to offer a permissive answer.
const lib = read("lib/logVisibility.ts");
if (!lib) bad("lib/logVisibility.ts is missing — this whole rule lived in it");
else {
  const c = code(lib);
  ok("lib/logVisibility.ts exists");
  const union = /export type LogVisibilityResult =[\s\S]{0,200}\{ ok: true[\s\S]{0,120}\{ ok: false/.test(c);
  union ? ok("loadLogVisibility still answers a discriminated union — there is no third, permissive state")
        : bad("LogVisibilityResult is no longer `{ ok: true, visibility }` | `{ ok: false, error }`. A caller could then ask a failed load a question and get an answer.");
  /return \{ ok: false/.test(c)
    ? ok("…and a failed read really does answer ok:false rather than an empty map")
    : bad("loadLogVisibility no longer returns { ok: false } on a read error — that is finding F23 exactly");
  /if \(!ents\) return false;/.test(c)
    ? ok("canSee HIDES a restaurant it has no entitlements for — the case F23 got backwards")
    : bad("canSee no longer returns false for a restaurant absent from the map. `!ents` meaning SHOW is the original fault.");
  /if \(this\.xray\) return true;/.test(c)
    ? ok("…and the admin's own session is the one thing that short-circuits it")
    : bad("the xray short-circuit is gone — the admin would now be filtered by an owner's switches");
  /readInChunks/.test(c)
    ? ok("…and the read is chunked, so PostgREST's 1,000-row cap cannot silently HIDE activity")
    : bad("loadLogVisibility no longer chunks its id list. Truncation there hides activity an owner may see, and it looks like an empty log rather than a failure.");
}

// 2 · nobody re-implements the filter.
const walk = (d, out = []) => {
  if (!existsSync(join(ROOT, d))) return out;
  for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const rel = `${d}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
};
const sources = [...walk("app"), ...walk("components")];

// WHAT COUNTS, and the narrowing matters more than the rule. My first cut flagged any file that
// mentions BOTH staff_actions and owner_entitlements — which caught app/api/editor/[...path]/route.ts,
// where the two are unrelated: it reads owner_entitlements for ONE restaurant to decide a MANAGER
// POWER, and reads staff_actions for the manager's own activity list. A guard that accuses correct
// code is the same failure as one that passes broken code.
//
// F23's shape is specific: the switches read for MANY restaurants and turned into a per-restaurant
// MAP, then used to filter rows. Reading them for one restaurant with `.eq("id", rid)` is a
// permission question and always has been. So: staff_actions, AND a MULTI-restaurant entitlements
// read, AND not going through the module.
const MANY_RESTAURANTS = /owner_entitlements[\s\S]{0,200}\.in\(\s*["'](id|restaurant_id)["']|\.in\(\s*["'](id|restaurant_id)["'][\s\S]{0,200}owner_entitlements/;
const offenders = [];
for (const rel of sources) {
  const c = code(read(rel));
  if (!/staff_actions/.test(c)) continue;
  if (!/owner_entitlements/.test(c)) continue;
  if (/loadLogVisibility/.test(c)) continue;      // it goes through the module
  if (!MANY_RESTAURANTS.test(c)) continue;        // one restaurant = a permission, not a log filter
  offenders.push(rel);
}
if (!offenders.length) ok("no route joins activity rows to owner_entitlements by hand");
else for (const f of offenders) {
  bad(`${f} reads BOTH staff_actions and owner_entitlements without going through lib/logVisibility.ts. That is finding F23's exact shape: a failed switch read leaves the map empty and every row passes, including the kinds Aevidine switched off. Use loadLogVisibility() + canSee(), and answer logVisibilityUnavailable() when it says ok:false.`);
}

// 3 · every caller HANDLES the failure, rather than reading .visibility off a maybe.
const callers = sources.filter((rel) => /loadLogVisibility/.test(code(read(rel))));
if (!callers.length) bad("nothing calls loadLogVisibility — the two activity surfaces must, or they are filtering some other way");
else ok(`${callers.length} surface(s) resolve visibility through the module`);
for (const rel of callers) {
  const c = code(read(rel));
  const handles = /\.ok\b/.test(c) || /logVisibilityUnavailable/.test(c) || /if \(!vis/.test(c);
  handles ? ok(`${rel} handles the "couldn't check" answer`)
          : bad(`${rel} calls loadLogVisibility and never looks at .ok — a failed load would be treated as a successful one, which is the fault this module exists to make impossible.`);
}

// 4 · one classifier, not two. (The per-person card and the Activity page had two copies of this,
// and only one of them was gated at all — that is why logKindOf moved into the module.)
const dupes = sources.filter((rel) => {
  const c = code(read(rel));
  return /function logKind|const logKindKey|logKindKey\s*=/.test(c);
});
if (!dupes.length) ok("only lib/logVisibility.ts classifies which switch an action rides");
else for (const f of dupes) bad(`${f} carries its own copy of "which switch does this action ride". One copy drifts; import logKindOf.`);

// 5 · the module's own promise about this guard is now true.
if (lib) {
  /verify:log-visibility/.test(lib)
    ? ok("lib/logVisibility.ts points at this guard by name, and it now exists")
    : bad("lib/logVisibility.ts no longer names this guard — a rule with nothing pointing at it is one the next person will not run");
}

console.log(fails
  ? `\n✗ verify:log-visibility — ${fails} problem(s). A visibility switch that fails OPEN is not a switch.`
  : "\n✓ verify:log-visibility — what an owner sees is decided in one place, and a switch we cannot read hides the row");
process.exit(fails ? 1 : 0);
