#!/usr/bin/env node
/* verify-t12-plumbing.mjs — the SHARED PANEL PLUMBING re-run harness (sweep #8, terminal 12).
 *
 * WHAT THIS IS. Every check below carries the LEDGER ID of the row it re-runs
 * (`.claude/sweep/LEDGER/T9.md` for the sweep-#6 rows P04001-P04500, plus this run's own
 * P65701-P66700). A ledger row that is a "read the code and confirm X" row is exactly the kind
 * that rots silently: the file gets refactored, the claim stops being true, and nobody notices
 * because the row was ticked once by a human reading it. Asserting them mechanically is what
 * makes "re-run row P04034" a sentence a later sweep can actually execute.
 *
 * HOW IT JUDGES. Each check is a function over the file's TEXT, and the rule it asserts is named
 * in plain words. A check that cannot be expressed against the text says so (returns "skip")
 * rather than asserting something weaker - a guard that quietly narrows is worse than one that
 * is absent, because it reports green over the thing it stopped watching.
 *
 * LINE COMMENTS ARE STRIPPED BEFORE BLOCK COMMENTS, deliberately: these files are heavily
 * commented and a block-open sequence inside a line comment otherwise swallows the rest of the
 * file. (That exact ordering bug hid 190 lines from two shipped guards once.)
 *
 * Usage:  node scripts/verify-t12-plumbing.mjs [--verbose] [--only P04034,P65701]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const P = (p) => path.join(ROOT, p);
const argv = process.argv.slice(2);
const VERBOSE = argv.includes("--verbose");
const onlyIdx = argv.indexOf("--only");
const ONLY = onlyIdx >= 0 && argv[onlyIdx + 1]
  ? new Set(argv[onlyIdx + 1].split(",").filter(Boolean))
  : null;

// -- the files this terminal owns ------------------------------------------------------------
const FILES = {
  outbox: "public/panels/outbox.js",
  realtime: "public/panels/realtime.js",
  connbadge: "public/panels/connbadge.js",
  offline: "public/panels/offline.js",
  errlog: "public/panels/errlog.js",
  theme: "public/panels/theme.js",
  fitnums: "public/panels/fitnums.js",
  backstack: "public/panels/backstack.js",
  undobar: "public/panels/undobar.js",
  guestbell: "public/panels/guestbell.js",
  myprofile: "public/panels/myprofile.js",
  maint: "public/panels/maint.js",
  issueRaise: "public/panels/issue-raise.js",
  swipehint: "public/panels/swipehint.js",
  auditsort: "public/panels/auditsort.js",
  auditsortDts: "public/panels/auditsort.d.ts",
  billdocDts: "public/panels/billdoc.d.ts",
  swreg: "public/panels/swreg.js",
  floorLayouts: "public/panels/floor-layouts.js",
  kitchenHtml: "public/panels/kitchen/index.html",
  tabletHtml: "public/panels/tablet/index.html",
  editorHtml: "public/panels/editor/index.html",
  editorApp: "public/panels/editor/app.js",
  editorCss: "public/panels/editor/style.css",
  kitchenApp: "public/panels/kitchen/app.js",
  kitchenCss: "public/panels/kitchen/style.css",
  tabletApp: "public/panels/tablet/app.js",
  tabletCss: "public/panels/tablet/style.css",
  sw: "public/sw.js",
  guestOutbox: "lib/guestOutbox.ts",
  connectionStatus: "lib/connectionStatus.ts",
  connBadgeTsx: "components/ConnectionBadge.tsx",
  staffProfileShared: "lib/staffProfileShared.ts",
};

const raw = {};
for (const [k, rel] of Object.entries(FILES)) {
  try { raw[k] = fs.readFileSync(P(rel), "utf8"); }
  catch { raw[k] = null; }
}

/* STRIP LINE COMMENTS FIRST, THEN BLOCK COMMENTS. The other order lets a block-open sequence
   that appears inside a line comment open a comment that never closes, hiding everything after
   it. */
