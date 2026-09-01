#!/usr/bin/env node
// verify:id-chunks — a read about EVERY RESTAURANT IN AN ESTATE must chunk its id list.
//
// ── WHY (T25 sweep, 2026-08-21) ──────────────────────────────────────────────────────────────────
//
// PostgREST puts filters in the URL and caps rows silently. Both limits were MEASURED on this
// stack, not assumed:
//
//     500 ids  → 18.5 KB of id list → fine
//     800 ids  → 29.6 KB            → "Bad Request"
//   2,000 ids  → 74.0 KB            → the fetch never completes
//   a select with no .limit()       → silently capped at 1,000 rows
//
// `lib/restaurantNames.ts` already chunks at 500 with `.limit(part.length)` and its header explains
// why: *"past PostgREST's 1000-row default, every name after the thousandth silently became '—'
// (the reports route learned this one the hard way and left a comment about it; nobody else got the
// fix)"*. `lib/liveBoard.ts` learned the URL half when an inlined id list came back 414 and the
// KITCHEN BOARD WENT BLANK mid-rush.
//
// Five multi-restaurant readers in lib/ were still inlining the whole estate. They now go through
// `lib/inChunks.ts`, and this guard is what stops one of them quietly going back — because the
// failure is invisible on a small platform and silent on a big one.
//
// ── WHY THIS GUARD IS DELIBERATELY NARROW ───────────────────────────────────────────────────────
//
// The obvious guard — "flag every `.in(` in lib/ that isn't chunked" — would be WRONG, and loudly:
// `lib/printQueue.ts` passes an id list already capped at 20, `lib/printHelpers.ts` passes
// `["queued","printing"]`, `lib/liveBoard.ts` does its own chunking at 150 with its own reasoning.
// Flagging those would make this a guard nobody trusts, and a guard nobody trusts is worse than no
// guard at all (the same lesson `verify:admin-api-a` taught on 2026-08-20 by being red on clean
// main for two bugs of its own).
//
// So it checks exactly the readers whose id list is "an owner's whole estate" or "every restaurant
// the admin can see" — the ones with no natural ceiling. Add a function here when you write another.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");

// file → the functions in it whose id list is an unbounded estate.
const ESTATE_READERS = {
  "lib/panelAccess.ts": ["enabledOwnedRestaurantIds"],
  "lib/tableTags.ts": ["payrollEffectiveByRid", "inventoryEffectiveByRid"],
  "lib/ownerEntitlements.ts": ["entitledSubset", "logViewSubset", "getOwnerEntitlementsUnion"],
  "lib/logVisibility.ts": ["loadLogVisibility"],
  // Not routed through lib/inChunks because it predates it and chunks itself, at 500, with
  // `.limit(part.length)` — the shape lib/inChunks.ts was derived FROM. Checked for its own loop.
  "lib/restaurantNames.ts": ["restaurantNames"],
  // NOT an estate read, but the SAME failure mode pointed at a delete. `softDeleteOrders` decides
  // which bills to tombstone from "which of these sessions still has a live order", and a SHORT
  // answer there marks a bill deleted while its food is live — the half-state that function's own
  // header says persisted for months. It returns one row per ORDER, so it crosses the 1,000-row cap
  // sooner than an estate read does. (T25 sweep, 2026-08-21.)
  // …and `restoreOrders` beside it (T25 sweep #7, 2026-08-28), for the mirror-image reason. It is
  // the "you can restore them" promise the admin bill ledger prints, and its first read had the
  // same unchunked, error-thrown-away shape: a failed read answered `{ restored: 0 }`, which the
  // ledger renders as "nothing needed restoring" rather than "that did not work". Both functions'
  // first reads now go through lib/inChunks.ts and throw on a failed chunk.
  "lib/softDelete.ts": ["softDeleteOrders", "restoreOrders"],
};

