// scripts/sweep/t13/lib.mjs — shared plumbing for the T13 (owner dashboard) ledger replay.
//
// The ledger is the point: every check below carries the ID it re-runs, so a later sweep can
// say "re-run P05517" and mean one thing. This file holds the assertion API and the source
// loaders; the checks themselves live in replay.mjs / live.mjs beside it.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isRepoRoot } from "../repoRoot.mjs";

// Walk UP from this file until the folder really is a repo root. `repoRootFrom` assumes the
// caller sits one level under the root (scripts/), and this file sits three levels down — the
// same "a relative path is not a root" trap repoRoot.mjs was written for.
function findRoot() {
  let d = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (isRepoRoot(d) && existsSync(join(d, "package.json"))) return d;
    d = dirname(d);
  }
  throw new Error("could not find the repo root above scripts/sweep/t13");
}
export const ROOT = findRoot();
export const rel = (p) => join(ROOT, p);

const cache = new Map();
/** Raw file text. Throws loudly if the path is wrong — a check that silently reads "" passes. */
export function src(p) {
  if (cache.has(p)) return cache.get(p);
  const full = rel(p);
  if (!existsSync(full)) throw new Error(`source missing: ${p}`);
  const t = readFileSync(full, "utf8");
  if (!t.length) throw new Error(`source empty: ${p}`);
  cache.set(p, t);
  return t;
}

// ── COMMENTS OFF, LINE COMMENTS FIRST ────────────────────────────────────────────────────────
// This file's own scar, and the repo's: a `/*` written inside a `//` line hid 190 lines from two
// shipped guards, silently, because the block-comment pass ran first and swallowed everything to
// the next `*/`. Strip `//` to end-of-line BEFORE `/* … */`, never the other way round. `page.tsx`
// is FULL of prose comments quoting code, so asserting on behaviour without this reads the essay
// instead of the program.
const noCommentCache = new Map();
export function code(p) {
  if (noCommentCache.has(p)) return noCommentCache.get(p);
  const stripped = stripComments(src(p));
  noCommentCache.set(p, stripped);
  return stripped;
}
export function stripComments(text) {
  const lines = text.split("\n").map((l) => {
    // a `//` inside a string literal is not a comment; this is a heuristic, and it only has to be
    // right about THIS repo's sources, which never build a URL by concatenating "//" mid-line
    // outside a quote. Quotes are counted so `"https://x"` survives.
    let inS = null, out = "";
    for (let i = 0; i < l.length; i++) {
      const c = l[i], n = l[i + 1];
      if (inS) { out += c; if (c === inS && l[i - 1] !== "\\") inS = null; continue; }
      if (c === '"' || c === "'" || c === "`") { inS = c; out += c; continue; }
      if (c === "/" && n === "/") break;
      out += c;
    }
    return out;
  });
  return lines.join("\n").replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Just the styled-jsx / style blocks — for asserting on CSS the page ships. */
export function styles(p) {
  const t = src(p);
  const out = [];
  const re = /<style[^>]*>\{`([\s\S]*?)`\}<\/style>/g;
  let m;
  while ((m = re.exec(t))) out.push(m[1]);
  return out.join("\n");
}

// ── the results table ────────────────────────────────────────────────────────────────────────
export const results = [];
let only = null;
export function setOnly(ids) { only = ids && ids.length ? new Set(ids) : null; }

/**
 * chk(id, what, fn) — fn returns true (pass), a string (fail, with the reason), or throws.
 * A thrown error is a FAIL with its message, never a silent skip: a check that cannot run is
 * exactly as useless as one that fails, and pretending otherwise is how five guards ran zero
 * checks for weeks in this repo.
 */
export function chk(id, what, fn) {
  if (only && !only.has(id)) return;
  const land = (r) => {
    const pass = r === true;
    results.push({ id, what, pass, why: pass ? "" : (typeof r === "string" ? r : `returned ${JSON.stringify(r)}`) });
  };
  const fail = (e) => land(`threw: ${e && e.message ? e.message : String(e)}`);
  let r;
  try { r = fn(); } catch (e) { fail(e); return; }
  // A LIVE check is async, a STATIC one is not, and the same `chk` has to be honest about both.
  // The first version compared a Promise against `true` and filed every browser check as
  // "returned {}" — a harness fault that would have reported the whole live pass as broken.
  // A thenable is awaited and the CALLER must await chk(); a plain value lands synchronously,
  // so the static replays keep working unchanged.
  if (r && typeof r.then === "function") return r.then(land, fail);
  land(r);
}
/** An honest skip, with the reason a later session needs. Counted separately, never as a pass. */
export function skip(id, what, why) {
  if (only && !only.has(id)) return;
  results.push({ id, what, pass: null, why });
}

export function report(label, { minChecks = 1 } = {}) {
  // T13_DUMP_IDS=1 prints the id -> check mapping, so a positional id can be frozen into a
  // literal one. An id that moves when a row is inserted is not an identity.
  if (process.env.T13_DUMP_IDS) for (const r of results) console.log(`MAP\t${r.id}\t${r.what}`);
  const pass = results.filter((r) => r.pass === true).length;
  const fail = results.filter((r) => r.pass === false);
  const skipped = results.filter((r) => r.pass === null);
  // ── A MINIMUM-CHECK FLOOR (this repo's own scar) ────────────────────────────────────────────
  // A suite that filters itself down to nothing prints "all clean" and means nothing. Read the
  // COUNT, not the word: if fewer checks ran than the floor, that is a failure of the harness.
  console.log(`\n${label}: ${pass} passed · ${fail.length} failed · ${skipped.length} skipped  (${results.length} rows executed)`);
  for (const f of fail) console.log(`  ❌ ${f.id}  ${f.what}\n       ${f.why}`);
  for (const s of skipped) console.log(`  ⏭  ${s.id}  ${s.what}\n       ${s.why}`);
  if (results.length < minChecks) {
    console.log(`\nHARNESS FAULT: only ${results.length} checks ran, floor is ${minChecks}. A suite that filters itself out prints "all clean".`);
    process.exit(2);
  }
  return { pass, fail: fail.length, skipped: skipped.length, total: results.length, failures: fail };
}

/** count of non-overlapping matches — `has(x, /re/g)` style questions asked honestly */
export const count = (text, re) => (text.match(re) || []).length;

// ── THE LEDGER ROWS ARE GENERATED FROM WHAT ACTUALLY RAN ─────────────────────────────────────
// Typing rows by hand and running checks separately is how a ledger comes to claim a result
// nothing produced. `--ledger <file>` appends one markdown row per executed check, with the
// result the harness actually got, so the two cannot drift.
import { appendFileSync } from "node:fs";
export function writeLedger(path, { how = "", section = "" } = {}) {
  const esc = (t) => String(t).replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines = [];
  if (section) lines.push("", `## ${section}`, "", "| id | check | how to verify | result | note |", "|----|-------|---------------|--------|------|");
  for (const r of results) {
    const mark = r.pass === true ? "✅" : r.pass === false ? "❌" : "⏭";
    lines.push(`| ${r.id} | ${esc(r.what)} | ${esc(how)} | ${mark} | ${esc(r.why)} |`);
  }
  appendFileSync(path, lines.join("\n") + "\n");
  return results.length;
}
/** The ids this run executed — so a caller can prove it used its own block and nobody else's. */
export const executedIds = () => results.map((r) => r.id);
