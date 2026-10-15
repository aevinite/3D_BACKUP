// scripts/sweep/t16s10/cov.mjs — WHICH PARTS OF MY FILES HAS NO CHECK EVER RUN? (sweep #10 T16 round 2)
//
//   T16_COV=<dir> node scripts/sweep/t16s10/run.mjs --suite …     # collect (any suite, any number of runs)
//   node scripts/sweep/t16s10/cov.mjs report <dir> [--json out]    # read it back: per file, every line / branch never run
//
// Two kinds of file, one measure:
//   · the shared PANEL files run in a browser. Every harness page (browser.mjs) and every real-panel
//     page the suites open records V8's JavaScript coverage through Playwright; an entry is credited to a
//     file only when its source text is BYTE-FOR-BYTE that file today (so a page that loaded the backup
//     site's older bytes is never counted as covering this checkout).
//   · the ROUTES (and lib/maintenance.ts) run in Node under NODE_V8_COVERAGE, loaded through
//     ./hooks.mjs WITHOUT a bundle — Node strips types by blanking them, so offsets are file offsets.
// V8 writes a nested range only where its count differs from its parent, so each recorded run is read
// on its own (innermost range wins per character) and the runs are then UNIONED: a character is "run"
// if any run ran it. A line is "never run" when none of its code characters ran; a BRANCH ARM is a
// zero-count range inside code that otherwise ran. Nothing here sends, writes or signs in to anything.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { ROOT, MY_FILES, ROUTES } from "./lib.mjs";

export const PANEL_TARGETS = MY_FILES.map((f) => "public/panels/" + f);
// The owner settings route is someone else's file except for the maintenance half this terminal wrote
// (round 2, item 15) — so only that function is measured there. lib/maintenance.ts is wholly mine.
export const NODE_TARGETS = [ROUTES.health, ROUTES.clientError, ROUTES.maintenance, "lib/maintenance.ts", ROUTES.ownerSettings];
const text = new Map();
const fileText = (rel) => { if (!text.has(rel)) text.set(rel, readFileSync(join(ROOT, rel), "utf8")); return text.get(rel); };

// ── collecting (browser) ─────────────────────────────────────────────────────────────────────
const DIR = process.env.T16_COV || "";
const live = new Set();
export async function covStart(page) {
  if (!DIR || !page || page.__t16cov) return;
  try { await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: false }); page.__t16cov = true; live.add(page); } catch { return; /* not Chromium */ }
  // THE BROWSER ONLY REPORTS SCRIPTS STILL ALIVE. A document that is navigated away from takes its
  // scripts — and their counts — with it, so a check that loads five pages in a row used to be
  // credited for its last one only (found reading the first report: lines a guard visibly drives
  // read "never run"). So every navigation the harness can see writes the current document's
  // record FIRST, then starts a fresh one. In-page navigations (location.href) are not seen; none
  // of these suites leave a page that way before reading what they came for.
  if (!page.__t16wrapped) {
    page.__t16wrapped = true;
    for (const m of ["goto", "reload", "goBack", "goForward"]) {
      const orig = page[m].bind(page);
      page[m] = async (...a) => { if (page.__t16cov) { await covStop(page); await covStart(page); } return orig(...a); };
    }
  }
}
export async function covStop(page) {
  if (!DIR || !page || !page.__t16cov) return;
  page.__t16cov = false; live.delete(page);
  let entries = [];
  try { entries = await page.coverage.stopJSCoverage(); } catch { return; }
  const keep = [];
  for (const e of entries) {
    if (!e.source) continue;
    let rel = PANEL_TARGETS.find((t) => e.source === fileText(t));
    if (rel) { keep.push({ file: rel, functions: e.functions }); continue; }
    // A CRLF file (maint.js) INLINED into a page reaches the browser with LF only — the HTML parser
    // normalises line endings inside <script>. Same code, so it counts; its offsets are moved back
    // onto the real file (one extra character per CR before each position).
    rel = PANEL_TARGETS.find((t) => fileText(t).includes("\r\n") && e.source === fileText(t).replace(/\r\n/g, "\n"));
    if (rel) {
      const crAt = []; const t = fileText(rel); let n = 0;
      for (let i = 0; i < t.length; i++) { if (t[i] === "\r" && t[i + 1] === "\n") { crAt.push(i - n); n++; } }
      const back = (o) => { let lo = 0, hi = crAt.length; while (lo < hi) { const m = (lo + hi) >> 1; if (crAt[m] < o) lo = m + 1; else hi = m; } return o + lo; };
      keep.push({ file: rel, functions: e.functions.map((f) => ({ ...f, ranges: f.ranges.map((g) => ({ ...g, startOffset: back(g.startOffset), endOffset: back(g.endOffset) })) })) });
    }
  }
  if (!keep.length) return;
  mkdirSync(join(DIR, "browser"), { recursive: true });
  writeFileSync(join(DIR, "browser", `p-${Date.now()}-${randomBytes(4).toString("hex")}.json`), JSON.stringify(keep));
}
/** Stop every page still recording (call before the browser closes). */
export async function covFlush() { for (const p of [...live]) await covStop(p); }