// What counts as chunked: the shared helper, or restaurantNames' own equivalent loop.
//
// ⚠️ MATCH THE NAME, NOT A CALL SHAPE. The first cut of this guard wrote `readInChunks\s*\(` and was
// RED on a fully-fixed tree, because every real call passes a type argument —
// `readInChunks<Record<string, unknown>>(ids, …)` — so the paren is not where the regex expected it.
// A guard that accuses correct code is the same failure as one that passes broken code; check a new
// guard against the file it names before believing it.
const CHUNKED = /readInChunks|for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<\s*unique\.length;\s*i\s*\+=\s*CHUNK/;
// A raw `.in(` whose argument is NOT a chunk variable — the shape that breaks at ~800 ids.
const RAW_IN = /\.in\(\s*["'][^"']+["']\s*,\s*(?!chunk\b|part\b)([A-Za-z_$][\w$]*)/g;

/**
 * The source of one function, from its `export ... name(` to the matching close brace.
 *
 * ⚠️ IT MUST WALK PAST THE PARAMETER LIST FIRST, and the first version did not — it took
 * `src.indexOf("{", start)`, which for
 *
 *     export async function softDeleteOrders(rid, ids, meta): Promise<{ deleted: number }> {
 *
 * lands on the brace inside the RETURN TYPE. The "body" was then `{ deleted: number }`, which
 * contains no read at all, so the guard reported a correctly-chunked function as unchunked. Third
 * time a regex in one of this sweep's guards accused working code; each was caught the same way,
 * by running the guard against the file it names before believing it.
 */
function bodyOf(src, name) {
  const start = src.search(new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*[(<]`));
  if (start < 0) return null;
  // 1. paren-match the parameter list, so a `{` in the return type cannot be mistaken for the body.
  let i = src.indexOf("(", start);
  if (i < 0) return null;
  let parens = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") parens++;
    else if (src[i] === ")") { parens--; if (parens === 0) { i++; break; } }
  }
  // 2. …and then past the RETURN-TYPE ANNOTATION, because that can contain a brace too:
  //    `): Promise<{ deleted: number }> {` — the first `{` after the params is inside the generic,
  //    not the body. Track angle depth and take the first brace at depth 0. (Paren-matching alone
  //    was not enough; this was the second half of the same bug.)
  let angle = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "<") angle++;
    else if (c === ">") { if (angle > 0) angle--; }
    else if (c === "{" && angle === 0) break;
    else if (c === "=" && src[i + 1] === ">") i++;      // an arrow in a default value, not a generic
  }
  if (i >= src.length) return null;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

const bad = [];
let checked = 0;

for (const [rel, fns] of Object.entries(ESTATE_READERS)) {
  const file = join(ROOT, rel);
  if (!existsSync(file)) { bad.push(`${rel} is missing — this guard names it, so either restore it or update the list here`); continue; }
  const src = readFileSync(file, "utf8");
  for (const fn of fns) {
    const body = bodyOf(src, fn);
    if (!body) { bad.push(`${rel} → ${fn}() not found (renamed? update the list in this guard)`); continue; }
    checked++;
    if (CHUNKED.test(body)) continue;
    const raws = [...body.matchAll(RAW_IN)].map((m) => m[1]);
    bad.push(`${rel} → ${fn}() inlines its whole id list${raws.length ? `: .in(…, ${[...new Set(raws)].join(", ")})` : ""}`);
  }
}

// ── AND THE GENERAL RULE THE FOUR NAMES ABOVE ARE A SPECIAL CASE OF ────────────────────────────
//     NO TWO FILES IN lib/ MAY EXPORT THE SAME NAME. (T25, sweep #7, 2026-08-28.)
//
// The list above only protects four names somebody thought of. `hexToRgbTriplet` was exported from
// BOTH lib/accent.ts and lib/brandTheme.ts, and the two DISAGREED on a real input: brandTheme's
// checks isHexColor() first, which requires the leading `#`; accent's stripped the `#` before
// testing, so "c0392b" came back as "192, 57, 43" from one and null from the other. And
// components/AppShell.tsx imports from both files, so both answers sat in one module graph.
//
// Checked by walking lib/, so a fifth name nobody has thought of yet is covered on the day it lands.
// A RE-EXPORT is not a duplicate — `export { x } from "./y"` is one definition reached two ways, and
// this repo uses it deliberately (lib/ownerScope re-exports the partial-read words so a server route
// needs one import; lib/printHelpers re-exports PaperSize so a client page never reaches the server
// half). Only a second DEFINITION counts.
{
  const libDir = join(ROOT, "lib");
  const byName = new Map();
  for (const f of readdirSync(libDir).filter((n) => /\.tsx?$/.test(n))) {
    const rel = `lib/${f}`;
    const src = readFileSync(join(libDir, f), "utf8");
    // Line comments dropped so a name QUOTED in prose is not counted. Never a block-comment
    // stripper: a `/*` inside a regex literal pairs with a `*/` thousands of characters later.
    const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*\s|\*\/|\/\*|\*$)/.test(l)).join("\n");
    // Re-exports first, so they can be excluded rather than counted as definitions.
    const reexported = new Set([...code.matchAll(/export\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g)]
      .flatMap((m) => m[1].split(",").map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean)));
    for (const m of code.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/gm)) {
      if (reexported.has(m[1])) continue;
      if (!byName.has(m[1])) byName.set(m[1], []);
      if (!byName.get(m[1]).includes(rel)) byName.get(m[1]).push(rel);
    }
  }
  // A pair that is allowed, NAMED with its reason and re-checked below so the allowance cannot rot
  // into a hole (verify:admin-refusals' own count drifted from 2 to 3 exactly that way).
  const ALLOWED = {
    // Two unrelated things that happen to share a plain English word: the guest's order progress
    // (received → preparing → served) and the four headings of the printing board. Nothing imports
    // both, so nothing can pick the wrong one today. Renaming either would touch components and an
    // admin page that belong to other territories, so it is offered rather than taken — T25, sweep
    // #7, 2026-08-28.
    STEPS: ["lib/orderStatus.ts", "lib/printBoardWords.ts"],
  };
  const clashes = [...byName.entries()]
    .filter(([, files]) => files.length > 1)
    .filter(([name, files]) => {
      const allowed = ALLOWED[name];
      return !(allowed && allowed.length === files.length && allowed.every((f) => files.includes(f)));
    });
  // …and the allowance is only valid while the two really are unrelated: no file may import both.
  for (const [name, files] of Object.entries(ALLOWED)) {
    for (const dir of ["app", "components", "lib"]) {
      const stack = [join(ROOT, dir)];
      while (stack.length) {
        const d = stack.pop();
        let entries = [];
        try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
          if (e.name.startsWith(".") || e.name === "node_modules") continue;
          const full = join(d, e.name);
          if (e.isDirectory()) { stack.push(full); continue; }
          if (!/\.tsx?$/.test(e.name)) continue;
          const src2 = readFileSync(full, "utf8");
          const both = files.every((f) => src2.includes(f.replace(/^lib\//, "@/lib/").replace(/\.tsx?$/, "")));
          if (both) bad.push(`${full.replace(ROOT + "/", "")} imports BOTH files that export \`${name}\` — the allowance for that name was granted on the basis that nothing does. Rename one of them.`);
        }
      }
    }
  }
  for (const [name, files] of clashes) {
    bad.push(`${files.join(" and ")} each DEFINE and export \`${name}\` — one name, two answers is how the next person picks the wrong behaviour by accident. Import one from the other, or give the different behaviour a name that says so (lib/liveBoard.ts \`pageBoard\` is the worked example).`);
  }
  if (!clashes.length) globalThis.__names = byName.size;
}

if (bad.length) {
  console.log(`\n✗ verify:id-chunks — ${bad.length} problem(s): an estate-wide read that is not chunked, a shadowed helper name, or two files exporting one name:\n`);
  for (const b of bad) console.log("  · " + b);
  console.log(`
An id list of 800 uuids is 29.6 KB of URL and PostgREST answers "Bad Request"; a select with no
.limit() is silently capped at 1,000 rows. Either way the answer comes back SHORT with no error, and
these are the reads that decide what an owner can see and which modules are on — so short means a
restaurant missing from their own sidebar, a module reading as OFF, or activity hidden that they are
entitled to see.

Route it through lib/inChunks.ts:

    const { rows, error } = await readInChunks(ids, (chunk) =>
      sb.from("settings").select(COLS).in("restaurant_id", chunk).limit(chunk.length));
    if (error) return /* say you could not read it — never a short list */;
`);
  process.exit(1);
}

// ── NO lib/ FILE MAY SHADOW A SHARED READ HELPER'S NAME (T25 sweep, 2026-08-21) ────────────────
//
// lib/liveBoard.ts defined its own `pageAll` and its own `mapLimit`, both names of SHARED helpers in
// lib/pageAll.ts and lib/mapLimit.ts — and the paging pair genuinely disagreed: the shared one
// refuses past its cap and returns `{ error }`, the board's logged and returned a truncated list.
// Neither was wrong for its own job, but one name with two answers is how the next person picks the
// wrong behaviour by accident.
//
// Resolved by SHARING the half that was safe (the fan-out — same ceiling, strictly less waiting) and
// RENAMING the half that was not (`pageBoard`, behaviour untouched, because a kitchen board that
// draws 20,000 of 20,001 tickets beats one that refuses during a rush).
//
// This keeps that settled. It checks NAMES, not behaviour: a local helper may differ all it likes,
// as long as it is not pretending to be the shared one.
const SHARED_HELPERS = ["pageAll", "mapLimit", "readInChunks", "idChunks"];
for (const [rel] of Object.entries(ESTATE_READERS).concat([["lib/liveBoard.ts"]])) {
  const file = join(ROOT, rel);
  if (!existsSync(file)) continue;
  const src = readFileSync(file, "utf8");
  const imports = new Set([...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/(?:pageAll|mapLimit|inChunks)["']/g)]
    .flatMap((m) => m[1].split(",").map((x) => x.trim())));
  for (const h of SHARED_HELPERS) {
    // A LOCAL definition of the name — `function h(`, `const h =` — while not importing it.
    const defines = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?(?:function\\s+${h}\\s*[(<]|const\\s+${h}\\s*=)`).test(src);
    if (defines && !imports.has(h)) {
      bad.push(`${rel} defines its own \`${h}\` — that is the name of the shared helper in lib/. If the behaviour must differ, give it a name that says so (lib/liveBoard.ts \`pageBoard\` is the worked example); if it need not, import the shared one.`);
    }
  }
}

// ── EVERY readInChunks READ IS ONE ROW PER ID (T25 round 2, item 28, 2026-08-31) ─────────────────
//
// `readInChunks` has a contract its own body enforces:
//
//     if (batch.length > chunk.length) return { error: new Error("…the read is not one-row-per-id") }
//
// So a callback that can return MANY rows per id does not get a longer list — it gets an error, and
// whatever the caller already wrote stays written. lib/softDelete.ts did exactly that: it asked
// "which of these sessions still has a live order" through readInChunks with `.limit(1000)` and a
// note explaining that orders outnumber sessions on purpose. MEASURED against the real helper:
//
//     readInChunks: a chunk returned more rows than ids (1000 > 500) — the read is not one-row-per-id
//
// …thrown as `bill tombstone check failed` AFTER the bills had been stamped deleted, and unrepairable
// by a retry (the second call finds nothing live, returns { deleted: 0 } and never reaches the
// tombstone). Ten other chunked reads in the codebase all end `.limit(chunk.length)`. This makes that
// shape the rule, so the next many-per-id read has to page instead of pretending.
{
  const files = [];
  (function walk(d) {
    for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name)) files.push(rel);
    }
  })("lib");
  let chunked = 0;
  for (const rel of files) {
    // lib/inChunks.ts is where readInChunks is DEFINED — its own signature is not a call.
    if (rel === "lib/inChunks.ts") continue;
    const src = readFileSync(join(ROOT, rel), "utf8");
    if (!/readInChunks/.test(src)) continue;
    // Take each readInChunks CALL by paren-matching, so a wrapped callback is seen whole. `<` after
    // the name is the type argument every caller passes; the definition is excluded above.
    for (const m of src.matchAll(/readInChunks\s*</g)) {
      let i = src.indexOf("(", m.index), depth = 0, j = i;
      for (; j < src.length; j++) {
        if (src[j] === "(") depth++;
        else if (src[j] === ")") { depth--; if (!depth) break; }
      }
      const call = src.slice(m.index, j + 1);
      chunked++;
      if (/\.limit\(\s*chunk\.length\s*\)/.test(call)) continue;
      const shown = call.replace(/\s+/g, " ").slice(0, 150);
      bad.push(`${rel}: a readInChunks read does not end .limit(chunk.length) — readInChunks REFUSES a batch bigger than its chunk ("the read is not one-row-per-id"), so a many-rows-per-id read gets an ERROR, not a longer list. Page it yourself instead (lib/softDelete.ts → sessionsWithLiveOrders is the worked example).\n         ${shown}…`);
    }
  }
  if (chunked < 8) {
    bad.push(`this check found only ${chunked} readInChunks call(s) — it should see ten or more. Its walk found nothing, so nothing was checked.`);
  }
}

// ── A FAN-OUT WIDTH IT CANNOT READ RUNS ONE AT A TIME, NEVER NONE (T25 round 3, item 38) ─────────
//
// `Math.min(Math.max(1, NaN), n)` is NaN, and `Array.from({ length: NaN })` is an EMPTY array. So
// lib/mapLimit.ts, the fan-out under every estate-wide read, spawned NO workers when its width was not
// a number — and returned a full-length list of nothing, with no error. MEASURED before the fix:
// `mapLimit([1,2,3], NaN, fn)` → `[null, null, null]`, and fn never called.
//
// Every caller passes FANOUT or FANOUT_HEAVY today, so nothing was broken on the floor. It is guarded
// because "silently nothing, with a 200" is the exact failure this whole guard exists to prevent.
{
  const src = readFileSync(join(ROOT, "lib/mapLimit.ts"), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*\s|\*\/|\/\*|\*$)/.test(l)).join("\n");
  if (!/Number\.isFinite\(asked\)/.test(code)) {
    bad.push("lib/mapLimit.ts no longer checks that its width is a NUMBER before building workers — a NaN width spawns none, and the fan-out returns a full-length list of nulls with no error (measured 2026-08-31)");
  }
  if (!/:\s*1;/.test(code) || !/const width =/.test(code)) {
    bad.push("lib/mapLimit.ts no longer falls back to a width of 1 — the fallback is what turns an unreadable width into slow-but-correct instead of silent-and-empty");
  }
}

if (bad.length) {
  console.log(`\n✗ verify:id-chunks — ${bad.length} problem(s):\n`);
  for (const b of bad) console.log("  · " + b);
  process.exit(1);
}

console.log(`✓ verify:id-chunks — ${checked} estate-wide read(s) chunk their id list; no lib/ file shadows a shared read helper; and all ${globalThis.__names ?? 0} exported names in lib/ are unique`);
