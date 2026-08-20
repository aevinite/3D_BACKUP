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
import { readFileSync, existsSync } from "node:fs";
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

/** The source of one function, from its `export ... name(` to the matching close brace. */
function bodyOf(src, name) {
  const start = src.search(new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*[(<]`));
  if (start < 0) return null;
  let i = src.indexOf("{", start);
  if (i < 0) return null;
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

if (bad.length) {
  console.log(`\n✗ verify:id-chunks — ${bad.length} estate-wide read(s) are not chunked:\n`);
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

console.log(`✓ verify:id-chunks — ${checked} estate-wide read(s) chunk their id list (500 max per URL, .limit() per chunk)`);
