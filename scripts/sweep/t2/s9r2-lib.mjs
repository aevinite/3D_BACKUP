// scripts/sweep/t2/s9r2-lib.mjs — shared plumbing for T2's sweep-#9 round 2.
//
// The dish page and the 3D viewer, 500 freshly planned phases (P101751-P101800 + P110501-P110950),
// aimed by MEASURING which files the ledger's 3,100 existing rows actually stand on rather than by
// having an idea (S9-RULES 2b). The three thinnest were all guest DOORS: the 404 page (8 rows),
// app/view/[folder]/page.tsx (40) and app/item/[slug]/page.tsx (75).
//
//   node scripts/sweep/t2/s9r2-checks.mjs            # source-level, no server
//   node scripts/sweep/t2/s9r2-live.mjs --base URL   # driven against a production build
//
// Results land in .claude/sweep/t2-s9r2-results.json, which generates the ledger rows.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const RESULTS = join(ROOT, ".claude", "sweep", "t2-s9r2-results.json");

export const F = {
  viewPage: "app/view/[folder]/page.tsx",
  viewer: "app/view/[folder]/ViewerClient.tsx",
  itemPage: "app/item/[slug]/page.tsx",
  itemClient: "app/item/[slug]/ItemClient.tsx",
  notFound: "app/item/[slug]/not-found.tsx",
  notFoundR: "app/r/[restaurant]/item/[slug]/not-found.tsx",
  itemPageR: "app/r/[restaurant]/item/[slug]/page.tsx",
  pmv: "components/PublicModelViewer.tsx",
  loader: "lib/modelLoader.ts",
  guestNotFound: "components/GuestNotFound.tsx",
  offlineStatic: "components/OfflineNoticeStatic.tsx",
  tenantStorage: "lib/tenantStorage.ts",
  css: "app/globals.css",
};

export const raw = (p) => readFileSync(join(ROOT, p), "utf8");

// COMMENTS ARE STRIPPED BEFORE EVERY SOURCE MATCH, so prose describing a rule can never stand in
// for the rule. Line comments go FIRST: a `/*` inside a `//` line otherwise swallows everything to
// the next `*/` — the trap the ledger records costing 190 lines across two files.
export const code = (p) =>
  raw(p)
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

// ── THE ID ALLOCATOR, BECAUSE A HAND-TYPED COUNTER WALKED OUT OF ITS OWN BLOCK ────────────────
// This run's ids live in TWO disjoint ranges: the 50 still free inside this terminal's sweep-#9
// block, and the 450 claimed from the registry on 2026-09-15. A per-block `n = 110591` was the
// first thing written, and block A promptly ran to P101801 — ONE id past the block's ceiling and
// into T3's range — while leaving P110561–P110590 unused. Both faults are invisible until someone
// diffs the ledger, which is how this registry collected six collisions.
//
// So ids are not typed any more. `nextId()` walks the two ranges in order and THROWS the moment
// they are exhausted, which is what S9-RULES asks a terminal to do rather than borrow.
const RANGES = [[101751, 101800], [110501, 110950]];
let _ri = 0, _cur = RANGES[0][0];
// …AND IT RESUMES ACROSS PROCESSES. The static half and the live half are two `node` runs, so a
// per-process counter restarts at the first id and silently re-uses the whole static range — which
// is exactly what happened on the first live run: 70 checks filed as P101751 upward, on top of 70
// rows that already had those ids. An id means ONE check forever; a duplicate is the collision this
// registry exists to prevent, and here it would have been self-inflicted inside one terminal's own
// block. So the allocator reads what is already recorded and starts after it.
try {
  if (existsSync(RESULTS)) {
    const prev = JSON.parse(readFileSync(RESULTS, "utf8"));
    const used = Object.values(prev).flat().map((r) => parseInt(String(r.id).slice(1), 10)).filter(Number.isFinite);
    if (used.length) {
      const hi = Math.max(...used);
      for (let i = 0; i < RANGES.length; i++) {
        if (hi >= RANGES[i][0] && hi <= RANGES[i][1]) { _ri = i; _cur = hi + 1; break; }
      }
    }
  }
} catch { /* a missing or damaged results file just means "start at the beginning" */ }
export function nextId() {
  while (_ri < RANGES.length && _cur > RANGES[_ri][1]) { _ri++; if (_ri < RANGES.length) _cur = RANGES[_ri][0]; }
  if (_ri >= RANGES.length) throw new Error("T2 round 2 has exhausted its 500 ids — STOP, do not take another terminal's range");
  return "P" + _cur++;
}
export function idsLeft() {
  let left = 0;
  for (let i = _ri; i < RANGES.length; i++) left += RANGES[i][1] - (i === _ri ? _cur : RANGES[i][0]) + 1;
  return left;
}

const results = [];
export function check(id, what, how, fn) {
  let ok = false, note = "";
  try {
    const r = fn();
    if (typeof r === "object" && r !== null) { ok = !!r.ok; note = r.note || ""; }
    else { ok = !!r; }
  } catch (e) { ok = false; note = "threw: " + String(e && e.message).slice(0, 140); }
  results.push({ id, what, how, ok, note });
  return ok;
}
export function skip(id, what, how, why) { results.push({ id, what, how, skip: true, note: why }); }

export function save(tag) {
  const prev = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, "utf8")) : {};
  prev[tag] = results;
  writeFileSync(RESULTS, JSON.stringify(prev, null, 1));
  const bad = results.filter((r) => !r.ok && !r.skip);
  const sk = results.filter((r) => r.skip);
  console.log(`\n${tag}: ${results.length} checks · ${results.length - bad.length - sk.length} ✅ · ${bad.length} ❌ · ${sk.length} ⏭`);
  for (const b of bad) console.log(`   ❌ ${b.id}  ${b.what}${b.note ? "  — " + b.note : ""}`);
  return bad.length;
}