// ── reading back ─────────────────────────────────────────────────────────────────────────────
function runsFor(dir) {
  const runs = [];   // [{ file, functions }]
  const b = join(dir, "browser");
  if (existsSync(b)) for (const f of readdirSync(b)) for (const e of JSON.parse(readFileSync(join(b, f), "utf8"))) runs.push(e);
  const n = join(dir, "node");
  if (existsSync(n)) for (const f of readdirSync(n)) {
    if (!f.endsWith(".json")) continue;
    const j = JSON.parse(readFileSync(join(n, f), "utf8"));
    for (const s of j.result || []) {
      const url = decodeURIComponent(s.url || "");
      const rel = [...NODE_TARGETS, ...PANEL_TARGETS].find((t) => url.endsWith("/" + t));
      if (rel) runs.push({ file: rel, functions: s.functions });
    }
  }
  return runs;
}
const isCodeLine = (t) => t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !/^[})\];,]+$/.test(t) && !/^(import |export \{|export type |type |\} from|"use )/.test(t);
/** Measured span of a file: the whole file, or for the owner route only the maintenance function. */
function span(rel) {
  const s = fileText(rel);
  if (rel === ROUTES.ownerSettings) {
    const a = s.indexOf("async function patchMaintenance("), b = s.indexOf("export async function POST(", a);
    const g1 = s.indexOf("  // ── THE GUEST MENU'S MAINTENANCE SWITCH"), g2 = s.indexOf("  return NextResponse.json({ name, isAdmin", g1);
    return [[g1, g2], [a, b]];
  }
  return [[0, s.length]];
}
export function report(dir) {
  const runs = runsFor(dir);
  const out = [];
  for (const rel of [...PANEL_TARGETS, ...NODE_TARGETS]) {
    const src = fileText(rel), N = src.length;
    const mine = runs.filter((r) => r.file === rel);
    const runAny = new Uint8Array(N), zeroSeen = new Uint8Array(N);
    const best = new Int32Array(N), bestLen = new Float64Array(N);
    for (const r of mine) {
      best.fill(-1); bestLen.fill(Infinity);
      for (const fn of r.functions) for (const g of fn.ranges) {
        const len = g.endOffset - g.startOffset;
        for (let i = g.startOffset; i < Math.min(g.endOffset, N); i++) if (len <= bestLen[i]) { bestLen[i] = len; best[i] = g.count; }
      }
      for (let i = 0; i < N; i++) { if (best[i] > 0) runAny[i] = 1; else if (best[i] === 0) zeroSeen[i] = 1; }
    }
    const spans = span(rel);
    const inSpan = (i) => spans.some(([a, b]) => i >= a && i < b);
    const lines = src.split("\n");
    let off = 0, code = 0, hit = 0;
    const missed = [], arms = [];
    for (let k = 0; k < lines.length; k++) {
      const L = lines[k], t = L.trim();
      if (inSpan(off) && isCodeLine(t)) {
        let anyCode = false, anyRun = false, anyZero = false;
        for (let i = off; i < off + L.length; i++) { if (/\s/.test(src[i])) continue; anyCode = true; if (runAny[i]) anyRun = true; else if (zeroSeen[i]) anyZero = true; }
        if (anyCode) { code++; if (anyRun) hit++; else missed.push(k + 1); if (anyRun && anyZero) arms.push(k + 1); }
      }
      off += L.length + 1;
    }
    out.push({ file: rel, runs: mine.length, code, hit, pct: code ? Math.round((hit / code) * 1000) / 10 : 100, missed, arms });
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("cov.mjs") && process.argv[2] === "report") {
  const dir = process.argv[3];
  const rep = report(dir);
  for (const r of rep) console.log(`${String(r.pct).padStart(5)}%  ${String(r.hit).padStart(4)}/${String(r.code).padEnd(4)} runs ${String(r.runs).padStart(3)}  ${r.file}${r.missed.length ? `  · never run: ${r.missed.length} line(s)` : ""}${r.arms.length ? `  · untaken arm on ${r.arms.length} line(s)` : ""}`);
  const ji = process.argv.indexOf("--json");
  if (ji > 0) writeFileSync(process.argv[ji + 1], JSON.stringify(rep, null, 1));
}