function code(src) {
  if (src == null) return "";
  /* HTML COMMENTS GO FIRST, and they matter as much as the JS ones. These panels keep OBITUARIES
     - a comment recording a thing that was deleted and why - and the manager panel's obituary for
     the old text connection indicator contains the markup it is describing. Two checks in this
     harness's first run "found" that element back in the page and one "found" the script load
     order broken, both by matching a comment about the past. A dead pointer is usually a
     deliberate obituary; read the sentence, not the grep. */
  let s = src.replace(/<!--[\s\S]*?-->/g, " ");        // HTML comments (incl. obituaries)
  s = s.replace(/(^|[^:])\/\/[^\n]*/g, "$1");          // JS line comments (not "://" in a URL)
  s = s.replace(/\/\*[\s\S]*?\*\//g, " ");             // JS block comments
  return s;
}
const c = {};
for (const k of Object.keys(raw)) c[k] = code(raw[k]);

// -- the register ---------------------------------------------------------------------------
const results = [];
function check(id, what, fn) {
  if (ONLY && !ONLY.has(id)) return;
  let ok, note = "";
  try {
    const r = fn();
    if (r === "skip") ok = "skip";
    else if (typeof r === "string") { ok = false; note = r; }
    else ok = !!r;
  } catch (e) { ok = false; note = "check threw: " + (e && e.message); }
  results.push({ id, what, ok, note });
}
/* A row whose subject genuinely cannot be judged from the file text. An honest skip, with the
   reason, beats an assertion that happens to pass for the wrong reason. */
function skipRow(id, what, why) {
  if (ONLY && !ONLY.has(id)) return;
  results.push({ id, what, ok: "skip", note: why });
}

/* Everything inside one named function's body, brace-matched. Used where "is X above Y" or
   "is X inside this branch" is the actual rule - a whole-file grep answers a different question
   and is how a guard comes to pass over the thing it was written for. */
function fnBody(src, header) {
  const i = src.indexOf(header);
  if (i < 0) return "";
  /* SKIP THE PARAMETER LIST FIRST. `async function send({ base, method, ... })` destructures its
     argument, so the next "{" after the header is the PARAMETER OBJECT, not the body - and a
     brace-matcher started there returns the parameter list and nothing else. Ten checks over
     send() failed that way on the first run of this harness, which is the guard inventing a
     failure rather than finding one. So: walk to the ")" that closes the parameters, then take
     the first "{" after it. */
  let p = src.indexOf("(", i);
  if (p < 0) return "";
  let pd = 0, afterParams = -1;
  for (let j = p; j < src.length; j++) {
    if (src[j] === "(") pd++;
    else if (src[j] === ")") { pd--; if (pd === 0) { afterParams = j; break; } }
  }
  if (afterParams < 0) return "";
  const start = src.indexOf("{", afterParams);
  if (start < 0) return "";
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    const ch = src[j];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return src.slice(start);
}
// Does the first pattern appear before the second, in the same text?
function before(src, a, b) {
  const ia = src.search(a), ib = src.search(b);
  return ia >= 0 && ib >= 0 && ia < ib;
}
const count = (src, re) => (src.match(re) || []).length;

// ===========================================================================================
// The checks live in sibling modules, one per file, so this stays readable.
// ===========================================================================================
const ctx = { c, raw, check, skipRow, fnBody, before, count, P, FILES };

const mods = [
  "./t12/outbox.checks.mjs",
  "./t12/realtime.checks.mjs",
  "./t12/connbadge.checks.mjs",
  "./t12/offline.checks.mjs",
  "./t12/errlog.checks.mjs",
  "./t12/small.checks.mjs",
  "./t12/maint.checks.mjs",
  "./t12/cross.checks.mjs",
  "./t12/new.checks.mjs",
];
for (const m of mods) {
  const mod = await import(m);
  if (typeof mod.run === "function") mod.run(ctx);
}

// -- report ---------------------------------------------------------------------------------
const pass = results.filter((r) => r.ok === true).length;
const fail = results.filter((r) => r.ok === false);
const skipped = results.filter((r) => r.ok === "skip");

// The per-row lines come out BEFORE the floor guard: a run that trips the floor is exactly the
// run whose rows somebody needs to read.
if (VERBOSE) {
  for (const r of results) {
    const mark = r.ok === true ? "PASS" : r.ok === "skip" ? "SKIP" : "FAIL";
    console.log(`${mark}  ${r.id}  ${r.what}${r.note ? "  -- " + r.note : ""}`);
  }
}

// A SUITE THAT FILTERS ITSELF OUT MUST NOT PRINT "ALL CLEAN". A minimum-check floor, so a
// broken import or a bad --only can never read as a green run.
const FLOOR = ONLY ? 1 : 700;
if (results.length < FLOOR) {
  console.error(`\nverify:t12-plumbing ran only ${results.length} checks; the floor is ${FLOOR}.`);
  console.error("Something filtered the suite out - a failed import or an empty module. Not a pass.");
  process.exit(2);
}

// Duplicate-id guard: an id means one check, forever.
const seen = new Map();
const dupes = [];
for (const r of results) {
  if (seen.has(r.id)) dupes.push(r.id);
  seen.set(r.id, true);
}

console.log(`\nverify:t12-plumbing - ${results.length} checks: ${pass} pass, ${fail.length} fail, ${skipped.length} skip`);
if (skipped.length && VERBOSE === false) {
  for (const s of skipped) console.log(`  SKIP ${s.id}  ${s.what} -- ${s.note}`);
}
if (dupes.length) {
  console.error(`\nDUPLICATE ledger ids (an id means one check, forever): ${[...new Set(dupes)].join(", ")}`);
}
if (fail.length) {
  console.error("\nFAILED:");
  for (const f of fail) console.error(`  ${f.id}  ${f.what}${f.note ? "\n        " + f.note : ""}`);
}
process.exit(fail.length || dupes.length ? 1 : 0);
