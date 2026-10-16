// scripts/sweep/t12r3/cov.mjs — WHICH PARTS OF THE WAITER TABLET HAS NO CHECK EVER RUN? (sweep #10 T12 round 3)
//
//   T12_COV=<dir> node scripts/sweep/t12s10/run.mjs …        # any suite, any number of runs: each records
//   T12_COV=<dir> node scripts/sweep/t12r2/run.mjs …
//   node scripts/sweep/t12r3/cov.mjs report <dir> [--json out] [--list]
//
// Round 1 checked behaviour, round 2 enumerated every function, attribute and message. Neither could
// say which LINES of public/panels/tablet/app.js no check had ever executed — "every function has a
// check" is not "every branch inside it ran". This measures it. Adapted from T16's cov.mjs (same
// method, one browser-only target set):
//
//   · every page a suite opens records V8's JavaScript coverage through Playwright (Chromium only);
//   · an entry is credited to app.js only when its source is BYTE-FOR-BYTE app.js in this checkout, so a
//     page that loaded some other build's bytes never counts; the panel's inline <script> blocks are
//     credited to index.html at the offset where their text sits in the file;
//   · the browser reports only scripts still alive, so a navigation, a page close, a context close and
//     the browser close each write the record FIRST (lib.mjs wraps all four when T12_COV is set);
//   · V8 writes a nested range only where its count differs from its parent, so each run is read on its
//     own (innermost range wins per character) and the runs are UNIONED.
// A line is "never run" when none of its code characters ran; an "untaken arm" is a zero-count range
// inside a line that otherwise ran. Nothing here sends, writes or signs in to anything.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const TARGETS = ["public/panels/tablet/app.js", "public/panels/tablet/index.html"];
const text = new Map();
const fileText = (rel) => { if (!text.has(rel)) text.set(rel, readFileSync(join(ROOT, rel), "utf8")); return text.get(rel); };

const DIR = process.env.T12_COV || "";
const live = new Set();
export const covOn = () => !!DIR;

export async function covStart(page) {
  if (!DIR || !page || page.__t12cov) return;
  try { await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: false }); page.__t12cov = true; live.add(page); } catch { return; }
  if (!page.__t12wrapped) {
    page.__t12wrapped = true;
    for (const m of ["goto", "reload", "goBack", "goForward"]) {
      const orig = page[m].bind(page);
      page[m] = async (...a) => { if (page.__t12cov) { await covStop(page); await covStart(page); } return orig(...a); };
    }
    const close = page.close.bind(page);
    page.close = async (...a) => { await covStop(page); return close(...a); };
  }
}
export async function covStop(page) {
  if (!DIR || !page || !page.__t12cov) return;
  page.__t12cov = false; live.delete(page);
  let entries = [];
  try { entries = await page.coverage.stopJSCoverage(); } catch { return; }
  const keep = [];
  const app = fileText(TARGETS[0]), html = fileText(TARGETS[1]);
  for (const e of entries) {
    if (!e.source) continue;
    if (e.source === app) { keep.push({ file: TARGETS[0], functions: e.functions }); continue; }
    // An inline <script> of the panel page: credit it to index.html where its text starts.
    if (e.source.length > 20 && /\/panels\/tablet\/index\.html/.test(e.url || "")) {
      const at = html.indexOf(e.source);
      if (at >= 0) keep.push({ file: TARGETS[1], functions: e.functions.map((f) => ({ ...f, ranges: f.ranges.map((g) => ({ ...g, startOffset: g.startOffset + at, endOffset: g.endOffset + at })) })) });
    }
  }
  if (!keep.length) return;
  mkdirSync(join(DIR, "browser"), { recursive: true });
  writeFileSync(join(DIR, "browser", `p-${Date.now()}-${randomBytes(4).toString("hex")}.json`), JSON.stringify(keep));
}
/** Every page of this context writes its record before the context goes. */
export async function covFlushContext(ctx) { for (const p of ctx.pages()) await covStop(p); }
/** Every page still recording (call before the browser closes). */
export async function covFlush() { for (const p of [...live]) await covStop(p); }

