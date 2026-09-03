// scripts/sweep/t9/lib.mjs — the shared harness for the kitchen-screen ledger replay.
//
// WHY A HARNESS AND NOT 1,500 HAND RE-READS. Sweep #8's T9 territory (the kitchen screen) is
// covered by 1,515 permanent numbered checks in `.claude/sweep/LEDGER/T6.md` plus 145 more
// scattered across eleven other ledgers. Re-reading them by eye is a day's work that produces
// nothing re-runnable, and the ledger's whole point is that the NEXT sweep re-runs it in seconds.
// So every row whose verification is "read the file" / "grep both files" is an assertion here,
// keyed by its ledger id — `node scripts/verify-kitchen-screen.mjs --only P02534` re-runs exactly
// one row, forever.
//
// Rows that need a running browser live in `live.mjs`; rows that need a screenshot looked at
// cannot be mechanised and stay a human read.

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isRepoRoot } from "../repoRoot.mjs";

// The repo this guard lives in — three levels up from scripts/sweep/t9/. A path argument that
// really IS a repo still wins, so the release script can point this at another checkout; a
// `--base http://…` flag never can (see scripts/sweep/repoRoot.mjs for why that matters).
function t9Root() {
  for (const a of process.argv.slice(2)) { if (!a.startsWith("-") && isRepoRoot(a)) return a; }
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}
export const ROOT = t9Root();
export const P = (...p) => join(ROOT, ...p);

const cache = new Map();
/** Read one of the files this territory owns, cached. */
export function src(rel) {
  if (!cache.has(rel)) cache.set(rel, readFileSync(P(rel), "utf8"));
  return cache.get(rel);
}
export const APP = () => src("public/panels/kitchen/app.js");
export const HTML = () => src("public/panels/kitchen/index.html");
export const CSS = () => src("public/panels/kitchen/style.css");
export const ROUTE = () => src("app/api/kitchen/[...path]/route.ts");
export const PAGE = () => src("app/kitchen/page.tsx");
export const LAYOUT = () => src("app/kitchen/layout.tsx");

/**
 * Strip comments so a check cannot be satisfied by a SENTENCE ABOUT the code.
 *
 * LINE COMMENTS FIRST, THEN BLOCK COMMENTS — and that order is the whole point (project memory,
 * "Strip line comments BEFORE block comments"): a `/*` that appears inside a `//` line otherwise
 * opens a block comment that never closes, and 190 lines of real code vanish from the guard in
 * silence. Two shipped guards had exactly that fault.
 */
export function code(text) {
  const noLine = text.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  return noLine.replace(/\/\*[\s\S]*?\*\//g, "");
}
export const APPC = () => code(APP());
/**
 * The stylesheet with its block comments removed.
 *
 * WHY THIS IS NEEDED, and it bit this guard three times: this file DOCUMENTS the answers that were
 * tried and rejected, so the raw text contains lines like `.thead { justify-content: flex-end }`
 * inside a comment explaining why that is wrong. A detector reading the raw CSS then counts two
 * `.thead` rules and reports the rejected answer as shipped. Judge the CODE, never the prose about
 * it — the same rule `code()` exists for above.
 */
export const CSSC = () => CSS().replace(/\/\*[\s\S]*?\*\//g, "");
export const ROUTEC = () => code(ROUTE());

/** The 8-hex content hash `index.html` is supposed to carry for each asset (matches build tooling). */
export function contentHash(rel) {
  return createHash("sha1").update(readFileSync(P(rel))).digest("hex").slice(0, 8);
}

// ── the runner ────────────────────────────────────────────────────────────────
const rows = [];
/** row(id, label, fn) — fn returns true, or a string explaining the failure. */
export function row(id, label, fn) { rows.push({ id, label, fn }); }

export function runRows({ only } = {}) {
  const want = only ? new Set(only) : null;
  let pass = 0, fail = 0;
  const failures = [];
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.id)) { failures.push({ id: r.id, label: "DUPLICATE ID IN THIS GUARD", why: "an id means one check, forever" }); fail++; continue; }
    seen.add(r.id);
    if (want && !want.has(r.id)) continue;
    let out;
    try { out = r.fn(); } catch (e) { out = "threw: " + (e && e.message); }
    if (out === true) { pass++; }
    else { fail++; failures.push({ id: r.id, label: r.label, why: typeof out === "string" ? out : "returned " + out }); }
  }
  return { pass, fail, failures, total: rows.length };
}

export function report(title, res) {
  console.log(`\n${title}`);
  console.log(`  ${res.pass} passed · ${res.fail} failed  (of ${res.total} rows in this guard)`);
  for (const f of res.failures) console.log(`  ✗ ${f.id}  ${f.label}\n      → ${f.why}`);
  return res.fail === 0;
}

/** Assertion helpers that read like the ledger rows they replay. */
export const has = (text, needle) => text.includes(needle) || `missing: ${needle}`;
export const hasRe = (text, re) => re.test(text) || `no match for ${re}`;
export const lacks = (text, needle) => !text.includes(needle) || `still present: ${needle}`;
export const lacksRe = (text, re) => !re.test(text) || `unexpectedly matches ${re}`;
/** first index of a needle, for "A must load/appear before B" rows */
export const before = (text, a, b) => {
  const i = text.indexOf(a), j = text.indexOf(b);
  if (i < 0) return `missing: ${a}`;
  if (j < 0) return `missing: ${b}`;
  return i < j || `${a} does not come before ${b}`;
};
export { existsSync };