// ── reading back ─────────────────────────────────────────────────────────────────────────────
function runsFor(dir) {
  const runs = [];
  const b = join(dir, "browser");
  if (existsSync(b)) for (const f of readdirSync(b)) for (const e of JSON.parse(readFileSync(join(b, f), "utf8"))) runs.push(e);
  return runs;
}
const isCodeLine = (t) => t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("<!--") && !/^[})\];,]+$/.test(t);
/** Only the JavaScript inside index.html is measured — the markup around it is not code. */
function spans(rel) {
  const s = fileText(rel);
  if (rel !== TARGETS[1]) return [[0, s.length]];
  const out = [];
  for (const m of s.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const a = m.index + m[0].indexOf(">") + 1;
    out.push([a, a + m[1].length]);
  }
  return out;
}
export function report(dir) {
  const runs = runsFor(dir);
  const out = [];
  for (const rel of TARGETS) {
    const src = fileText(rel), N = src.length;
    const mine = runs.filter((r) => r.file === rel);
    const runAny = new Uint8Array(N), zeroSeen = new Uint8Array(N);
    const best = new Int32Array(N), bestLen = new Float64Array(N);
    for (const r of mine) {
      best.fill(-1); bestLen.fill(Infinity);
      for (const fn of r.functions) for (const g of fn.ranges) {
        const len = g.endOffset - g.startOffset;
        for (let i = Math.max(0, g.startOffset); i < Math.min(g.endOffset, N); i++) if (len <= bestLen[i]) { bestLen[i] = len; best[i] = g.count; }
      }
      for (let i = 0; i < N; i++) { if (best[i] > 0) runAny[i] = 1; else if (best[i] === 0) zeroSeen[i] = 1; }
    }
    const sp = spans(rel);
    const inSpan = (i) => sp.some(([a, b]) => i >= a && i < b);
    const lines = src.split("\n");
    let off = 0, code = 0, hit = 0;
    const missed = [], arms = [];
    for (let k = 0; k < lines.length; k++) {
      const L = lines[k], t = L.trim();
      if (inSpan(off) && isCodeLine(t)) {
        let anyCode = false, anyRun = false, anyZero = false;
        // Comment tails and string contents are still code characters to V8; only whitespace is skipped.
        for (let i = off; i < off + L.length; i++) { if (/\s/.test(src[i])) continue; anyCode = true; if (runAny[i]) anyRun = true; else if (zeroSeen[i]) anyZero = true; }
        if (anyCode) { code++; if (anyRun) hit++; else missed.push(k + 1); if (anyRun && anyZero) arms.push(k + 1); }
      }
      off += L.length + 1;
    }
    out.push({ file: rel, runs: mine.length, code, hit, pct: code ? Math.round((hit / code) * 1000) / 10 : 100, missed, arms });
  }
  return out;
}
/** Group a sorted list of line numbers into ranges, each named by the function it sits in. */
export function regions(rel, lineNos) {
  const lines = fileText(rel).split("\n");
  const fnAt = (n) => { for (let k = n - 1; k >= 0; k--) { const m = lines[k].match(/^(?:async )?function (\w+)|^(?:const|let) (\w+) = (?:async )?\(|^  (?:async )?(\w+)\s*\([^)]*\)\s*\{$/); if (m) return m[1] || m[2] || m[3]; } return "(top level)"; };
  const out = [];
  for (const n of lineNos) {
    const last = out[out.length - 1];
    if (last && n <= last.to + 2 && fnAt(n) === last.fn) last.to = n;
    else out.push({ fn: fnAt(n), from: n, to: n });
  }
  return out.map((r) => ({ ...r, first: lines[r.from - 1].trim().slice(0, 110) }));
}

if (process.argv[1] && process.argv[1].endsWith("cov.mjs") && process.argv[2] === "report") {
  const dir = process.argv[3];
  const rep = report(dir);
  for (const r of rep) {
    console.log(`${String(r.pct).padStart(5)}%  ${String(r.hit).padStart(5)}/${String(r.code).padEnd(5)} runs ${String(r.runs).padStart(4)}  ${r.file}  · never run: ${r.missed.length} line(s) · untaken arm on ${r.arms.length}`);
    if (process.argv.includes("--list")) for (const g of regions(r.file, r.missed)) console.log(`     L${g.from}${g.to > g.from ? "–" + g.to : ""}  ${g.fn}  │ ${g.first}`);
  }
  const ji = process.argv.indexOf("--json");
  if (ji > 0) { mkdirSync(dirname(process.argv[ji + 1]), { recursive: true }); writeFileSync(process.argv[ji + 1], JSON.stringify(rep, null, 1)); }
}
